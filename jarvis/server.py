#!/usr/bin/env python3
"""
Jarvis — servidor. Solo stdlib: no hace falta instalar nada para arrancarlo.

    python jarvis/server.py                 # http://127.0.0.1:8765
    python jarvis/server.py --host 0.0.0.0 --puerto 8765

Flujo de un mensaje:
    texto → ¿es una orden del sistema? (intérprete de reglas)
          → si no, al modelo con streaming (SSE) y herramientas encadenadas
          → el modelo PROPONE acciones; aquí se validan contra el registro real
          → lo delicado espera un token de confirmación del usuario
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import re
import secrets
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import acciones  # noqa: F401  (registra las acciones)
import chats
import llm
import prompt as prompt_mod
import voz
from core import (
    ACCIONES,
    BASE_DIR,
    CONFIG_PATH,
    Denegado,
    config,
    get_config,
    guardar_config,
    info_sistema,
    log,
)

UI_DIR = BASE_DIR / "ui"
VERSION = "2.0.0"
MAX_VUELTAS_HERRAMIENTAS = 3

PENDIENTES: dict[str, dict[str, Any]] = {}
PENDIENTES_LOCK = threading.Lock()
TOKEN_TTL = 180

# Modo "solo chat" por conversación: si el usuario pide conversación pura,
# no ofrecemos herramientas (evita que un modelo pequeño alucine JSON).
SOLO_CHAT: set[str] = set()


# --------------------------------------------------------------------------- #
# Frases para hablar según la acción
# --------------------------------------------------------------------------- #
def frase_de(nombre: str, resultado: dict[str, Any]) -> str:
    if not resultado.get("ok", True):
        motivo = resultado.get("error") or resultado.get("motivo") or "no se pudo"
        return f"No pude: {motivo}"[:200]
    if nombre == "fecha_hora":
        return f"Son las {resultado.get('hora')} del {resultado.get('dia_semana')}."
    if nombre == "estado_sistema":
        s = resultado.get("sistema", {})
        partes = []
        if s.get("ram_usada_pct") is not None:
            partes.append(f"RAM al {s['ram_usada_pct']} por ciento")
        if s.get("disco_usado_pct") is not None:
            partes.append(f"disco al {s['disco_usado_pct']} por ciento")
        if s.get("bateria_pct") is not None:
            partes.append(f"batería al {s['bateria_pct']} por ciento")
        return ("Estoy en " + ", ".join(partes) + ".") if partes else "Sistema operativo."
    if nombre == "abrir_app":
        return "Abriendo."
    if nombre == "abrir_web":
        return "Abriendo la web."
    if nombre == "buscar_web":
        return "Buscando."
    if nombre == "captura_pantalla":
        return "Captura guardada."
    if nombre == "volumen":
        return "Volumen ajustado."
    if nombre == "multimedia":
        return "Hecho."
    if nombre == "bloquear_pc":
        return "Bloqueando el equipo."
    if nombre == "apagar_pc":
        return "Apagando en un minuto."
    if nombre == "temporizador":
        return f"Temporizador de {resultado.get('segundos')} segundos en marcha."
    if nombre == "crear_nota":
        return "Nota guardada."
    if nombre == "leer_notas":
        contenido = (resultado.get("contenido") or "").strip()
        return "No tienes notas." if not contenido else contenido[-300:]
    if nombre == "listar_archivos":
        elementos = resultado.get("elementos") or []
        nombres = ", ".join(e["nombre"] for e in elementos[:8])
        return f"{len(elementos)} elementos: {nombres}." if elementos else "La carpeta está vacía."
    if nombre == "buscar_archivos":
        cuantos = len(resultado.get("encontrados") or [])
        return f"Encontré {cuantos} archivos." if cuantos else "No encontré nada con ese patrón."
    if nombre == "ejecutar_comando":
        salida = (resultado.get("salida") or resultado.get("error") or "").strip()
        return salida[:250] if salida else "Comando ejecutado."
    return "Hecho."


# --------------------------------------------------------------------------- #
# Ejecución con validación
# --------------------------------------------------------------------------- #
DELICADAS = {"ejecutar_comando", "apagar_pc"}


def _normalizar_args(func: Any, args: dict[str, Any]) -> dict[str, Any]:
    import inspect

    firma = inspect.signature(func)
    limpios: dict[str, Any] = {}
    for nombre, parametro in firma.parameters.items():
        if nombre not in args:
            continue
        valor = args[nombre]
        anotacion = str(parametro.annotation)
        try:
            if "int" in anotacion and not isinstance(valor, bool):
                valor = int(float(valor))
            elif "bool" in anotacion:
                valor = (valor.strip().lower() in ("1", "true", "si", "sí", "yes")
                         if isinstance(valor, str) else bool(valor))
            elif "str" in anotacion:
                valor = str(valor)
        except (TypeError, ValueError):
            pass
        limpios[nombre] = valor
    return limpios


def ejecutar(nombre: str, args: dict[str, Any], confirmado: bool = False) -> dict[str, Any]:
    if nombre not in ACCIONES:
        return {"ok": False, "error": f"Acción desconocida: {nombre}", "accion": nombre}
    func = ACCIONES[nombre]
    limpios = _normalizar_args(func, args or {})
    if nombre in DELICADAS and confirmado:
        limpios["confirmado" if nombre == "ejecutar_comando" else "confirmar"] = True

    inicio = time.time()
    try:
        resultado = func(**limpios)
        if not isinstance(resultado, dict):
            resultado = {"ok": True, "valor": resultado}
    except Denegado as exc:
        resultado = {"ok": False, "error": str(exc), "denegado": True}
    except TypeError as exc:
        resultado = {"ok": False, "error": f"Argumentos inválidos para {nombre}: {exc}"}
    except Exception as exc:  # noqa: BLE001
        log(f"acción {nombre} falló:\n{traceback.format_exc()}")
        resultado = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    resultado.setdefault("ok", True)
    resultado["accion"] = nombre
    resultado["duracion_ms"] = round((time.time() - inicio) * 1000)
    resultado["frase"] = frase_de(nombre, resultado)
    log(f"acción {nombre} ok={resultado['ok']} {resultado['duracion_ms']}ms")
    return resultado


def crear_pendiente(nombre: str, args: dict[str, Any]) -> dict[str, Any]:
    token = secrets.token_urlsafe(12)
    with PENDIENTES_LOCK:
        for clave in [k for k, v in PENDIENTES.items() if v["expira"] < time.time()]:
            PENDIENTES.pop(clave, None)
        PENDIENTES[token] = {"accion": nombre, "args": args, "expira": time.time() + TOKEN_TTL}
    motivos = {"ejecutar_comando": "Voy a ejecutar un comando en tu sistema.",
               "apagar_pc": "Voy a apagar el equipo."}
    detalle = args.get("comando", "") if nombre == "ejecutar_comando" else ""
    return {"necesita_confirmacion": True, "token": token, "accion": nombre, "args": args,
            "mensaje": motivos.get(nombre, f"Voy a ejecutar {nombre}."),
            "detalle": detalle, "expira_en": TOKEN_TTL,
            "frase": (motivos.get(nombre, "") + " " + detalle).strip()}


def confirmar(token: str) -> dict[str, Any]:
    with PENDIENTES_LOCK:
        pendiente = PENDIENTES.pop(token or "", None)
    if not pendiente:
        return {"ok": False, "error": "Ese permiso ya caducó o no existe."}
    if pendiente["expira"] < time.time():
        return {"ok": False, "error": "El permiso caducó. Pídemelo otra vez."}
    return ejecutar(pendiente["accion"], pendiente["args"], confirmado=True)


# --------------------------------------------------------------------------- #
# Turno: texto → (stream de respuesta, acciones)
# --------------------------------------------------------------------------- #
ORDEN_DIRECTA = "directa"


def _clasificar_local(texto: str) -> dict[str, Any] | None:
    """
    Órdenes de sistema evidentes que no necesitan pasar por el modelo.

    Solo cuando la frase es corta y empieza por un verbo de orden: así
    «dime la hora y comenta algo» va al modelo (que sabe conversar) y
    «qué hora es» se resuelve al instante sin gastar tokens.
    """
    if len(texto.split()) > 7:
        return None
    if not re.match(r"^\s*(abre|abrir|lanza|inicia|ejecuta|busca|pon|sube|baja|silencia|"
                    r"captura|apaga|cancela|bloquea|lista|lee|crea|apunta|anota|mis|qu[ée]|"
                    r"cu[áa]nta|cu[áa]nto|d[óo]nde|temporizador|av[íi]same)\b",
                    texto.lower()):
        return None
    plan = acciones.interpretar_local(texto)
    return plan if "accion" in plan else None


def _preparar_pendientes(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Separa lo ejecutable de lo que necesita confirmación."""
    resultados, pendientes = [], []
    for item in items[:6]:
        nombre = item.get("accion")
        args = dict(item.get("args") or {})
        if nombre not in ACCIONES:
            resultados.append({"ok": False, "accion": nombre,
                               "error": f"No existe la acción «{nombre}»."})
            continue
        if nombre in DELICADAS:
            # Lo que propone el modelo NUNCA cuenta como aprobación del usuario:
            # `confirmado`/`confirmar` se descartan y siempre se pide el token.
            args.pop("confirmado", None)
            args.pop("confirmar", None)
            pendientes.append(crear_pendiente(nombre, args))
            continue
        resultados.append(ejecutar(nombre, args))
    return resultados, pendientes


def _mensajes_modelo(ident: str, texto: str, con_herramientas: bool) -> list[dict[str, str]]:
    limite = int(get_config("cerebro.max_historial", 24) or 24)
    historial = chats.historial_para_modelo(ident, limite) if ident else []
    sistema = prompt_mod.system_prompt(con_herramientas=con_herramientas)
    return [{"role": "system", "content": sistema}, *historial, {"role": "user", "content": texto}]


def _pista_proveedor(exc: Exception) -> str:
    """Mensaje accionable según el fallo del motor."""
    proveedor = llm.proveedor_activo()
    detalle = str(exc)
    if proveedor == "ollama":
        if "Connection refused" in detalle or "No pude conectar" in detalle:
            return ("Ollama no está corriendo en " + llm.base_ollama() + ". "
                    "Ábrelo (o instálalo desde ollama.com/download) y lo detecto solo, sin reiniciar nada.")
        if "not found" in detalle.lower() or "model" in detalle.lower():
            return ("Ollama responde pero no tiene el modelo «" + llm.modelo_actual()
                    + "». Ejecuta en una terminal: ollama pull " + llm.modelo_actual())
    if proveedor in ("openai", "anthropic", "gemini") and ("401" in detalle or "403" in detalle):
        return f"La API key de {proveedor} no es válida o caducó. Cámbiala en ⚙ ajustes."
    if proveedor in ("openai", "anthropic", "gemini") and "429" in detalle:
        return f"{proveedor} me está limitando por cuota (429). Espera un momento o cambia de modelo."
    return f"No pude hablar con {proveedor}: {detalle[:300]}"


def _evento(nombre: str, datos: dict[str, Any]) -> bytes:
    return f"event: {nombre}\ndata: {json.dumps(datos, ensure_ascii=False)}\n\n".encode("utf-8")


def turno_stream(ident: str, texto: str, usar_herramientas: bool = True):
    """
    Generador SSE. Eventos: meta, delta, acciones, permiso, fin, error.
    """
    texto = (texto or "").strip()
    if not texto:
        yield _evento("error", {"mensaje": "Mensaje vacío."})
        return

    if not ident or not chats.obtener(ident):
        ident = chats.crear(proveedor=llm.proveedor_activo(), modelo=llm.modelo_actual())["id"]
    if ident:
        chats.añadir_mensaje(ident, "user", texto)
        conv = chats.obtener(ident)
        if conv and conv["titulo"] == "Nueva conversación":
            # Solo la primera vez: no gastamos una llamada al modelo por gusto
            chats.renombrar_si_es_nueva(ident, llm.generar_titulo(texto))

    proveedor = llm.proveedor_activo()
    yield _evento("meta", {"conversacion": ident, "proveedor": proveedor,
                           "modelo": llm.modelo_actual(), "version": VERSION})

    # 1. ¿Orden inequívoca del sistema?
    rapida = _clasificar_local(texto) if usar_herramientas else None
    if rapida:
        resultados, pendientes = _preparar_pendientes(
            [{"accion": rapida["accion"], "args": rapida.get("args", {})}])
        frases = [r.get("frase", "") for r in resultados] + [p["frase"] + " ¿Confirmas?" for p in pendientes]
        respuesta = " ".join(f for f in frases if f).strip()
        if ident:
            chats.añadir_mensaje(ident, "assistant", respuesta, {"resultados": resultados})
        yield _evento("acciones", {"resultados": resultados, "pendientes": pendientes})
        yield _evento("delta", {"texto": respuesta})
        yield _evento("fin", {"texto": respuesta, "motor": "reglas"})
        return

    # 2. Sin cerebro: mensaje claro
    if proveedor == "ninguno":
        estado = llm.estado_ollama()
        pista = ("Tengo Ollama configurado pero no responde en " + estado["url"]
                 + ". Ábrelo o instálalo y lo detecto solo."
                 if not estado["activo"] else
                 "Ollama responde pero no hay ningún modelo descargado. Ejecuta: ollama pull llama3.2")
        respuesta = ("Estoy sin modelo de lenguaje. " + pista
                     + " Mientras tanto entiendo órdenes directas: abre, busca, volumen, captura, notas, temporizador.")
        if ident:
            chats.añadir_mensaje(ident, "assistant", respuesta)
        yield _evento("delta", {"texto": respuesta})
        yield _evento("fin", {"texto": respuesta, "motor": "ninguno"})
        return

    # 3. Modelo con herramientas, varias vueltas
    con_herramientas = usar_herramientas and ident not in SOLO_CHAT
    mensajes = _mensajes_modelo(ident, texto, con_herramientas)
    respuesta_total = ""

    for vuelta in range(MAX_VUELTAS_HERRAMIENTAS):
        acumulado = ""
        try:
            for trozo in llm.stream(mensajes):
                acumulado += trozo
                # Un JSON de acción no se muestra al usuario: se ejecuta
                if acumulado.lstrip().startswith("{"):
                    continue
                yield _evento("delta", {"texto": trozo})
        except llm.ErrorLLM as exc:
            log(f"llm falló: {exc}")
            pista = _pista_proveedor(exc)
            # Plan B: intérprete de reglas
            resca = acciones.interpretar_local(texto)
            if "accion" in resca:
                resultados, pendientes = _preparar_pendientes(
                    [{"accion": resca["accion"], "args": resca.get("args", {})}])
                aviso = pista
                yield _evento("aviso", {"texto": aviso})
                yield _evento("acciones", {"resultados": resultados, "pendientes": pendientes})
                respuesta_total = " ".join([aviso] + [r.get("frase", "") for r in resultados]).strip()
                yield _evento("delta", {"texto": respuesta_total})
            else:
                respuesta_total = pista
                yield _evento("delta", {"texto": respuesta_total})
            chats.añadir_mensaje(ident, "assistant", respuesta_total)
            yield _evento("fin", {"texto": respuesta_total, "motor": "fallback"})
            return

        accion_json = prompt_mod.extraer_accion(acumulado)
        if not accion_json:
            respuesta_total = acumulado
            break

        # El modelo pidió herramientas
        items = accion_json.get("acciones") if isinstance(accion_json.get("acciones"), list) \
            else [{"accion": accion_json.get("accion"), "args": accion_json.get("args") or {}}]
        resultados, pendientes = _preparar_pendientes([i for i in items if isinstance(i, dict)])
        yield _evento("acciones", {"resultados": resultados, "pendientes": pendientes})

        resumen = "; ".join(
            f"{r['accion']}: " + (json.dumps({k: v for k, v in r.items() if k not in ('frase', 'accion', 'duracion_ms')}, ensure_ascii=False)[:600])
            for r in resultados
        ) or "pendiente de confirmación del usuario"
        respuesta_total = " ".join(r.get("frase", "") for r in resultados).strip()
        if pendientes:
            respuesta_total = (respuesta_total + " " + pendientes[0]["frase"] + " ¿Confirmas?").strip()

        if resultados and vuelta < MAX_VUELTAS_HERRAMIENTAS - 1 and not pendientes:
            # Damos otra vuelta para que el modelo comente el resultado
            mensajes = mensajes + [
                {"role": "assistant", "content": acumulado[:2000]},
                {"role": "user", "content": f"[resultado de las herramientas] {resumen}. "
                                            f"Resume el resultado en una frase, sin JSON."},
            ]
            if respuesta_total:
                yield _evento("delta", {"texto": respuesta_total + " "})
            respuesta_total = ""
            continue
        break

    if ident and respuesta_total:
        chats.añadir_mensaje(ident, "assistant", respuesta_total)
    if get_config("voz.leer_respuestas") and respuesta_total:
        voz.hablar(respuesta_total)
    yield _evento("fin", {"texto": respuesta_total, "motor": proveedor})


def manejar_chat(texto: str, ident: str = "", usar_herramientas: bool = True) -> dict[str, Any]:
    """Versión sin streaming (compatibilidad y pruebas)."""
    final: dict[str, Any] = {"ok": True, "resultados": [], "pendientes": [], "texto": ""}
    for bloque in turno_stream(ident, texto, usar_herramientas):
        cadena = bloque.decode("utf-8")
        if not cadena.startswith("event: "):
            continue
        _, resto = cadena.split("\n", 1)
        evento = cadena[7:cadena.index("\n")]
        datos = json.loads(resto[len("data: "):].strip())
        if evento == "delta":
            final["texto"] += datos.get("texto", "")
        elif evento == "acciones":
            final["resultados"] += datos.get("resultados", [])
            final["pendientes"] += datos.get("pendientes", [])
        elif evento == "meta":
            final["conversacion"] = datos.get("conversacion")
            final["proveedor"] = datos.get("proveedor")
        elif evento == "error":
            final["ok"] = False
            final["error"] = datos.get("mensaje")
    final["tipo"] = "acciones" if final["resultados"] or final["pendientes"] else "respuesta"
    return final


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = f"Jarvis/{VERSION}"
    protocol_version = "HTTP/1.1"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")

    def _json(self, datos: Any, estado: int = 200) -> None:
        cuerpo = json.dumps(datos, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(estado)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self._cors()
        self.end_headers()
        self.wfile.write(cuerpo)

    def _archivo(self, ruta: Path) -> None:
        if not ruta.is_file():
            self._json({"error": "no encontrado"}, 404)
            return
        datos = ruta.read_bytes()
        tipo = mimetypes.guess_type(ruta.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", tipo + ("; charset=utf-8" if tipo.startswith("text/") or tipo.endswith("javascript") else ""))
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(datos)

    def _cuerpo(self) -> dict[str, Any]:
        largo = int(self.headers.get("Content-Length") or 0)
        if not largo:
            return {}
        try:
            return json.loads(self.rfile.read(largo).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def log_message(self, formato: str, *args: Any) -> None:
        pass

    # --- GET --------------------------------------------------------------- #
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        partes = urlparse(self.path)
        ruta, query = partes.path, parse_qs(partes.query)
        try:
            if ruta in ("/", "/index.html"):
                self._archivo(UI_DIR / "index.html")
            elif ruta == "/api/estado":
                ollama = llm.estado_ollama()
                self._json({
                    "ok": True, "version": VERSION,
                    "nombre": get_config("nombre", "Jarvis"),
                    "sistema": info_sistema(),
                    "cerebro": llm.proveedor_activo(),
                    "modelo": llm.modelo_actual(),
                    "ollama": ollama,
                    "voz": get_config("voz.motor", "auto"),
                    "leer_respuestas": bool(get_config("voz.leer_respuestas")),
                    "acciones": sorted(ACCIONES),
                    "escucha": voz.escucha_disponible(),
                    "providers": ["ollama", "compatible", "openai", "anthropic", "gemini", "ninguno"],
                    "chats": chats.estadisticas(),
                })
            elif ruta == "/api/modelos":
                self._json(llm.listar_modelos())
            elif ruta == "/api/config":
                datos = json.loads(json.dumps(config()))
                clave = datos.get("cerebro", {}).get("api_key") or ""
                if clave:
                    datos["cerebro"]["api_key"] = "•" * 8 + clave[-4:]
                    datos["cerebro"]["api_key_guardada"] = True
                self._json({"ok": True, "config": datos, "ruta": str(CONFIG_PATH)})
            elif ruta == "/api/voces":
                self._json({"ok": True, "voces": voz.voces_disponibles()})
            elif ruta == "/api/escucha":
                self._json({"ok": True, **voz.escucha_disponible()})
            elif ruta == "/api/escuchar":
                largo = int((query.get("segundos") or ["6"])[0])
                self._json({"ok": True, **voz.escuchar_una_vez(min(max(largo, 2), 20))})
            elif ruta == "/api/chats":
                self._json({"ok": True, "chats": chats.listar(
                    int((query.get("limite") or ["100"])[0]),
                    incluir_archivadas=bool(query.get("archivadas")))})
            elif ruta.startswith("/api/chats/"):
                ident = ruta.rsplit("/", 1)[-1]
                conv = chats.obtener(ident)
                if not conv:
                    self._json({"ok": False, "error": "no existe"}, 404)
                else:
                    self._json({"ok": True, "chat": conv, "mensajes": chats.mensajes(ident)})
            elif ruta == "/api/buscar":
                self._json({"ok": True, "resultados": chats.buscar((query.get("q") or [""])[0])})
            elif ruta == "/api/exportar":
                ident = (query.get("chat") or [""])[0]
                conv = chats.obtener(ident)
                if not conv:
                    self._json({"ok": False, "error": "no existe"}, 404)
                else:
                    lineas = [f"# {conv['titulo']}\n"]
                    for m in chats.mensajes(ident):
                        lineas.append(f"\n**{m['rol']}**\n\n{m['contenido']}\n")
                    texto = "".join(lineas).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/markdown; charset=utf-8")
                    self.send_header("Content-Disposition", f'attachment; filename="{conv["titulo"][:40]}.md"')
                    self.send_header("Content-Length", str(len(texto)))
                    self._cors()
                    self.end_headers()
                    self.wfile.write(texto)
            elif ruta.startswith("/api/accion/"):
                self._json(ejecutar(ruta.rsplit("/", 1)[-1], {}))
            elif ruta.startswith("/ui/"):
                relativa = ruta[len("/ui/"):].lstrip("/")
                candidato = (UI_DIR / relativa).resolve()
                if candidato.parent == UI_DIR.resolve() or UI_DIR.resolve() in candidato.parents:
                    self._archivo(candidato)
                else:
                    self._json({"error": "ruta inválida"}, 400)
            else:
                self._json({"error": "ruta no encontrada"}, 404)
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001
            log(f"GET {ruta} falló:\n{traceback.format_exc()}")
            self._json({"ok": False, "error": str(exc)}, 500)

    # --- POST -------------------------------------------------------------- #
    def do_POST(self) -> None:  # noqa: N802
        ruta = urlparse(self.path).path
        try:
            cuerpo = self._cuerpo()

            if ruta == "/api/chat/stream":
                texto = cuerpo.get("texto", "")
                ident = cuerpo.get("chat", "")
                herramientas = cuerpo.get("herramientas", True) is not False
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-transform")
                self.send_header("Connection", "close")
                self.send_header("X-Accel-Buffering", "no")
                self._cors()
                self.end_headers()
                try:
                    for bloque in turno_stream(ident, texto, herramientas):
                        self.wfile.write(bloque)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                self.close_connection = True
                return

            if ruta == "/api/chat":
                self._json(manejar_chat(cuerpo.get("texto", ""), cuerpo.get("chat", "")))
            elif ruta == "/api/confirmar":
                self._json(confirmar(cuerpo.get("token", "")))
            elif ruta == "/api/accion":
                resultado = ejecutar(cuerpo.get("accion", ""), cuerpo.get("args") or {})
                if get_config("voz.motor", "auto") != "ninguno" and resultado.get("frase"):
                    voz.hablar(resultado["frase"])
                self._json(resultado)
            elif ruta == "/api/chat/nuevo":
                conv = chats.crear(proveedor=llm.proveedor_activo(), modelo=llm.modelo_actual())
                self._json({"ok": True, "chat": conv})
            elif ruta == "/api/chat/borrar":
                self._json({"ok": chats.borrar(cuerpo.get("chat", ""))})
            elif ruta == "/api/chat/renombrar":
                self._json({"ok": chats.renombrar(cuerpo.get("chat", ""), cuerpo.get("titulo", ""))})
            elif ruta == "/api/chat/archivar":
                self._json({"ok": chats.archivar(cuerpo.get("chat", ""), bool(cuerpo.get("archivada", True)))})
            elif ruta == "/api/chat/regenerar":
                ident = cuerpo.get("chat", "")
                mensajes = chats.mensajes(ident)
                ultimo_usuario = next((m for m in reversed(mensajes) if m["rol"] == "user"), None)
                if not ultimo_usuario:
                    self._json({"ok": False, "error": "no hay nada que regenerar"})
                else:
                    chats.borrar_mensajes_desde(ident, ultimo_usuario["id"])
                    ultima_pregunta = ultimo_usuario["contenido"]
                    chats_borrado = chats.borrar_mensajes_desde(ident, ultimo_usuario["id"])
                    self._json({"ok": True, "texto": ultima_pregunta})
            elif ruta == "/api/config":
                datos = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                for seccion, valores in (cuerpo.get("config") or {}).items():
                    if isinstance(valores, dict) and isinstance(datos.get(seccion), dict):
                        for clave, valor in valores.items():
                            if seccion == "cerebro" and clave == "api_key" and set(str(valor)) == {"•"}:
                                continue
                            datos[seccion][clave] = valor
                guardar_config(datos)
                self._json({"ok": True, "mensaje": "Configuración guardada."})
            elif ruta == "/api/config/clave":
                datos = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                datos.setdefault("cerebro", {})["api_key"] = str(cuerpo.get("api_key", "")).strip()
                if cuerpo.get("proveedor"):
                    datos["cerebro"]["proveedor"] = cuerpo["proveedor"]
                if cuerpo.get("modelo") is not None:
                    datos["cerebro"]["modelo"] = str(cuerpo["modelo"]).strip()
                guardar_config(datos)
                self._json({"ok": True, "proveedor": llm.proveedor_activo()})
            elif ruta == "/api/hablar":
                self._json(voz.hablar(cuerpo.get("texto", ""), bloquear=True))
            else:
                self._json({"error": "ruta no encontrada"}, 404)
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001
            log(f"POST {ruta} falló:\n{traceback.format_exc()}")
            self._json({"ok": False, "error": str(exc)}, 500)


def main() -> None:
    parser = argparse.ArgumentParser(description="Jarvis — asistente local")
    parser.add_argument("--puerto", type=int, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    puerto = args.puerto or int(get_config("puerto", 8765))
    servidor = ThreadingHTTPServer((args.host, puerto), Handler)
    servidor.daemon_threads = True

    log(f"Jarvis {VERSION} en http://{args.host}:{puerto}")
    ollama = llm.estado_ollama()
    log(f"  cerebro: {llm.proveedor_activo()} · modelo: {llm.modelo_actual() or '—'}")
    if llm.proveedor_activo() == "ollama":
        if ollama["activo"]:
            log(f"  Ollama OK en {ollama['url']} · modelos: {', '.join(ollama['modelos']) or 'NINGUNO'}")
        else:
            log(f"  Ollama NO responde en {ollama['url']} — ábrelo o instálalo")
    log(f"  acciones: {len(ACCIONES)} · chats: {chats.estadisticas()}")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        log("Apagando Jarvis.")
        servidor.shutdown()


if __name__ == "__main__":
    main()
