"""
Jarvis — motor de lenguaje con streaming.

Proveedores, todos por HTTP a pelo (sin SDKs):
  ollama            → LOCAL, gratis e ILIMITADO. El camino recomendado.
  compatible        → cualquier API OpenAI-compatible (LM Studio, Jan, llama.cpp,
                      OpenRouter, Groq, Together...) local o con clave.
  openai            → api.openai.com
  anthropic         → api.anthropic.com
  gemini            → Google AI Studio (capa gratuita con límite)
  ninguno           → sin modelo: solo el intérprete de reglas de acciones.py

Todos los streams producen texto incremental (yield str).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Iterator

from core import get_config, log


class ErrorLLM(RuntimeError):
    """El proveedor no está disponible o devolvió un error legible."""


# --------------------------------------------------------------------------- #
# Utilidades HTTP
# --------------------------------------------------------------------------- #
def _peticion(url: str, cuerpo: dict[str, Any] | None = None,
              cabeceras: dict[str, str] | None = None,
              metodo: str = "POST", timeout: int = 300):
    datos = json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None
    req = urllib.request.Request(
        url, data=datos, method=metodo,
        headers={"Content-Type": "application/json", **(cabeceras or {})},
    )
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        detalle = exc.read().decode("utf-8", "replace")[:400]
        raise ErrorLLM(f"{exc.code} de {url.split('/')[2]}: {detalle}") from exc
    except urllib.error.URLError as exc:
        raise ErrorLLM(f"No pude conectar con {url.split('/')[2]}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ErrorLLM(f"Tiempo de espera agotado con {url.split('/')[2]}") from exc


def _post_json(url: str, cuerpo: dict[str, Any], cabeceras: dict[str, str] | None = None,
               timeout: int = 300) -> dict[str, Any]:
    with _peticion(url, cuerpo, cabeceras, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --------------------------------------------------------------------------- #
# Proveedor
# --------------------------------------------------------------------------- #
def proveedor_activo() -> str:
    p = (get_config("cerebro.proveedor") or "ninguno").lower()
    return p if p in ("ollama", "compatible", "openai", "anthropic", "gemini") else "ninguno"


def base_ollama() -> str:
    return (get_config("cerebro.ollama_url") or "http://localhost:11434").rstrip("/")


def modelo_actual() -> str:
    modelo = (get_config("cerebro.modelo") or "").strip()
    if modelo:
        return modelo
    return {
        "ollama": "llama3.2",
        "compatible": "local-model",
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-haiku-latest",
        "gemini": "gemini-2.0-flash",
    }.get(proveedor_activo(), "")


def temperatura() -> float:
    try:
        return float(get_config("cerebro.temperatura", 0.7))
    except (TypeError, ValueError):
        return 0.7


# --------------------------------------------------------------------------- #
# Listado de modelos
# --------------------------------------------------------------------------- #
def listar_modelos() -> dict[str, Any]:
    """Modelos disponibles en el proveedor activo. Nunca lanza: informa."""
    prov = proveedor_activo()
    try:
        if prov == "ollama":
            with _peticion(f"{base_ollama()}/api/tags", None, metodo="GET", timeout=8) as resp:
                datos = json.loads(resp.read().decode("utf-8"))
            modelos = sorted(m["name"] for m in datos.get("models", []))
            return {"ok": True, "proveedor": prov, "modelos": modelos,
                    "servidor": base_ollama(), "vacio": not modelos}
        if prov == "compatible":
            base = (get_config("cerebro.base_url") or "http://localhost:1234/v1").rstrip("/")
            with _peticion(f"{base}/models", None, metodo="GET", timeout=8) as resp:
                datos = json.loads(resp.read().decode("utf-8"))
            return {"ok": True, "proveedor": prov,
                    "modelos": sorted(m.get("id", "?") for m in datos.get("data", []))}
        if prov == "openai":
            clave = get_config("cerebro.api_key") or ""
            base = (get_config("cerebro.base_url") or "https://api.openai.com/v1").rstrip("/")
            with _peticion(f"{base}/models", None, {"Authorization": f"Bearer {clave}"},
                           metodo="GET", timeout=10) as resp:
                datos = json.loads(resp.read().decode("utf-8"))
            return {"ok": True, "proveedor": prov,
                    "modelos": sorted(m.get("id", "?") for m in datos.get("data", []))}
        if prov == "gemini":
            clave = get_config("cerebro.api_key") or ""
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={clave}"
            with _peticion(url, None, metodo="GET", timeout=10) as resp:
                datos = json.loads(resp.read().decode("utf-8"))
            modelos = [m["name"].split("/")[-1] for m in datos.get("models", [])
                       if "generateContent" in m.get("supportedGenerationMethods", [])]
            return {"ok": True, "proveedor": prov, "modelos": sorted(modelos)}
        if prov == "anthropic":
            return {"ok": True, "proveedor": prov, "modelos": [
                "claude-3-5-haiku-latest", "claude-3-5-sonnet-latest",
                "claude-sonnet-4-20250514", "claude-opus-4-20250514"]}
        return {"ok": True, "proveedor": "ninguno", "modelos": [],
                "nota": "Sin cerebro configurado."}
    except (ErrorLLM, json.JSONDecodeError, OSError) as exc:
        return {"ok": False, "proveedor": prov, "modelos": [], "error": str(exc)}


def estado_ollama() -> dict[str, Any]:
    """¿Está Ollama escuchando? Sirve para el aviso de configuración en la UI."""
    try:
        with _peticion(f"{base_ollama()}/api/tags", None, metodo="GET", timeout=4) as resp:
            datos = json.loads(resp.read().decode("utf-8"))
        modelos = [m["name"] for m in datos.get("models", [])]
        return {"activo": True, "modelos": modelos, "url": base_ollama()}
    except Exception as exc:  # noqa: BLE001
        return {"activo": False, "modelos": [], "url": base_ollama(), "error": str(exc)}


# --------------------------------------------------------------------------- #
# Streaming por proveedor
# --------------------------------------------------------------------------- #
def _stream_ollama(mensajes: list[dict[str, str]], modelo: str) -> Iterator[str]:
    cuerpo = {
        "model": modelo,
        "messages": mensajes,
        "stream": True,
        "options": {"temperature": temperatura()},
    }
    with _peticion(f"{base_ollama()}/api/chat", cuerpo) as resp:
        for linea in resp:
            texto = linea.decode("utf-8").strip()
            if not texto:
                continue
            try:
                dato = json.loads(texto)
            except json.JSONDecodeError:
                continue
            if dato.get("error"):
                raise ErrorLLM(dato["error"])
            trozo = (dato.get("message") or {}).get("content") or ""
            if trozo:
                yield trozo
            if dato.get("done"):
                return


def _stream_openai(mensajes: list[dict[str, str]], modelo: str, base: str,
                   clave: str | None) -> Iterator[str]:
    cabeceras = {"Authorization": f"Bearer {clave}"} if clave else {}
    cuerpo = {"model": modelo, "messages": mensajes, "stream": True,
              "temperature": temperatura()}
    with _peticion(f"{base.rstrip('/')}/chat/completions", cuerpo, cabeceras) as resp:
        for linea in resp:
            texto = linea.decode("utf-8").strip()
            if not texto or not texto.startswith("data:"):
                continue
            datos = texto[5:].strip()
            if datos == "[DONE]":
                return
            try:
                trozo = json.loads(datos)
            except json.JSONDecodeError:
                continue
            if trozo.get("error"):
                raise ErrorLLM(str(trozo["error"])[:400])
            for opcion in trozo.get("choices", []):
                delta = opcion.get("delta") or {}
                contenido = delta.get("content")
                if contenido:
                    yield contenido


def _stream_anthropic(mensajes: list[dict[str, str]], modelo: str) -> Iterator[str]:
    clave = get_config("cerebro.api_key") or ""
    if not clave:
        raise ErrorLLM("falta la API key de Anthropic (⚙ ajustes)")
    sistema = mensajes[0]["content"] if mensajes and mensajes[0]["role"] == "system" else ""
    resto = [m for m in mensajes if m["role"] != "system"]
    datos = _post_json(
        "https://api.anthropic.com/v1/messages",
        {"model": modelo, "max_tokens": 4096, "system": sistema, "messages": resto,
         "temperature": temperatura()},
        {"x-api-key": clave, "anthropic-version": "2023-06-01"},
    )
    for bloque in datos.get("content", []):
        if bloque.get("text"):
            yield bloque["text"]


def _stream_gemini(mensajes: list[dict[str, str]], modelo: str) -> Iterator[str]:
    clave = get_config("cerebro.api_key") or ""
    if not clave:
        raise ErrorLLM("falta la API key de Gemini (⚙ ajustes)")
    sistema = mensajes[0]["content"] if mensajes and mensajes[0]["role"] == "system" else ""
    partes = [{"role": "user" if m["role"] == "user" else "model",
               "parts": [{"text": m["content"]}]}
              for m in mensajes if m["role"] != "system"]
    datos = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={clave}",
        {"systemInstruction": {"parts": [{"text": sistema}]}, "contents": partes,
         "generationConfig": {"temperature": temperatura()}},
    )
    candidatos = datos.get("candidates") or []
    if not candidatos:
        if datos.get("error"):
            raise ErrorLLM(str(datos["error"].get("message", datos["error"]))[:400])
        raise ErrorLLM("Gemini no devolvió respuesta (¿cuota agotada?)")
    for parte in candidatos[0]["content"]["parts"]:
        if parte.get("text"):
            yield parte["text"]


def stream(mensajes: list[dict[str, str]]) -> Iterator[str]:
    """Texto incremental del proveedor activo. Lanza ErrorLLM si no hay forma."""
    prov = proveedor_activo()
    modelo = modelo_actual()
    if prov == "ninguno":
        raise ErrorLLM("sin cerebro configurado")
    if prov == "ollama":
        yield from _stream_ollama(mensajes, modelo)
    elif prov == "compatible":
        base = get_config("cerebro.base_url") or "http://localhost:1234/v1"
        yield from _stream_openai(mensajes, modelo, base, get_config("cerebro.api_key") or None)
    elif prov == "openai":
        base = get_config("cerebro.base_url") or "https://api.openai.com/v1"
        yield from _stream_openai(mensajes, modelo, base, get_config("cerebro.api_key") or "")
    elif prov == "anthropic":
        yield from _stream_anthropic(mensajes, modelo)
    elif prov == "gemini":
        yield from _stream_gemini(mensajes, modelo)
    else:
        raise ErrorLLM(f"proveedor desconocido: {prov}")


def completar(mensajes: list[dict[str, str]]) -> str:
    """Atajo sin streaming (para resúmenes de título, etc.)."""
    return "".join(stream(mensajes))


def generar_titulo(primer_mensaje: str) -> str:
    """Título corto para la conversación. Sin gastar una llamada si es posible."""
    limpio = " ".join(primer_mensaje.split())
    if proveedor_activo() == "ninguno":
        return (limpio[:48] + "…") if len(limpio) > 48 else (limpio or "Nueva conversación")
    try:
        texto = completar([
            {"role": "system", "content": "Devuelve SOLO un título de 4 a 7 palabras, sin comillas ni puntuación final."},
            {"role": "user", "content": limpio[:600]},
        ]).strip().strip('"').replace("\n", " ")
        return texto[:60] or (limpio[:48] or "Nueva conversación")
    except Exception:  # noqa: BLE001
        log("no pude generar el título; uso el texto del mensaje")
        return (limpio[:48] + "…") if len(limpio) > 48 else (limpio or "Nueva conversación")
