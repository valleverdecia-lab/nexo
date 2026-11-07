"""
Jarvis — cerebro. Convierte lenguaje natural en acciones y respuestas.

Tres motores, en este orden:
  1. proveedor IA configurado (openai / anthropic / gemini / ollama) → puede
     encadenar varias herramientas, con confirmación para lo delicado.
  2. sin proveedor → acciones.interpretar_local(), un intérprete de reglas que
     funciona 100% offline y gratis.

El modelo NUNCA ejecuta nada directamente: propone {accion, args} y es
servidor.py quien valida, confirma con el usuario y ejecuta.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from core import get_config, log

# --------------------------------------------------------------------------- #
# Catálogo de herramientas que se le describen al modelo
# --------------------------------------------------------------------------- #
HERRAMIENTAS: list[dict[str, Any]] = [
    {"nombre": "abrir_app", "args": {"app": "string (notepad, calc, chrome, code, spotify...)"},
     "desc": "Abre un programa instalado en el equipo."},
    {"nombre": "abrir_web", "args": {"url": "string"},
     "desc": "Abre una URL o busca en Google si recibe una frase."},
    {"nombre": "buscar_web", "args": {"consulta": "string"}, "desc": "Busca en Google."},
    {"nombre": "captura_pantalla", "args": {}, "desc": "Hace una captura de pantalla y devuelve la ruta."},
    {"nombre": "volumen", "args": {"nivel": "0-100 | 'subir' | 'bajar' | 'silenciar'"},
     "desc": "Cambia el volumen del sistema."},
    {"nombre": "multimedia", "args": {"orden": "'play' | 'pausa' | 'siguiente' | 'anterior'"},
     "desc": "Controla la reproducción de música."},
    {"nombre": "bloquear_pc", "args": {}, "desc": "Bloquea la sesión del usuario."},
    {"nombre": "apagar_pc", "args": {"confirmar": "bool"}, "desc": "Apaga el equipo en 60s. Requiere confirmar=true."},
    {"nombre": "cancelar_apagado", "args": {}, "desc": "Cancela un apagado programado."},
    {"nombre": "estado_sistema", "args": {}, "desc": "CPU, RAM, disco y batería."},
    {"nombre": "fecha_hora", "args": {}, "desc": "Fecha y hora actuales."},
    {"nombre": "listar_archivos", "args": {"ruta": "escritorio|documentos|descargas|inicio|ruta relativa"},
     "desc": "Lista el contenido de una carpeta permitida."},
    {"nombre": "leer_archivo", "args": {"ruta": "string"}, "desc": "Lee un archivo de texto permitido."},
    {"nombre": "escribir_archivo", "args": {"ruta": "string", "contenido": "string", "anadir": "bool"},
     "desc": "Crea o sobrescribe un archivo permitido."},
    {"nombre": "crear_carpeta", "args": {"ruta": "string"}, "desc": "Crea una carpeta permitida."},
    {"nombre": "buscar_archivos", "args": {"patron": "string", "ruta": "string"},
     "desc": "Busca archivos por patrón (ej. *.pdf) en una carpeta permitida."},
    {"nombre": "crear_nota", "args": {"texto": "string", "titulo": "string"}, "desc": "Añade una nota."},
    {"nombre": "leer_notas", "args": {}, "desc": "Devuelve las notas guardadas."},
    {"nombre": "temporizador", "args": {"segundos": "int", "etiqueta": "string"},
     "desc": "Pone un temporizador con aviso."},
    {"nombre": "ejecutar_comando", "args": {"comando": "string", "confirmado": "bool"},
     "desc": "Shell del sistema. SOLO si el usuario lo pide explícitamente."},
]

CATALOGO_TEXTO = "\n".join(
    f"- {h['nombre']}({', '.join(f'{k}: {v}' for k, v in h['args'].items())}): {h['desc']}"
    for h in HERRAMIENTAS
)

PERSONALIDAD = (
    "Eres {nombre}, el asistente personal del usuario en su propia computadora. "
    "Hablas español, de forma breve, directa y algo seca, como un mayordomo eficiente. "
    "Sin halagos, sin rellenos, sin emojis. Máximo 2 frases salvo que pidan detalle.\n\n"
    "Tienes estas herramientas:\n{catalogo}\n\n"
    "Responde SIEMPRE con un único objeto JSON, sin texto alrededor:\n"
    '{{"accion": "nombre", "args": {{...}}}} para ejecutar algo,\n'
    '{{"acciones": [{{"accion": ..., "args": ...}}, ...]}} para encadenar varias,\n'
    '{{"respuesta": "texto"}} para solo hablar.\n'
    "Si el usuario pide algo dañino, destructivo o fuera de sus carpetas permitidas, "
    "usa respuesta para negarte en una frase y explica la alternativa. "
    "Nunca inventes resultados de herramientas: si no la has ejecutado, no sabes el resultado."
)


def catalogo_para_prompt() -> str:
    return CATALOGO_TEXTO


# --------------------------------------------------------------------------- #
# Llamadas HTTP a los proveedores
# --------------------------------------------------------------------------- #
def _post_json(url: str, cuerpo: dict[str, Any], cabeceras: dict[str, str], timeout: int = 60) -> dict[str, Any]:
    datos = json.dumps(cuerpo).encode("utf-8")
    peticion = urllib.request.Request(
        url, data=datos, method="POST",
        headers={"Content-Type": "application/json", **cabeceras},
    )
    try:
        with urllib.request.urlopen(peticion, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detalle = exc.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{exc.code} de {url.split('/')[2]}: {detalle}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"No pude conectar con {url.split('/')[2]}: {exc.reason}") from exc


def _llamar_openai(mensajes: list[dict[str, str]]) -> str:
    clave = get_config("cerebro.api_key") or ""
    if not clave:
        raise RuntimeError("falta cerebro.api_key")
    modelo = get_config("cerebro.modelo") or "gpt-4o-mini"
    base = get_config("cerebro.base_url") or "https://api.openai.com/v1"
    res = _post_json(
        f"{base}/chat/completions",
        {"model": modelo, "messages": mensajes,
         "temperature": float(get_config("cerebro.temperatura", 0.3))},
        {"Authorization": f"Bearer {clave}"},
    )
    return res["choices"][0]["message"]["content"]


def _llamar_anthropic(mensajes: list[dict[str, str]]) -> str:
    clave = get_config("cerebro.api_key") or ""
    if not clave:
        raise RuntimeError("falta cerebro.api_key")
    modelo = get_config("cerebro.modelo") or "claude-3-5-haiku-latest"
    sistema = mensajes[0]["content"] if mensajes and mensajes[0]["role"] == "system" else ""
    resto = [m for m in mensajes if m["role"] != "system"]
    res = _post_json(
        "https://api.anthropic.com/v1/messages",
        {"model": modelo, "max_tokens": 700, "system": sistema, "messages": resto,
         "temperature": float(get_config("cerebro.temperatura", 0.3))},
        {"x-api-key": clave, "anthropic-version": "2023-06-01"},
    )
    return "".join(b.get("text", "") for b in res.get("content", []))


def _llamar_gemini(mensajes: list[dict[str, str]]) -> str:
    clave = get_config("cerebro.api_key") or ""
    if not clave:
        raise RuntimeError("falta cerebro.api_key")
    modelo = get_config("cerebro.modelo") or "gemini-2.0-flash"
    sistema = mensajes[0]["content"] if mensajes and mensajes[0]["role"] == "system" else ""
    partes = []
    for m in mensajes:
        if m["role"] == "system":
            continue
        rol = "user" if m["role"] == "user" else "model"
        partes.append({"role": rol, "parts": [{"text": m["content"]}]})
    res = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={clave}",
        {"systemInstruction": {"parts": [{"text": sistema}]}, "contents": partes,
         "generationConfig": {"temperature": float(get_config("cerebro.temperatura", 0.3))}},
        {},
    )
    candidatos = res.get("candidates") or []
    if not candidatos:
        raise RuntimeError("Gemini no devolvió respuesta (¿clave o cuota?)")
    return "".join(p.get("text", "") for p in candidatos[0]["content"]["parts"])


def _llamar_ollama(mensajes: list[dict[str, str]]) -> str:
    base = get_config("cerebro.ollama_url") or "http://localhost:11434"
    modelo = get_config("cerebro.modelo") or "llama3.1"
    res = _post_json(
        f"{base.rstrip('/')}/api/chat",
        {"model": modelo, "messages": mensajes, "stream": False,
         "options": {"temperature": float(get_config("cerebro.temperatura", 0.3))}},
        {}, timeout=120,
    )
    return res.get("message", {}).get("content", "")


_PROVEEDORES = {
    "openai": _llamar_openai,
    "anthropic": _llamar_anthropic,
    "gemini": _llamar_gemini,
    "ollama": _llamar_ollama,
}


def proveedor_activo() -> str:
    p = (get_config("cerebro.proveedor") or "ninguno").lower()
    return p if p in _PROVEEDORES else "ninguno"


# --------------------------------------------------------------------------- #
# Interpretación
# --------------------------------------------------------------------------- #
def _extraer_json(texto: str) -> dict[str, Any] | None:
    limpio = (texto or "").strip()
    if limpio.startswith("```"):
        limpio = limpio.strip("`")
        limpio = limpio.split("\n", 1)[1] if "\n" in limpio else limpio
        limpio = limpio.rsplit("```", 1)[0]
    inicio = limpio.find("{")
    fin = limpio.rfind("}")
    if inicio == -1 or fin == -1 or fin < inicio:
        return None
    try:
        datos = json.loads(limpio[inicio:fin + 1])
    except json.JSONDecodeError:
        return None
    return datos if isinstance(datos, dict) else None


def _contexto_sistema() -> dict[str, Any]:
    from core import carpeta_sistema, get_config as _g

    return {
        "carpetas_permitidas": _g("seguridad.carpetas_permitidas"),
        "escritorio": str(carpeta_sistema("Desktop")),
        "usuario": str(__import__("pathlib").Path.home()),
    }


def interpretar(texto: str, historial: list[dict[str, str]] | None = None) -> dict[str, Any]:
    """
    Devuelve:
      {"tipo": "acciones", "acciones": [{"accion":..., "args":...}]}
      {"tipo": "respuesta", "texto": "..."}
      {"tipo": "error", "texto": "..."}
    """
    proveedor = proveedor_activo()
    if proveedor == "ninguno":
        plan = __import__("acciones").interpretar_local(texto)
        if "accion" in plan:
            return {"tipo": "acciones", "acciones": [{"accion": plan["accion"], "args": plan.get("args", {})}],
                    "motor": "local"}
        return {"tipo": "respuesta", "texto": plan.get("respuesta", ""), "motor": "local"}

    nombre = get_config("nombre", "Jarvis")
    sistema = PERSONALIDAD.format(nombre=nombre, catalogo=catalogo_para_prompt())
    sistema += "\n\nContexto: " + json.dumps(_contexto_sistema(), ensure_ascii=False)

    mensajes = [{"role": "system", "content": sistema}]
    for m in (historial or [])[-8:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            mensajes.append({"role": m["role"], "content": m["content"]})
    mensajes.append({"role": "user", "content": texto})

    try:
        crudo = _PROVEEDORES[proveedor](mensajes)
    except Exception as exc:
        log(f"cerebro[{proveedor}] falló: {exc}")
        plan = __import__("acciones").interpretar_local(texto)
        if "accion" in plan:
            return {"tipo": "acciones", "motor": "local (IA no disponible)",
                    "acciones": [{"accion": plan["accion"], "args": plan.get("args", {})}],
                    "aviso": f"Sin conexión con {proveedor}: {exc}"}
        return {"tipo": "error", "texto": f"No pude contactar con {proveedor}: {exc}"}

    datos = _extraer_json(crudo)
    if datos is None:
        return {"tipo": "respuesta", "texto": crudo.strip()[:1500], "motor": proveedor}

    if isinstance(datos.get("acciones"), list):
        limpias = [a for a in datos["acciones"] if isinstance(a, dict) and a.get("accion")]
        if limpias:
            return {"tipo": "acciones", "motor": proveedor,
                    "acciones": [{"accion": a["accion"], "args": a.get("args") or {}} for a in limpias]}
    if datos.get("accion"):
        return {"tipo": "acciones", "motor": proveedor,
                "acciones": [{"accion": datos["accion"], "args": datos.get("args") or {}}]}
    if datos.get("respuesta"):
        return {"tipo": "respuesta", "texto": str(datos["respuesta"])[:2000], "motor": proveedor}
    return {"tipo": "respuesta", "texto": crudo.strip()[:1500], "motor": proveedor}


def resumir_resultados(original: str, resultados: list[dict[str, Any]]) -> str:
    """Frase para TTS a partir de lo que devolvieron las acciones."""
    if not resultados:
        return ""
    if len(resultados) == 1:
        return resultados[0].get("frase") or ""
    exitos = sum(1 for r in resultados if r.get("ok"))
    return f"{exitos} de {len(resultados)} acciones completadas."
