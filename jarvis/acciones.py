"""
Jarvis — acciones. Todo lo que Jarvis puede hacer en la máquina, en un solo sitio.

Cada función está decorada con @accion("nombre") y es invocable desde:
  - la UI (vía /api/accion)
  - el cerebro (vía el mismo registro, con validación de argumentos)

Las acciones que tocan el sistema están detrás de core.comando_permitido() y de
las carpetas permitidas: un modelo no puede saltárselas.
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

from core import (
    ACCIONES,
    IS_LINUX,
    IS_MAC,
    IS_WINDOWS,
    Denegado,
    accion,
    comando_permitido,
    get_config,
    info_sistema,
    log,
    resolver_ruta,
)

SEGUNDOS_MAX = 120


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def correr(cmd: list[str] | str, shell: bool = False, timeout: int | None = None,
           capturar: bool = True) -> dict[str, Any]:
    """Ejecuta un comando con timeout y sin ventana negra en Windows."""
    if isinstance(cmd, str):
        ok, motivo = comando_permitido(cmd)
        if not ok:
            raise Denegado(motivo)

    espera = min(timeout or get_config("seguridad.segundos_maximos_por_comando", 120) or 120, 600)
    extras: dict[str, Any] = {}
    if IS_WINDOWS:
        extras["creationflags"] = 0x08000000  # CREATE_NO_WINDOW

    try:
        proc = subprocess.run(
            cmd,
            shell=shell,
            capture_output=capturar,
            text=True,
            timeout=espera,
            **extras,
        )
        return {
            "ok": proc.returncode == 0,
            "codigo": proc.returncode,
            "salida": (proc.stdout or "").strip()[:4000],
            "error": (proc.stderr or "").strip()[:2000],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "codigo": -1, "salida": "", "error": f"Tiempo agotado ({espera}s)"}
    except FileNotFoundError as exc:
        return {"ok": False, "codigo": -1, "salida": "", "error": f"No se encontró: {exc}"}
    except OSError as exc:
        return {"ok": False, "codigo": -1, "salida": "", "error": str(exc)}


def _ps(script: str, timeout: int = 30) -> dict[str, Any]:
    """PowerShell silencioso (solo Windows)."""
    if not IS_WINDOWS:
        raise Denegado("Esa acción requiere Windows.")
    return correr(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        timeout=timeout,
    )


def _abrir_proceso(cmd: list[str]) -> dict[str, Any]:
    extras: dict[str, Any] = {}
    if IS_WINDOWS:
        extras["creationflags"] = 0x00000008  # DETACHED_PROCESS
    subprocess.Popen(cmd, **extras)
    return {"ok": True, "accion": " ".join(cmd)}


# --------------------------------------------------------------------------- #
# Apps y navegador
# --------------------------------------------------------------------------- #
@accion("abrir_app")
def abrir_app(app: str) -> dict[str, Any]:
    """Abre un programa por nombre (notepad, chrome, code, spotify...)."""
    nombre = (app or "").strip().lower().replace(".exe", "")
    permitidas = [a.lower() for a in (get_config("seguridad.apps_permitidas") or [])]
    if nombre not in permitidas:
        raise Denegado(
            f"«{app}» no está en seguridad.apps_permitidas. "
            f"Permitidas: {', '.join(permitidas[:15])}..."
        )
    if IS_WINDOWS:
        # start resuelve el nombre por el registro y el PATH
        return correr(["cmd", "/c", "start", "", nombre], shell=False, timeout=15)
    if IS_MAC:
        return correr(["open", "-a", nombre], timeout=15)
    return correr([nombre], timeout=15)


@accion("abrir_web")
def abrir_web(url: str) -> dict[str, Any]:
    """Abre una URL en el navegador por defecto."""
    texto = (url or "").strip()
    if not texto:
        raise Denegado("URL vacía.")
    if not texto.startswith(("http://", "https://")):
        texto = "https://" + texto
    if " " in texto:
        texto = "https://www.google.com/search?q=" + urllib.parse.quote(texto)
    webbrowser.open(texto)
    return {"ok": True, "url": texto}


@accion("buscar_web")
def buscar_web(consulta: str) -> dict[str, Any]:
    """Busca en Google (abre el navegador)."""
    url = "https://www.google.com/search?q=" + urllib.parse.quote(consulta or "")
    webbrowser.open(url)
    return {"ok": True, "url": url}


@accion("captura_pantalla")
def captura_pantalla() -> dict[str, Any]:
    """Captura la pantalla, la guarda y devuelve la ruta."""
    destino = resolver_ruta("escritorio") / f"captura-{time.strftime('%Y%m%d-%H%M%S')}.png"
    if IS_WINDOWS:
        script = (
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
            "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"
            "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;"
            "$g=[System.Drawing.Graphics]::FromImage($bmp);"
            "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);"
            f"$bmp.Save('{destino}',[System.Drawing.Imaging.ImageFormat]::Png);"
            f"Write-Output '{destino}'"
        )
        res = _ps(script, timeout=25)
        if not res["ok"]:
            return res
    elif IS_MAC:
        res = correr(["screencapture", "-x", str(destino)], timeout=20)
        if not res["ok"]:
            return res
    else:
        herramienta = shutil.which("gnome-screenshot") or shutil.which("scrot") or shutil.which("import")
        if not herramienta:
            raise Denegado("No hay herramienta de captura instalada (gnome-screenshot/scrot/import).")
        res = correr([herramienta, str(destino)], timeout=20)
        if not res["ok"]:
            return res
    return {"ok": True, "ruta": str(destino)}


# --------------------------------------------------------------------------- #
# Volumen y multimedia
# --------------------------------------------------------------------------- #
@accion("volumen")
def volumen(nivel: int | str) -> dict[str, Any]:
    """nivel 0-100, o 'subir'/'bajar'/'silenciar'."""
    valor = str(nivel).strip().lower()
    if IS_WINDOWS:
        if valor in ("silenciar", "mute", "silencio"):
            return _ps("(New-Object -ComObject WScript.Shell).SendKeys([char]173)")
        if valor in ("subir", "up", "más", "mas"):
            return _ps("1..5 | ForEach-Object {(New-Object -ComObject WScript.Shell).SendKeys([char]175)}")
        if valor in ("bajar", "down", "menos"):
            return _ps("1..5 | ForEach-Object {(New-Object -ComObject WScript.Shell).SendKeys([char]174)}")
        try:
            objetivo = max(0, min(100, int(float(valor))))
        except ValueError:
            raise Denegado("Nivel de volumen inválido: usa 0-100 o subir/bajar/silenciar.")
        script = (
            "$obj = New-Object -ComObject WScript.Shell;"
            f"$actual = (Get-CimInstance -Namespace root\\cimv2 -ClassName Win32_SoundDevice | Measure-Object).Count;"
            f"Write-Output 'ok'"
        )
        del script  # el COM de volumen no acepta valor absoluto; se aproxima por pasos
        pasos = max(0, round(objetivo / 2))
        return _ps(f"1..{pasos} | ForEach-Object {{(New-Object -ComObject WScript.Shell).SendKeys([char]175)}}")
    if IS_MAC:
        if valor.isdigit():
            return correr(["osascript", "-e", f"set volume output volume {valor}"], timeout=10)
        mapa = {"subir": "set volume output volume ((output volume of (get volume settings)) + 10)",
                "bajar": "set volume output volume ((output volume of (get volume settings)) - 10)",
                "silenciar": "set volume with output muted"}
        if valor not in mapa:
            raise Denegado("Usa 0-100, subir, bajar o silenciar.")
        return correr(["osascript", "-e", mapa[valor]], timeout=10)
    # Linux: pactl / amixer
    if valor.isdigit():
        if shutil.which("pactl"):
            return correr(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{valor}%"], timeout=10)
        if shutil.which("amixer"):
            return correr(["amixer", "-D", "pulse", "sset", "Master", f"{valor}%"], timeout=10)
    elif valor in ("silenciar", "mute"):
        if shutil.which("pactl"):
            return correr(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"], timeout=10)
    raise Denegado("No encontré pactl ni amixer para cambiar el volumen.")


@accion("multimedia")
def multimedia(orden: str) -> dict[str, Any]:
    """play/pause, siguiente, anterior."""
    clave = {"play": 179, "pausa": 179, "pausar": 179, "siguiente": 176, "next": 176,
             "anterior": 177, "prev": 177}.get((orden or "").lower())
    if not clave:
        raise Denegado("Usa play, pausa, siguiente o anterior.")
    if IS_WINDOWS:
        return _ps(f"(New-Object -ComObject WScript.Shell).SendKeys([char]{clave})")
    if IS_MAC:
        mapa = {179: "playpause", 176: "next track", 177: "previous track"}
        return correr(["osascript", "-e", f'tell application "Music" to {mapa[clave]}'], timeout=10)
    if shutil.which("playerctl"):
        mapa = {179: "play-pause", 176: "next", 177: "previous"}
        return correr(["playerctl", mapa[clave]], timeout=10)
    raise Denegado("Instala playerctl para controlar multimedia en Linux.")


# --------------------------------------------------------------------------- #
# Sistema
# --------------------------------------------------------------------------- #
@accion("bloquear_pc")
def bloquear_pc() -> dict[str, Any]:
    if not get_config("seguridad.permitir_bloquear_equipo", True):
        raise Denegado("Bloquear el equipo está desactivado en config.json.")
    if IS_WINDOWS:
        return correr(["rundll32.exe", "user32.dll,LockWorkStation"], timeout=10)
    if IS_MAC:
        return correr(["pmset", "displaysleepnow"], timeout=10)
    if shutil.which("loginctl"):
        return correr(["loginctl", "lock-session"], timeout=10)
    raise Denegado("No sé bloquear en este sistema.")


@accion("apagar_pc")
def apagar_pc(confirmar: bool = False) -> dict[str, Any]:
    if not confirmar:
        raise Denegado("Apagar requiere confirmación explícita (confirmar=true).")
    if not get_config("seguridad.permitir_apagar_equipo", True):
        raise Denegado("Apagar está desactivado en config.json.")
    if IS_WINDOWS:
        return correr(["shutdown", "/s", "/t", "60"], timeout=10)
    if IS_MAC:
        return correr(["osascript", "-e", 'tell app "System Events" to shut down'], timeout=10)
    return correr(["systemctl", "poweroff"], timeout=10)


@accion("cancelar_apagado")
def cancelar_apagado() -> dict[str, Any]:
    if IS_WINDOWS:
        return correr(["shutdown", "/a"], timeout=10)
    return {"ok": True, "aviso": "Solo aplica a Windows."}


@accion("estado_sistema")
def estado_sistema() -> dict[str, Any]:
    return {"ok": True, "sistema": info_sistema()}


@accion("fecha_hora")
def fecha_hora() -> dict[str, Any]:
    ahora = time.localtime()
    return {
        "ok": True,
        "fecha": time.strftime("%Y-%m-%d", ahora),
        "hora": time.strftime("%H:%M", ahora),
        "dia_semana": ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][ahora.tm_wday],
    }


@accion("ejecutar_comando")
def ejecutar_comando(comando: str, confirmado: bool = False) -> dict[str, Any]:
    """Comando de shell. Exige confirmación previa y pasa por todas las guardas."""
    if not confirmado:
        raise Denegado("Un comando de shell necesita tu confirmación en la UI.")
    ok, motivo = comando_permitido(comando)
    if not ok:
        raise Denegado(motivo)
    return correr(comando, shell=True)


# --------------------------------------------------------------------------- #
# Archivos
# --------------------------------------------------------------------------- #
@accion("listar_archivos")
def listar_archivos(ruta: str = "escritorio") -> dict[str, Any]:
    carpeta = resolver_ruta(ruta)
    if not carpeta.exists():
        raise Denegado(f"No existe: {carpeta}")
    if carpeta.is_file():
        raise Denegado("Eso es un archivo, no una carpeta.")
    elementos = []
    for hijo in sorted(carpeta.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))[:300]:
        try:
            elementos.append({
                "nombre": hijo.name,
                "tipo": "carpeta" if hijo.is_dir() else "archivo",
                "tamano_kb": round(hijo.stat().st_size / 1024, 1) if hijo.is_file() else None,
            })
        except OSError:
            continue
    return {"ok": True, "ruta": str(carpeta), "elementos": elementos}


@accion("leer_archivo")
def leer_archivo(ruta: str) -> dict[str, Any]:
    archivo = resolver_ruta(ruta)
    if not archivo.is_file():
        raise Denegado(f"No existe el archivo: {archivo}")
    if archivo.stat().st_size > 2_000_000:
        raise Denegado("El archivo pesa más de 2 MB; no lo leo entero.")
    try:
        return {"ok": True, "ruta": str(archivo), "contenido": archivo.read_text(encoding="utf-8")[:50000]}
    except UnicodeDecodeError:
        raise Denegado("El archivo no es texto (parece binario).")


@accion("escribir_archivo")
def escribir_archivo(ruta: str, contenido: str = "", anadir: bool = False) -> dict[str, Any]:
    archivo = resolver_ruta(ruta)
    archivo.parent.mkdir(parents=True, exist_ok=True)
    modo = "a" if anadir else "w"
    with archivo.open(modo, encoding="utf-8") as fh:
        fh.write(contenido)
    return {"ok": True, "ruta": str(archivo), "bytes": len(contenido.encode("utf-8"))}


@accion("crear_carpeta")
def crear_carpeta(ruta: str) -> dict[str, Any]:
    destino = resolver_ruta(ruta, crear_carpeta=True)
    return {"ok": True, "ruta": str(destino)}


@accion("buscar_archivos")
def buscar_archivos(patron: str, ruta: str = "inicio") -> dict[str, Any]:
    base = resolver_ruta(ruta if ruta != "inicio" else "")
    patron = (patron or "").strip()
    if not patron:
        raise Denegado("Necesito un patrón de búsqueda, por ejemplo *.pdf")
    if "*" not in patron and "?" not in patron:
        patron = f"*{patron}*"
    encontrados = []
    for p in base.rglob(patron):
        if len(encontrados) >= 60:
            break
        try:
            encontrados.append({"ruta": str(p), "tamano_kb": round(p.stat().st_size / 1024, 1) if p.is_file() else None})
        except OSError:
            continue
    return {"ok": True, "base": str(base), "patron": patron, "encontrados": encontrados}


# --------------------------------------------------------------------------- #
# Notas y temporizadores
# --------------------------------------------------------------------------- #
@accion("crear_nota")
def crear_nota(texto: str, titulo: str = "") -> dict[str, Any]:
    from core import NOTAS_PATH

    cuerpo = (texto or "").strip()
    if not cuerpo:
        raise Denegado("La nota está vacía.")
    sello = time.strftime("%Y-%m-%d %H:%M")
    cabecera = f"## {titulo.strip() or sello}\n"
    with NOTAS_PATH.open("a", encoding="utf-8") as fh:
        fh.write(f"\n{cabecera}\n{cuerpo}\n")
    return {"ok": True, "archivo": str(NOTAS_PATH)}


@accion("leer_notas")
def leer_notas() -> dict[str, Any]:
    from core import NOTAS_PATH

    if not NOTAS_PATH.exists():
        return {"ok": True, "contenido": ""}
    return {"ok": True, "contenido": NOTAS_PATH.read_text(encoding="utf-8")[-20000:]}


_TEMPORIZADORES: dict[str, float] = {}


@accion("temporizador")
def temporizador(segundos: int, etiqueta: str = "") -> dict[str, Any]:
    import threading

    try:
        total = int(segundos)
    except (TypeError, ValueError):
        raise Denegado("Los segundos deben ser un número entero.")
    if not 1 <= total <= 86400:
        raise Denegado("El temporizador debe ir de 1 segundo a 24 horas.")
    clave = (etiqueta or f"t{time.time()}").strip()

    def _avisar():
        time.sleep(total)
        aviso = f"⏰ Temporizador {clave} terminado ({total}s)"
        log(aviso)
        try:
            if IS_WINDOWS:
                _ps(
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    f"[System.Windows.Forms.MessageBox]::Show('{aviso}','Jarvis') | Out-Null"
                )
            elif IS_MAC:
                correr(["osascript", "-e", f'display notification "{aviso}" with title "Jarvis"'])
        except Exception:
            pass
        _TEMPORIZADORES.pop(clave, None)

    threading.Thread(target=_avisar, daemon=True).start()
    _TEMPORIZADORES[clave] = time.time() + total
    return {"ok": True, "etiqueta": clave, "segundos": total}


# --------------------------------------------------------------------------- #
# Intérprete de comandos en lenguaje natural (sin IA)
# --------------------------------------------------------------------------- #
import re  # noqa: E402


def _normalizar(texto: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", (texto or "").lower().strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t)


APP_SINONIMOS = {
    "calculadora": "calc", "calc": "calc",
    "bloc de notas": "notepad", "notepad": "notepad", "notas rapidas": "notepad",
    "paint": "mspaint", "explorador": "explorer", "archivos": "explorer",
    "codigo": "code", "visual studio code": "code", "vscode": "code",
    "chrome": "chrome", "google chrome": "chrome",
    "firefox": "firefox", "edge": "msedge", "spotify": "spotify",
    "discord": "discord", "steam": "steam", "terminal": "wt",
    "cmd": "cmd", "powershell": "powershell", "task manager": "taskmgr",
    "administrador de tareas": "taskmgr", "panel de control": "control",
    "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
    "outlook": "outlook", "correo": "outlook", "vlc": "vlc",
}


def interpretar_local(texto: str) -> dict[str, Any]:
    """
    Motor sin IA. Devuelve {accion, args} o {respuesta} para hablar.

    Es el plan B cuando no hay API key: entiende ~40 frases típicas y responde
    al resto con una lista de lo que sí sabe hacer.
    """
    t = _normalizar(texto)
    if not t:
        return {"respuesta": "No te he oído nada."}

    # Saludos / charla mínima
    if re.fullmatch(r"(hola|hey|buenas|buenos dias|buenas tardes|buenas noches|que tal)[!. ]*", t):
        return {"respuesta": "Hola. ¿Qué necesitas?"}
    if re.fullmatch(r"(gracias|muchas gracias|thanks)[!. ]*", t):
        return {"respuesta": "A ti."}
    if re.fullmatch(r"(adios|chao|hasta luego|nos vemos)[!. ]*", t):
        return {"respuesta": "Hasta luego."}
    if "quien eres" in t or "como te llamas" in t:
        return {"respuesta": "Soy Jarvis, tu asistente local. Corro en tu PC, sin enviar nada a la nube salvo las peticiones que tú hagas al modelo."}
    if "que puedes hacer" in t or "ayuda" == t or "comandos" in t:
        return {"respuesta": "Puedo abrir apps y webs, buscar, capturar la pantalla, cambiar el volumen, "
                            "leer y escribir archivos en tus carpetas, crear notas, poner temporizadores, "
                            "ver CPU/RAM/batería, bloquear o apagar el equipo, y ejecutar comandos con tu permiso."}

    # Hora y fecha
    if "hora" in t and "temporizador" not in t:
        return {"accion": "fecha_hora", "args": {}}
    if "fecha" in t or "que dia es" in t:
        return {"accion": "fecha_hora", "args": {}}

    # Estado del sistema
    if any(k in t for k in ("ram", "memoria", "cpu", "bateria", "disco", "estado del sistema", "recursos")):
        return {"accion": "estado_sistema", "args": {}}

    # Volumen
    if "volumen" in t or "silencio" in t or t.strip() in ("mute", "silenciar"):
        if "silenci" in t or t.strip() == "mute":
            return {"accion": "volumen", "args": {"nivel": "silenciar"}}
        m = re.search(r"(\d{1,3})\s*(?:%|por ?ciento)?", t)
        if m and 0 <= int(m.group(1)) <= 100:
            return {"accion": "volumen", "args": {"nivel": int(m.group(1))}}
        if any(k in t for k in ("sube", "subir", "mas alto", "más alto")):
            return {"accion": "volumen", "args": {"nivel": "subir"}}
        if any(k in t for k in ("baja", "bajar", "menos")):
            return {"accion": "volumen", "args": {"nivel": "bajar"}}
        return {"accion": "volumen", "args": {"nivel": "subir"}}

    # Multimedia
    if any(k in t for k in ("pausa", "play", "reproduce", "siguiente cancion", "siguiente tema", "cancion anterior")):
        orden = "play"
        if "pausa" in t or "para" in t:
            orden = "pausa"
        elif "siguiente" in t:
            orden = "siguiente"
        elif "anterior" in t:
            orden = "anterior"
        return {"accion": "multimedia", "args": {"orden": orden}}

    # Bloquear / apagar
    if "bloquea" in t and ("pc" in t or "equipo" in t or "pantalla" in t or "sesion" in t):
        return {"accion": "bloquear_pc", "args": {}}
    if "apaga" in t and ("pc" in t or "equipo" in t or "computadora" in t or "ordenador" in t):
        return {"accion": "apagar_pc", "args": {"confirmar": False}}  # la UI pedirá confirmación
    if "cancela" in t and "apag" in t:
        return {"accion": "cancelar_apagado", "args": {}}

    # Captura
    if "captura" in t or "screenshot" in t or "pantallazo" in t:
        return {"accion": "captura_pantalla", "args": {}}

    # Temporizador: "temporizador de 5 minutos", "avísame en 30 segundos"
    m = re.search(r"(\d+)\s*(segundo|minuto|hora)", t)
    if m and ("temporizador" in t or "avisa" in t or "avisame" in t or "recuerdame en" in t):
        cantidad = int(m.group(1))
        unidad = m.group(2)
        segundos = cantidad * {"segundo": 1, "minuto": 60, "hora": 3600}[unidad]
        return {"accion": "temporizador", "args": {"segundos": segundos, "etiqueta": texto[:40]}}

    # Notas
    if t.startswith("nota") or "apunta" in t or "anota" in t:
        cuerpo = re.sub(r"^(nota|apunta|anota)( que)?[:\s]*", "", texto, flags=re.I).strip()
        if cuerpo:
            return {"accion": "crear_nota", "args": {"texto": cuerpo}}
    if "mis notas" in t or "lee las notas" in t:
        return {"accion": "leer_notas", "args": {}}

    # Desktop se resuelve después de "abre" (orden importante: "abre chrome" y
    # "abre la calculadora" caen en apps, no en carpetas).
    m = re.search(r"(?:lista|muestra)\s+(?:el\s+|lo que hay en\s+)?(?:la\s+)?(?:carpeta\s+)?(escritorio|documentos|descargas|inicio|home)", t)
    if m or re.search(r"que hay en\s+(?:la\s+)?(escritorio|documentos|descargas)", t):
        objetivo = m.group(1) if m else re.search(r"que hay en\s+(?:la\s+)?(\w+)", t).group(1)
        return {"accion": "listar_archivos", "args": {"ruta": objetivo}}
    m = re.search(r"busca\s+(?:el\s+)?(?:archivo\s+)?(.+?)\s+en\s+(escritorio|documentos|descargas|inicio)", t)
    if m:
        return {"accion": "buscar_archivos", "args": {"patron": m.group(1), "ruta": m.group(2)}}
    m = re.search(r"(?:lee|abre)\s+(?:el\s+)?(?:archivo\s+)?(.+\.\w{1,5})\s*(?:en\s+(escritorio|documentos|descargas))?", t)
    if m:
        ruta = m.group(1)
        if m.group(2):
            ruta = f"{m.group(2)}/{ruta}"
        return {"accion": "leer_archivo", "args": {"ruta": ruta}}

    # Apps
    m = re.search(r"(?:abre|abrir|lanza|ejecuta|inicia)\s+(?:la\s+|el\s+|una\s+)?(?:app\s+|aplicacion\s+|programa\s+|carpeta\s+)?(.+)", t)
    if m:
        objetivo = m.group(1).strip().rstrip(".!")
        if objetivo in APP_SINONIMOS:
            return {"accion": "abrir_app", "args": {"app": APP_SINONIMOS[objetivo]}}
        if objetivo in ("escritorio", "documentos", "descargas", "inicio", "home"):
            return {"accion": "listar_archivos", "args": {"ruta": objetivo}}
        for clave, exe in APP_SINONIMOS.items():
            if clave in objetivo and len(clave) > 3:
                return {"accion": "abrir_app", "args": {"app": exe}}
        # ¿Es una web?
        if "." in objetivo and " " not in objetivo:
            return {"accion": "abrir_web", "args": {"url": objetivo}}
        return {"accion": "abrir_app", "args": {"app": objetivo}}

    # Búsqueda web
    m = re.search(r"(?:busca|buscame|googlea)\s+(.+)", t)
    if m:
        return {"accion": "buscar_web", "args": {"consulta": m.group(1).strip()}}

    return {
        "respuesta": "No tengo un cerebro de IA configurado, así que solo entiendo órdenes directas. "
                     "Prueba con «abre chrome», «qué hora es», «captura la pantalla», «pon el volumen al 30», "
                     "«temporizador de 5 minutos» o «cuánta ram estoy usando». "
                     "Para conversación libre, pon una API key en Ajustes."
    }
