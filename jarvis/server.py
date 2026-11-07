#!/usr/bin/env python3
"""
Jarvis — servidor. Solo stdlib: no hace falta instalar nada para arrancarlo.

    python jarvis/server.py                 # http://127.0.0.1:8765
    python jarvis/server.py --puerto 9000 --host 0.0.0.0

Reglas de oro:
  * El modelo PROPONE acciones; este archivo las VALIDA contra el registro real
    (ACCIONES) y contra las guardas de core.py. El modelo no inventa funciones.
  * Las acciones delicadas (shell, apagar) devuelven un token de confirmación y
    NO se ejecutan hasta que el usuario pulsa Confirmar en la UI.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import secrets
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import acciones  # noqa: F401  (registra las acciones)
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
from cerebro import interpretar, proveedor_activo
import voz

UI_DIR = BASE_DIR / "ui"
VERSION = "1.0.0"

PENDIENTES: dict[str, dict[str, Any]] = {}
PENDIENTES_LOCK = threading.Lock()
TOKEN_TTL = 180  # segundos para confirmar una acción delicada

HISTORIAL: list[dict[str, str]] = []
HISTORIAL_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# Frases para hablar según la acción
# --------------------------------------------------------------------------- #
def frase_de(nombre: str, resultado: dict[str, Any]) -> str:
    ok = resultado.get("ok", True)
    if not ok:
        motivo = resultado.get("error") or resultado.get("motivo") or "no se pudo"
        return f"No pude: {motivo}"[:200]

    if nombre == "fecha_hora":
        return f"Son las {resultado.get('hora')} del {resultado.get('dia_semana')} {resultado.get('fecha')}."
    if nombre == "estado_sistema":
        s = resultado.get("sistema", {})
        partes = []
        if s.get("ram_usada_pct") is not None:
            partes.append(f"RAM al {s['ram_usada_pct']} por ciento")
        if s.get("disco_libre_pct") is not None:
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
        return "Apagando en un minuto. Di «cancela el apagado» si te arrepientes."
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
    """Filtra a los parámetros que la función acepta y convierte tipos simples."""
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
                if isinstance(valor, str):
                    valor = valor.strip().lower() in ("1", "true", "si", "sí", "yes")
                else:
                    valor = bool(valor)
            elif "str" in anotacion:
                valor = str(valor)
        except (TypeError, ValueError):
            pass
        limpios[nombre] = valor
    return limpios


def ejecutar(nombre: str, args: dict[str, Any], confirmado: bool = False) -> dict[str, Any]:
    """Ejecuta una acción del registro. Devuelve siempre un dict con 'ok'."""
    if nombre not in ACCIONES:
        return {"ok": False, "error": f"Acción desconocida: {nombre}"}

    func = ACCIONES[nombre]
    limpios = _normalizar_args(func, args or {})
    if nombre in ("ejecutar_comando", "apagar_pc") and confirmado:
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
    except Exception as exc:  # noqa: BLE001 - nunca tumbar el servidor por una acción
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
        # Limpia las caducadas
        for clave in [k for k, v in PENDIENTES.items() if v["expira"] < time.time()]:
            PENDIENTES.pop(clave, None)
        PENDIENTES[token] = {"accion": nombre, "args": args, "expira": time.time() + TOKEN_TTL}

    motivos = {
        "ejecutar_comando": "Voy a ejecutar un comando en tu sistema.",
        "apagar_pc": "Voy a apagar el equipo.",
    }
    detalle = args.get("comando", "") if nombre == "ejecutar_comando" else ""
    return {
        "necesita_confirmacion": True,
        "token": token,
        "accion": nombre,
        "args": args,
        "mensaje": motivos.get(nombre, f"Voy a ejecutar {nombre}."),
        "detalle": detalle,
        "expira_en": TOKEN_TTL,
        "frase": (motivos.get(nombre, "") + " " + detalle).strip(),
    }


def confirmar(token: str) -> dict[str, Any]:
    with PENDIENTES_LOCK:
        pendiente = PENDIENTES.pop(token or "", None)
    if not pendiente:
        return {"ok": False, "error": "Ese permiso ya caducó o no existe."}
    if pendiente["expira"] < time.time():
        return {"ok": False, "error": "El permiso caducó. Pídemelo otra vez."}
    return ejecutar(pendiente["accion"], pendiente["args"], confirmado=True)


# --------------------------------------------------------------------------- #
# Manipulación de la conversación
# --------------------------------------------------------------------------- #
def manejar_chat(texto: str) -> dict[str, Any]:
    texto = (texto or "").strip()
    if not texto:
        return {"ok": False, "error": "Texto vacío."}

    hablado = bool(get_config("voz.motor", "auto") != "ninguno")
    plan = interpretar(texto, HISTORIAL)
    with HISTORIAL_LOCK:
        HISTORIAL.append({"role": "user", "content": texto})
        HISTORIAL[:] = HISTORIAL[-40:]

    salida: dict[str, Any] = {"ok": True, "motor": plan.get("motor"), "proveedor": proveedor_activo()}
    if plan.get("aviso"):
        salida["aviso"] = plan["aviso"]

    if plan["tipo"] == "error":
        salida.update({"tipo": "respuesta", "texto": plan["texto"]})
        if hablado:
            voz.hablar("Hubo un problema con el cerebro.")
        return salida

    if plan["tipo"] == "respuesta":
        texto_resp = plan["texto"]
        salida.update({"tipo": "respuesta", "texto": texto_resp})
        with HISTORIAL_LOCK:
            HISTORIAL.append({"role": "assistant", "content": texto_resp})
        if hablado:
            voz.hablar(texto_resp)
        return salida

    # Acciones
    resultados: list[dict[str, Any]] = []
    pendientes: list[dict[str, Any]] = []
    frases: list[str] = []
    for item in plan["acciones"][:6]:
        nombre = item["accion"]
        args = item.get("args") or {}
        if nombre not in ACCIONES:
            resultados.append({"ok": False, "accion": nombre, "error": f"No existe la acción «{nombre}»."})
            continue
        # Se necesita confirmación si la acción es delicada y no viene aprobada
        if nombre in DELICADAS:
            ya_aprobada = bool(args.pop("confirmado", False) or args.pop("confirmar", False))
            if not ya_aprobada:
                pendientes.append(crear_pendiente(nombre, args))
                continue
        resultados.append(ejecutar(nombre, args))

    salida.update({"tipo": "acciones", "resultados": resultados, "pendientes": pendientes})

    for r in resultados:
        if r.get("frase"):
            frases.append(r["frase"])
    if pendientes:
        frases.append(pendientes[0]["frase"] + " ¿Confirmas?")

    texto_final = " ".join(frases).strip()
    salida["texto"] = texto_final
    with HISTORIAL_LOCK:
        HISTORIAL.append({"role": "assistant", "content": "[acciones] " + texto_final})
    if hablado and texto_final:
        voz.hablar(texto_final)
    return salida


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = f"Jarvis/{VERSION}"
    protocol_version = "HTTP/1.1"

    # --- helpers ----------------------------------------------------------- #
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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

    def log_message(self, formato: str, *args: Any) -> None:  # silencia el log por defecto
        pass

    # --- rutas ------------------------------------------------------------- #
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        ruta = urlparse(self.path).path
        try:
            if ruta in ("/", "/index.html"):
                self._archivo(UI_DIR / "index.html")
            elif ruta == "/api/estado":
                self._json({
                    "ok": True,
                    "version": VERSION,
                    "nombre": get_config("nombre", "Jarvis"),
                    "sistema": info_sistema(),
                    "cerebro": proveedor_activo(),
                    "modelo": get_config("cerebro.modelo") or "",
                    "voz": get_config("voz.motor", "auto"),
                    "acciones": sorted(ACCIONES),
                    "escucha": voz.escucha_disponible(),
                    "providers": ["ninguno", "openai", "anthropic", "gemini", "ollama"],
                })
            elif ruta == "/api/config":
                datos = json.loads(json.dumps(config()))
                clave = datos.get("cerebro", {}).get("api_key") or ""
                if clave:
                    datos["cerebro"]["api_key"] = "•" * 8 + clave[-4:]
                    datos["cerebro"]["api_key_guardada"] = True
                self._json({"ok": True, "config": datos, "ruta": str(CONFIG_PATH)})
            elif ruta == "/api/historial":
                with HISTORIAL_LOCK:
                    self._json({"ok": True, "historial": HISTORIAL[-30:]})
            elif ruta == "/api/voces":
                self._json({"ok": True, "voces": voz.voces_disponibles()})
            elif ruta == "/api/escucha":
                self._json({"ok": True, **voz.escucha_disponible()})
            elif ruta == "/api/escuchar":
                largo = int(urlparse(self.path).query.split("segundos=")[-1]) if "segundos=" in self.path else 6
                self._json({"ok": True, **voz.escuchar_una_vez(min(max(largo, 2), 20))})
            elif ruta.startswith("/api/accion/"):
                # Ejecuta una acción directa (botones de la UI)
                nombre = ruta.rsplit("/", 1)[-1]
                self._json(ejecutar(nombre, {}))
            elif ruta.startswith("/ui/"):
                relativa = ruta[len("/ui/"):].lstrip("/")
                candidato = (UI_DIR / relativa).resolve()
                if UI_DIR.resolve() in candidato.parents or candidato.parent == UI_DIR.resolve():
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

    def do_POST(self) -> None:  # noqa: N802
        ruta = urlparse(self.path).path
        try:
            cuerpo = self._cuerpo()
            if ruta == "/api/chat":
                self._json(manejar_chat(cuerpo.get("texto", "")))
            elif ruta == "/api/confirmar":
                self._json(confirmar(cuerpo.get("token", "")))
            elif ruta == "/api/accion":
                resultado = ejecutar(cuerpo.get("accion", ""), cuerpo.get("args") or {})
                if get_config("voz.motor", "auto") != "ninguno" and resultado.get("frase"):
                    voz.hablar(resultado["frase"])
                self._json(resultado)
            elif ruta == "/api/config":
                datos = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                nuevos = cuerpo.get("config") or {}
                for seccion, valores in nuevos.items():
                    if isinstance(valores, dict) and isinstance(datos.get(seccion), dict):
                        for clave, valor in valores.items():
                            # No sobrescribir la clave con la máscara de la UI
                            if seccion == "cerebro" and clave == "api_key" and set(str(valor)) == {"•"}:
                                continue
                            datos[seccion][clave] = valor
                guardar_config(datos)
                self._json({"ok": True, "mensaje": "Configuración guardada."})
            elif ruta == "/api/config/clave":
                # Guarda solo la API key, sin exponer la anterior
                anterior = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                anterior.setdefault("cerebro", {})["api_key"] = str(cuerpo.get("api_key", "")).strip()
                if cuerpo.get("proveedor"):
                    anterior["cerebro"]["proveedor"] = cuerpo["proveedor"]
                if cuerpo.get("modelo") is not None:
                    anterior["cerebro"]["modelo"] = str(cuerpo["modelo"]).strip()
                guardar_config(anterior)
                self._json({"ok": True, "proveedor": proveedor_activo()})
            elif ruta == "/api/hablar":
                self._json(voz.hablar(cuerpo.get("texto", ""), bloquear=True))
            elif ruta == "/api/historial/limpiar":
                with HISTORIAL_LOCK:
                    HISTORIAL.clear()
                self._json({"ok": True})
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
    parser.add_argument("--host", default="127.0.0.1", help="127.0.0.1 (solo tu PC) o 0.0.0.0")
    args = parser.parse_args()

    puerto = args.puerto or int(get_config("puerto", 8765))
    servidor = ThreadingHTTPServer((args.host, puerto), Handler)
    servidor.daemon_threads = True

    log(f"Jarvis {VERSION} en http://{args.host}:{puerto}")
    log(f"  cerebro: {proveedor_activo()}   acciones: {len(ACCIONES)}   config: {CONFIG_PATH}")
    if get_config("voz.motor", "auto") != "ninguno":
        voces = voz.voces_disponibles()
        log(f"  voces instaladas: {len(voces)}" + (f" (ej. {voces[0]})" if voces else " — instala una voz en Windows si no habla"))
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        log("Apagando Jarvis.")
        servidor.shutdown()


if __name__ == "__main__":
    main()
