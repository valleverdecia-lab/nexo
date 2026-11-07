"""
Jarvis — núcleo: configuración, rutas, registro de acciones y guardas de seguridad.

Todo aquí es stdlib puro para que funcione en cualquier Windows con Python 3.9+
sin instalar nada.
"""
from __future__ import annotations

import json
import os
import platform
import re
import sys
import time
import threading
from pathlib import Path
from typing import Any, Callable

BASE_DIR = Path(__file__).resolve().parent
RAIZ = BASE_DIR.parent
CONFIG_PATH = BASE_DIR / "config.json"
NOTAS_PATH = BASE_DIR / "notas.txt"
LOG_PATH = BASE_DIR / "jarvis.log"

IS_WINDOWS = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

_lock = threading.Lock()
_config_cache: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# Configuración
# --------------------------------------------------------------------------- #
def _expand(valor: Any) -> Any:
    if isinstance(valor, str):
        return os.path.expandvars(os.path.expanduser(valor))
    if isinstance(valor, list):
        return [_expand(v) for v in valor]
    if isinstance(valor, dict):
        return {k: _expand(v) for k, v in valor.items()}
    return valor


def config(recargar: bool = False) -> dict[str, Any]:
    global _config_cache
    with _lock:
        if _config_cache is None or recargar:
            datos = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            _config_cache = _expand(datos)
        return _config_cache


def guardar_config(datos: dict[str, Any]) -> None:
    """Escribe config.json y refresca la caché. Mantiene el formato legible."""
    global _config_cache
    with _lock:
        CONFIG_PATH.write_text(
            json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        _config_cache = _expand(datos)


def set_config(clave: str, valor: Any) -> Any:
    """set_config('cerebro.api_key', 'sk-...') — crea niveles intermedios."""
    datos = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    partes = clave.split(".")
    nodo = datos
    for p in partes[:-1]:
        nodo = nodo.setdefault(p, {})
    nodo[partes[-1]] = valor
    guardar_config(datos)
    return valor


def get_config(clave: str, defecto: Any = None) -> Any:
    nodo: Any = config()
    for parte in clave.split("."):
        if not isinstance(nodo, dict) or parte not in nodo:
            return defecto
        nodo = nodo[parte]
    return nodo


# --------------------------------------------------------------------------- #
# Log: consola + archivo, sin dependencias
# --------------------------------------------------------------------------- #
def log(*partes: Any) -> None:
    linea = f"{time.strftime('%Y-%m-%d %H:%M:%S')} " + " ".join(str(p) for p in partes)
    print(linea, flush=True)
    try:
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(linea + "\n")
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# Seguridad: rutas y comandos
# --------------------------------------------------------------------------- #
class Denegado(Exception):
    """Una guarda de seguridad rechazó la petición."""


def carpeta_sistema(nombre: str) -> Path:
    """Documents/Desktop/Downloads del usuario actual, en cualquier SO."""
    return Path.home() / nombre


def carpetas_permitidas() -> list[Path]:
    crudas = get_config("seguridad.carpetas_permitidas", []) or []
    salida: list[Path] = []
    for c in crudas:
        salida.append(Path(os.path.expandvars(os.path.expanduser(str(c)))).resolve())
    return salida


def resolver_ruta(ruta: str, crear_carpeta: bool = False) -> Path:
    """Convierte texto en ruta absoluta verificando que esté dentro de lo permitido."""
    if not ruta or not str(ruta).strip():
        raise Denegado("Ruta vacía.")
    texto = str(ruta).strip().strip('"').strip("'")
    # Nombres amigables en español
    alias = {
        "escritorio": "Desktop", "desktop": "Desktop",
        "documentos": "Documents", "documents": "Documents",
        "descargas": "Downloads", "downloads": "Downloads",
        "inicio": "", "home": "", "usuario": "",
        "imagenes": "Pictures", "imágenes": "Pictures", "pictures": "Pictures",
        "musica": "Music", "música": "Music", "music": "Music",
        "videos": "Videos", "vídeos": "Videos", "videos ": "Videos",
    }
    clave = texto.lower()
    if clave in alias:
        p = Path.home() / alias[clave] if alias[clave] else Path.home()
    else:
        p = Path(os.path.expandvars(os.path.expanduser(texto)))
        if not p.is_absolute():
            p = Path.home() / p
    p = p.resolve()

    permitidas = carpetas_permitidas()
    if not any(p == c or c in p.parents for c in permitidas):
        raise Denegado(
            f"Esa ruta está fuera de las carpetas permitidas ({', '.join(str(c) for c in permitidas)}). "
            f"Añádela en config.json → seguridad.carpetas_permitidas."
        )
    if crear_carpeta:
        p.mkdir(parents=True, exist_ok=True)
    return p


_BLOQUEOS_SIEMPRE = [
    r"format\s+[a-z]:",        # formatear disco
    r"\bdiskpart\b",
    r"\bbcdedit\b",
    r"rm\s+-rf\s+/(\s|$)",     # borrar la raíz
    r"del\s+/[sf].*\b[a-z]:\s*\\?\s*$",
    r"rd\s+/s\s+/q\s+[a-z]:\\?\s*$",
    r"vssadmin\s+delete",
    r"\bmkfs\b",
    r"dd\s+if=.*of=/dev/",
    r":\(\)\s*\{",              # fork bomb
]


def comando_permitido(cmd: str) -> tuple[bool, str]:
    """Segunda capa: además de la lista de config, bloquea patrones catastróficos."""
    texto = " ".join(str(cmd).lower().split())
    for patron in _BLOQUEOS_SIEMPRE:
        if re.search(patron, texto):
            return False, f"Bloqueado por patrón peligroso: {patron}"
    for bloqueado in get_config("seguridad.comandos_bloqueados", []) or []:
        if bloqueado and bloqueado.lower() in texto:
            return False, f"Ese comando está en la lista de bloqueados: «{bloqueado}»"
    return True, ""


# --------------------------------------------------------------------------- #
# Sistema
# --------------------------------------------------------------------------- #
def info_sistema() -> dict[str, Any]:
    import shutil

    datos: dict[str, Any] = {
        "so": f"{platform.system()} {platform.release()}",
        "maquina": platform.machine(),
        "python": platform.python_version(),
        "hostname": platform.node(),
        "cpus": os.cpu_count(),
    }
    try:
        uso = shutil.disk_usage(str(Path.home()))
        datos["disco_libre_gb"] = round(uso.free / 1e9, 1)
        datos["disco_total_gb"] = round(uso.total / 1e9, 1)
        datos["disco_usado_pct"] = round(100 * uso.used / uso.total, 1)
    except OSError:
        pass

    if IS_WINDOWS:
        try:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            est = MEMORYSTATUSEX()
            est.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(est)):
                datos["ram_usada_pct"] = est.dwMemoryLoad
                datos["ram_total_gb"] = round(est.ullTotalPhys / 1e9, 1)
                datos["ram_libre_gb"] = round(est.ullAvailPhys / 1e9, 1)

            class SYSTEM_POWER_STATUS(ctypes.Structure):
                _fields_ = [
                    ("ACLineStatus", ctypes.c_byte),
                    ("BatteryFlag", ctypes.c_byte),
                    ("BatteryLifePercent", ctypes.c_byte),
                    ("Reserved1", ctypes.c_byte),
                    ("BatteryLifeTime", ctypes.c_ulong),
                    ("BatteryFullLifeTime", ctypes.c_ulong),
                ]

            est2 = SYSTEM_POWER_STATUS()
            if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(est2)):
                if est2.BatteryLifePercent != 255:
                    datos["bateria_pct"] = est2.BatteryLifePercent
                datos["enchufado"] = est2.ACLineStatus == 1
        except Exception as exc:  # pragma: no cover - solo windows
            datos["aviso_windows"] = f"No pude leer RAM/batería: {exc}"
    else:
        try:
            with open("/proc/meminfo", encoding="utf-8") as fh:
                lineas = fh.read().splitlines()
            valores = {}
            for linea in lineas:
                k, _, resto = linea.partition(":")
                valores[k] = int(resto.split()[0]) if resto.split() else 0
            total = valores.get("MemTotal", 0)
            disponible = valores.get("MemAvailable", 0)
            if total:
                datos["ram_total_gb"] = round(total / 1e6, 1)
                datos["ram_libre_gb"] = round(disponible / 1e6, 1)
                datos["ram_usada_pct"] = round(100 * (total - disponible) / total)
        except OSError:
            pass
    return datos


# --------------------------------------------------------------------------- #
# Registro de acciones disponibles (para la UI y para el cerebro)
# --------------------------------------------------------------------------- #
Registro = dict[str, Callable[..., Any]]
ACCIONES: Registro = {}


def accion(nombre: str):
    def deco(fn: Callable[..., Any]):
        ACCIONES[nombre] = fn
        return fn

    return deco
