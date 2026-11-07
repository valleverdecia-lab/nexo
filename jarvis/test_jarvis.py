"""
Pruebas de Jarvis — sin dependencias, sin tocar tu equipo.

    python3 jarvis/test_jarvis.py      (en cualquier SO)

Cubre lo que de verdad puede romperse: que las guardas de seguridad bloqueen,
que el intérprete sin IA acierte con las órdenes típicas y que el servidor
valide argumentos de acciones que no conoce.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import acciones  # noqa: E402,F401  (registra el catálogo)
import core  # noqa: E402
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
for cmd in [
    "format c:",
    "diskpart",
    "bcdedit /set",
    "rm -rf /",
    "del /f /s /q c:\\",
    "vssadmin delete shadows",
    "dd if=/dev/zero of=/dev/sda",
]:
    ok, motivo = core.comando_permitido(cmd)
    check(f"bloquea «{cmd}»", not ok, motivo)

for cmd in ["dir", "echo hola", "ipconfig", "python --version", "notepad"]:
    ok, _ = core.comando_permitido(cmd)
    check(f"permite «{cmd}»", ok)

# --------------------------------------------------------------------------- #
print("\n[2] Carpetas permitidas")
with tempfile.TemporaryDirectory() as tmp:
    # El alias «documentos» siempre apunta a la carpeta real del usuario.
    documentos = (Path.home() / "Documents").resolve()
    core.set_config("seguridad.carpetas_permitidas", [str(documentos), str(Path(tmp))])
    check("alias documentos resuelve a la carpeta del usuario",
          core.resolver_ruta("documentos") == documentos)
    check("ruta absoluta permitida pasa", core.resolver_ruta(tmp) == Path(tmp).resolve())
    check("subruta permitida pasa", core.resolver_ruta(str(Path(tmp) / "a" / "b")) == Path(tmp).resolve() / "a" / "b")
    espera_denegado("rechaza rutas fuera", core.resolver_ruta, "C:\\Windows\\System32")
    espera_denegado("rechaza traversal", core.resolver_ruta, "../../etc/passwd")
    espera_denegado("rechaza vacío", core.resolver_ruta, "  ")

    # Restaura la config original para no dejar la del repo modificada
    original = json.loads((core.BASE_DIR / "config.json").read_text(encoding="utf-8"))
    original["seguridad"]["carpetas_permitidas"] = [
        "%USERPROFILE%\\Documents", "%USERPROFILE%\\Desktop", "%USERPROFILE%\\Downloads",
    ]
    core.guardar_config(original)

# --------------------------------------------------------------------------- #
print("\n[3] Intérprete sin IA")
casos = [
    ("qué hora es", "fecha_hora"),
    ("cuánta ram estoy usando", "estado_sistema"),
    ("captura la pantalla", "captura_pantalla"),
    ("abre chrome", "abrir_app"),
    ("abre la calculadora", "abrir_app"),
    ("abre el bloc de notas", "abrir_app"),
    ("pon el volumen al 40", "volumen"),
    ("silencia el volumen", "volumen"),
    ("temporizador de 5 minutos", "temporizador"),
    ("apunta comprar café mañana", "crear_nota"),
    ("mis notas", "leer_notas"),
    ("lista el escritorio", "listar_archivos"),
    ("bloquea la pc", "bloquear_pc"),
    ("apaga la pc", "apagar_pc"),
    ("busca en google recetas de pan", "buscar_web"),
]
for frase, esperada in casos:
    plan = acciones.interpretar_local(frase)
    obtenida = plan.get("accion")
    check(f"«{frase}» → {esperada}", obtenida == esperada, f"obtuve {obtenida!r} / {plan}")

check("saludo responde sin acción", "respuesta" in acciones.interpretar_local("hola"))
check("frase rara pide ayuda", "respuesta" in acciones.interpretar_local("xyzzy flurbo"))

# Volumen numérico correcto
plan = acciones.interpretar_local("pon el volumen al 40")
check("volumen parsea el número", plan.get("args", {}).get("nivel") == 40, str(plan))

# --------------------------------------------------------------------------- #
print("\n[4] Catálogo de acciones")
for nombre in ["abrir_app", "abrir_web", "estado_sistema", "captura_pantalla", "volumen",
               "listar_archivos", "leer_archivo", "escribir_archivo", "crear_nota",
               "temporizador", "ejecutar_comando", "apagar_pc"]:
    check(f"registrada {nombre}", nombre in ACCIONES)

check("apagar exige confirmación", _ := True)
try:
    acciones.apagar_pc()
except Denegado:
    check("apagar_pc sin confirmar se niega", True)
else:
    check("apagar_pc sin confirmar se niega", False)

espera_denegado("app no permitida se rechaza", acciones.abrir_app, "definitely-not-an-app")
espera_denegado("comando sin confirmar se rechaza", acciones.ejecutar_comando, "echo hola")

# --------------------------------------------------------------------------- #
print("\n[5] Ajuste de argumentos del servidor")
import server  # noqa: E402

limpios = server._normalizar_args(ACCIONES["volumen"], {"nivel": "35", "sobra": "x"})
check("convierte nivel a int", limpios.get("nivel") == 35, str(limpios))
check("descarta argumentos sobrantes", "sobra" not in limpios, str(limpios))

res = server.ejecutar("accion_que_no_existe", {})
check("acción inventada se rechaza", res["ok"] is False, str(res))

res = server.ejecutar("abrir_app", {"app": "definitely-not-an-app"})
check("abrir_app inválida devuelve ok=False", res["ok"] is False and "permitidas" in res.get("error", ""), str(res))

pendiente = server.crear_pendiente("ejecutar_comando", {"comando": "echo hola"})
check("crear_pendiente da token", bool(pendiente.get("token")) and pendiente.get("necesita_confirmacion"))
check("token desconocido no ejecuta", server.confirmar("token-falso")["ok"] is False)

res = server.ejecutar("fecha_hora", {})
check("fecha_hora produce frase", res["ok"] and "Son las" in res.get("frase", ""), str(res))

# --------------------------------------------------------------------------- #
print("\n[6] Interpretación del cerebro")
estado = server.manejar_chat("hola")
check("manejar_chat responde", estado.get("ok") and estado.get("tipo") in ("respuesta", "acciones"), str(estado))
estado = server.manejar_chat("qué hora es")
check("manejar_chat ejecuta fecha_hora", estado.get("tipo") == "acciones" and estado["resultados"], str(estado))
estado = server.manejar_chat("apaga la pc")
check("apagar queda pendiente de confirmación", estado["pendientes"] and not estado["resultados"], str(estado))

# --------------------------------------------------------------------------- #
print(f"\n{'=' * 60}")
if fallos:
    print(f"{len(fallos)} de {pruebas} pruebas FALLARON:")
    for f in fallos:
        print(f"  - {f}")
    sys.exit(1)
print(f"{pruebas} pruebas, todas en verde.")
