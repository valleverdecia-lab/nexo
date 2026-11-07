"""
Pruebas de Jarvis — sin dependencias y sin tocar tu equipo.

    python3 jarvis/test_jarvis.py

Incluye un Ollama falso (servidor HTTP local) para verificar el streaming SSE,
las conversaciones en SQLite y el flujo de confirmación de acciones.
"""
from __future__ import annotations

import json
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import acciones  # noqa: E402,F401  (registra el catálogo)
import chats  # noqa: E402
import core  # noqa: E402
import llm  # noqa: E402
from core import ACCIONES, Denegado  # noqa: E402

fallos: list[str] = []
pruebas = 0


def check(nombre: str, condicion: bool, detalle: str = "") -> None:
    global pruebas
    pruebas += 1
    if condicion:
        print(f"  ok   {nombre}")
    else:
        print(f"  FALLA {nombre}  {detalle}")
        fallos.append(nombre)


def espera_denegado(nombre: str, fn, *args, **kwargs) -> None:
    try:
        fn(*args, **kwargs)
    except Denegado:
        check(nombre, True)
    except Exception as exc:  # noqa: BLE001
        check(nombre, False, f"excepción inesperada: {type(exc).__name__}: {exc}")
    else:
        check(nombre, False, "no se lanzó Denegado")


# --------------------------------------------------------------------------- #
print("\n[1] Guardas de comandos")
for cmd in ["format c:", "diskpart", "bcdedit /set", "rm -rf /", "del /f /s /q c:\\",
            "vssadmin delete shadows", "dd if=/dev/zero of=/dev/sda"]:
    ok, motivo = core.comando_permitido(cmd)
    check(f"bloquea «{cmd}»", not ok, motivo)
for cmd in ["dir", "echo hola", "ipconfig", "python --version", "notepad"]:
    ok, _ = core.comando_permitido(cmd)
    check(f"permite «{cmd}»", ok)

# --------------------------------------------------------------------------- #
print("\n[2] Carpetas permitidas")
with tempfile.TemporaryDirectory() as tmp:
    documentos = (Path.home() / "Documents").resolve()
    core.set_config("seguridad.carpetas_permitidas", [str(documentos), str(Path(tmp))])
    check("alias documentos", core.resolver_ruta("documentos") == documentos)
    check("ruta absoluta permitida", core.resolver_ruta(tmp) == Path(tmp).resolve())
    espera_denegado("rechaza fuera", core.resolver_ruta, "C:\\Windows\\System32")
    espera_denegado("rechaza traversal", core.resolver_ruta, "../../etc/passwd")
    espera_denegado("rechaza vacío", core.resolver_ruta, "  ")
    original = json.loads((core.BASE_DIR / "config.json").read_text(encoding="utf-8"))
    original["seguridad"]["carpetas_permitidas"] = [
        "%USERPROFILE%\\Documents", "%USERPROFILE%\\Desktop", "%USERPROFILE%\\Downloads"]
    core.guardar_config(original)

# --------------------------------------------------------------------------- #
print("\n[3] Intérprete sin IA")
casos = [
    ("qué hora es", "fecha_hora"), ("cuánta ram estoy usando", "estado_sistema"),
    ("captura la pantalla", "captura_pantalla"), ("abre chrome", "abrir_app"),
    ("abre la calculadora", "abrir_app"), ("pon el volumen al 40", "volumen"),
    ("silencia el volumen", "volumen"), ("temporizador de 5 minutos", "temporizador"),
    ("apunta comprar café mañana", "crear_nota"), ("mis notas", "leer_notas"),
    ("lista el escritorio", "listar_archivos"), ("bloquea la pc", "bloquear_pc"),
    ("apaga la pc", "apagar_pc"), ("busca en google recetas de pan", "buscar_web"),
]
for frase, esperada in casos:
    plan = acciones.interpretar_local(frase)
    check(f"«{frase}» → {esperada}", plan.get("accion") == esperada, str(plan))
check("saludo responde", "respuesta" in acciones.interpretar_local("hola"))
check("volumen parsea número", acciones.interpretar_local("pon el volumen al 40")["args"]["nivel"] == 40)

# --------------------------------------------------------------------------- #
print("\n[4] Registro de acciones y guardas")
for nombre in ["abrir_app", "abrir_web", "estado_sistema", "captura_pantalla", "volumen",
               "listar_archivos", "leer_archivo", "escribir_archivo", "crear_nota",
               "temporizador", "ejecutar_comando", "apagar_pc"]:
    check(f"registrada {nombre}", nombre in ACCIONES)
try:
    acciones.apagar_pc()
except Denegado:
    check("apagar_pc sin confirmar se niega", True)
else:
    check("apagar_pc sin confirmar se niega", False)
espera_denegado("app no permitida", acciones.abrir_app, "definitely-not-an-app")
espera_denegado("comando sin confirmar", acciones.ejecutar_comando, "echo hola")

# --------------------------------------------------------------------------- #
print("\n[5] Servidor: validación y permisos")
import server  # noqa: E402

limpios = server._normalizar_args(ACCIONES["volumen"], {"nivel": "35", "sobra": "x"})
check("convierte a int", limpios.get("nivel") == 35, str(limpios))
check("descarta sobrantes", "sobra" not in limpios)
check("acción inventada", server.ejecutar("no_existe", {})["ok"] is False)
res = server.ejecutar("abrir_app", {"app": "definitely-not-an-app"})
check("abrir_app inválida", res["ok"] is False and "permitidas" in res.get("error", ""))
pend = server.crear_pendiente("ejecutar_comando", {"comando": "echo hola"})
check("crear_pendiente da token", bool(pend.get("token")) and pend["necesita_confirmacion"])
check("token falso no ejecuta", server.confirmar("token-falso")["ok"] is False)
check("fecha_hora con frase", "Son las" in server.ejecutar("fecha_hora", {}).get("frase", ""))

# --------------------------------------------------------------------------- #
print("\n[6] Conversaciones en SQLite")
conv = chats.crear("Prueba automática")
check("crear conversación", bool(conv["id"]))
chats.añadir_mensaje(conv["id"], "user", "hola jarvis")
chats.añadir_mensaje(conv["id"], "assistant", "hola, ¿qué necesitas?")
check("guarda mensajes", len(chats.mensajes(conv["id"])) == 2)
check("historial para modelo", chats.historial_para_modelo(conv["id"])[-1]["role"] == "assistant")
check("aparece en la lista", any(c["id"] == conv["id"] for c in chats.listar()))
check("renombrar", chats.renombrar(conv["id"], "Otro título") and chats.obtener(conv["id"])["titulo"] == "Otro título")
chats.renombrar_si_es_nueva(conv["id"], "no debería cambiar")
check("no renombra si ya tiene título", chats.obtener(conv["id"])["titulo"] == "Otro título")
resultados = chats.buscar("jarvis")
check("búsqueda encuentra", any(r["conversacion"] == conv["id"] for r in resultados), str(resultados[:2]))
chats.borrar_mensajes_desde(conv["id"], 10 ** 9)
check("borrar desde el final no rompe", len(chats.mensajes(conv["id"])) == 2)
check("borrar conversación", chats.borrar(conv["id"]) and chats.obtener(conv["id"]) is None)

# --------------------------------------------------------------------------- #
print("\n[7] Streaming con un Ollama falso")

RESPUESTAS: list[str] = []


class OllamaFalso(BaseHTTPRequestHandler):
    """Imita /api/tags y /api/chat con NDJSON, como Ollama de verdad."""

    def log_message(self, *a):  # silencio
        pass

    def _json(self, datos, estado=200):
        cuerpo = json.dumps(datos).encode()
        self.send_response(estado)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.path == "/api/tags":
            self._json({"models": [{"name": "llama3.2"}, {"name": "qwen2.5:3b"}]})
        else:
            self._json({"error": "no"}, 404)

    def do_POST(self):
        largo = int(self.headers.get("Content-Length") or 0)
        cuerpo = json.loads(self.rfile.read(largo) or b"{}")
        if not self.path.startswith("/api/chat"):
            return self._json({"error": "no"}, 404)
        sistema = cuerpo["messages"][0]["content"] if cuerpo["messages"] else ""
        if "título de 4 a 7 palabras" in sistema:
            respuesta = "Titulo de prueba"   # petición de título: no consume la cola
        else:
            respuesta = RESPUESTAS.pop(0) if RESPUESTAS else "respuesta por defecto"
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        for palabra in respuesta.split(" "):
            self.wfile.write((json.dumps({"message": {"role": "assistant", "content": palabra + " "},
                                          "done": False}) + "\n").encode())
            self.wfile.flush()
        self.wfile.write((json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}) + "\n").encode())


falso = ThreadingHTTPServer(("127.0.0.1", 0), OllamaFalso)
puerto_falso = falso.server_address[1]
threading.Thread(target=falso.serve_forever, daemon=True).start()

core.set_config("cerebro.proveedor", "ollama")
core.set_config("cerebro.ollama_url", f"http://127.0.0.1:{puerto_falso}")
core.set_config("cerebro.modelo", "llama3.2")

check("proveedor activo es ollama", llm.proveedor_activo() == "ollama")
modelos = llm.listar_modelos()
check("lista modelos del servidor", modelos["ok"] and "llama3.2" in modelos["modelos"], str(modelos))
check("estado_ollama activo", llm.estado_ollama()["activo"])

texto = "".join(llm.stream([{"role": "user", "content": "hola"}]))
check("stream devuelve texto", texto.strip() == "respuesta por defecto", repr(texto[:80]))

# Turno completo con herramientas propuestas por el modelo
RESPUESTAS.append('{"accion": "fecha_hora", "args": {}}')
RESPUESTAS.append("Son las tantas y todo bien.")
conv2 = chats.crear("Con herramientas")
eventos = []
for bloque in server.turno_stream(conv2["id"], "dime la hora y comenta algo"):
    cadena = bloque.decode()
    evento = cadena[7:cadena.index("\n")]
    datos = json.loads(cadena.split("data: ", 1)[1].strip())
    eventos.append((evento, datos))

tipos = [e for e, _ in eventos]
check("emite meta", "meta" in tipos, str(tipos))
check("emite acciones", "acciones" in tipos, str(tipos))
check("emite fin", "fin" in tipos, str(tipos))
acciones_emitidas = next(d for e, d in eventos if e == "acciones")
check("ejecutó fecha_hora", any(r["accion"] == "fecha_hora" and r["ok"] for r in acciones_emitidas["resultados"]),
      str(acciones_emitidas)[:200])
final = next(d for e, d in eventos if e == "fin")
check("respuesta final con comentario del modelo", "todo bien" in final["texto"], final["texto"][:120])
check("se guardó el turno en SQLite", len(chats.mensajes(conv2["id"])) >= 2,
      str(len(chats.mensajes(conv2["id"]))))

# El modelo pide algo delicado: debe quedar pendiente, no ejecutado
RESPUESTAS.append('{"accion": "ejecutar_comando", "args": {"comando": "echo hola"}}')
conv3 = chats.crear("Delicado")
pendientes = None
for bloque in server.turno_stream(conv3["id"], "por favor ejecuta el comando echo hola en el sistema"):
    cadena = bloque.decode()
    if cadena.startswith("event: acciones"):
        pendientes = json.loads(cadena.split("data: ", 1)[1].strip())["pendientes"]
check("comando del modelo queda pendiente", bool(pendientes), str(pendientes))
# El modelo intenta autoaprobarse: no debe servir de nada
RESPUESTAS.append('{"accion": "ejecutar_comando", "args": {"comando": "echo hola", "confirmado": true}}')
conv4b = chats.crear("Autoaprobacion")
pend_auto = None
for bloque in server.turno_stream(conv4b["id"], "hazme el favor de lanzar echo hola en la shell"):
    cadena = bloque.decode()
    if cadena.startswith("event: acciones"):
        pend_auto = json.loads(cadena.split("data: ", 1)[1].strip())
check("el modelo no puede autoaprobarse",
      pend_auto and pend_auto["pendientes"] and not pend_auto["resultados"], str(pend_auto)[:200])
chats.borrar(conv4b["id"])
chats.borrar(conv2["id"])
chats.borrar(conv3["id"])

# Sin modelo responde con pista, no con error
core.set_config("cerebro.proveedor", "ninguno")
final_sin = None
conv4 = chats.crear("Sin modelo")
for bloque in server.turno_stream(conv4["id"], "cuéntame un chiste largo sobre pingüinos"):
    cadena = bloque.decode()
    if cadena.startswith("event: fin"):
        final_sin = json.loads(cadena.split("data: ", 1)[1].strip())
check("sin modelo da respuesta útil", final_sin and "sin modelo" in final_sin["texto"].lower(),
      str(final_sin)[:150])
chats.borrar(conv4["id"])

falso.shutdown()
core.set_config("cerebro.proveedor", "ollama")
core.set_config("cerebro.ollama_url", "http://localhost:11434")

# --------------------------------------------------------------------------- #
print("\n[8] Prompt y extracción de acciones")
import prompt as prompt_mod  # noqa: E402

check("system prompt menciona herramientas", "abrir_app" in prompt_mod.system_prompt())
check("extrae acción simple", prompt_mod.extraer_accion('{"accion": "fecha_hora"}') is not None)
check("extrae acciones múltiples", prompt_mod.extraer_accion('{"acciones": []}') is not None)
check("ignora texto normal", prompt_mod.extraer_accion("Hola, ¿qué tal?") is None)
check("ignora JSON que no es acción", prompt_mod.extraer_accion('{"foo": 1}') is None)

# --------------------------------------------------------------------------- #
print("\n[9] Compatibilidad del modo sin streaming")
estado_resp = server.manejar_chat("qué hora es")
check("manejar_chat funciona", estado_resp.get("ok") and estado_resp.get("tipo") in ("acciones", "respuesta"), str(estado_resp)[:200])

# --------------------------------------------------------------------------- #
print(f"\n{'=' * 62}")
if fallos:
    print(f"{len(fallos)} de {pruebas} pruebas FALLARON:")
    for f in fallos:
        print(f"  - {f}")
    sys.exit(1)
print(f"{pruebas} pruebas, todas en verde.")
