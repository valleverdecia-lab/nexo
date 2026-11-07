"""
Jarvis — voz. Hablar (SAPI/espeak/say) y escuchar (Vosk opcional).

Hablar funciona sin instalar nada:
  - Windows: SAPI vía PowerShell (System.Speech)  ← gratis, offline
  - macOS:   `say`
  - Linux:   `espeak-ng` / `espeak` si están

Escuchar requiere Vosk (pip install vosk) y un modelo local. Sin eso, el
micrófono se gestiona en el navegador con la Web Speech API (gratis en Chrome y
Edge en Windows) y Jarvis recibe el texto ya transcrito.
"""
from __future__ import annotations

import queue
import shutil
import subprocess
import threading
from typing import Any

from core import IS_LINUX, IS_MAC, IS_WINDOWS, config, get_config, log

_cola: "queue.Queue[str | None]" = queue.Queue()
_hilo: threading.Thread | None = None


# --------------------------------------------------------------------------- #
# Hablar
# --------------------------------------------------------------------------- #
def _voz_sapi() -> str:
    """Nombre de la voz instalada que más se parezca a la preferida (o vacío)."""
    preferida = (get_config("voz.voz_preferida") or "").strip()
    return preferida


def _comando_hablar(texto: str) -> list[str] | None:
    velocidad = float(get_config("voz.velocidad", 1.0) or 1.0)
    volumen = float(get_config("voz.volumen", 1.0) or 1.0)
    voz = _voz_sapi()

    if IS_WINDOWS:
        # -6..6 en SAPI; 1.0 = 0
        tasa = max(-10, min(10, round((velocidad - 1.0) * 6)))
        vol = max(0, min(100, round(volumen * 100)))
        seleccion = f"$s.SelectVoice('{voz}');" if voz else ""
        seguro = texto.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Speech;"
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            f"{seleccion}"
            f"$s.Rate = {tasa}; $s.Volume = {vol};"
            f"$s.Speak('{seguro}');"
        )
        return ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-Command", script]
    if IS_MAC:
        if not shutil.which("say"):
            return None
        return ["say", "-r", str(round(180 * velocidad)), texto]
    motor = shutil.which("espeak-ng") or shutil.which("espeak")
    if not motor:
        return None
    return [motor, "-s", str(round(175 * velocidad)), "-a", str(round(100 * volumen)), texto]


def hablar(texto: str, bloquear: bool = False) -> dict[str, Any]:
    """Encola el texto para que se diga sin solaparse."""
    limpio = " ".join((texto or "").split())
    if not limpio:
        return {"ok": False, "motivo": "texto vacío"}
    motor = (get_config("voz.motor") or "auto").lower()
    if motor == "ninguno":
        return {"ok": False, "motivo": "voz desactivada"}

    if bloquear:
        return _decir_ahora(limpio)
    _cola.put(limpio)
    _asegurar_hilo()
    return {"ok": True, "encolado": True}


def _decir_ahora(texto: str) -> dict[str, Any]:
    cmd = _comando_hablar(texto)
    if not cmd:
        return {"ok": False, "motivo": "No hay motor de voz instalado (prueba: sudo apt install espeak-ng)"}
    try:
        subprocess.run(cmd, capture_output=True, timeout=180,
                       creationflags=0x08000000 if IS_WINDOWS else 0)
        return {"ok": True}
    except (OSError, subprocess.SubprocessError) as exc:
        log("voz: error", exc)
        return {"ok": False, "motivo": str(exc)}


def _bucle() -> None:
    while True:
        texto = _cola.get()
        if texto is None:
            break
        _decir_ahora(texto)
    log("voz: hilo terminado")


def _asegurar_hilo() -> None:
    global _hilo
    if _hilo is None or not _hilo.is_alive():
        _hilo = threading.Thread(target=_bucle, daemon=True, name="jarvis-voz")
        _hilo.start()


def voces_disponibles() -> list[str]:
    if IS_WINDOWS:
        script = (
            "Add-Type -AssemblyName System.Speech;"
            "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()"
            " | ForEach-Object { $_.VoiceInfo.Name }"
        )
        try:
            salida = subprocess.run(
                ["powershell", "-NoProfile", "-Command", script],
                capture_output=True, text=True, timeout=25,
                creationflags=0x08000000,
            ).stdout
            return [l.strip() for l in salida.splitlines() if l.strip()]
        except (OSError, subprocess.SubprocessError):
            return []
    if IS_MAC:
        try:
            salida = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=15).stdout
            return sorted({l.split()[0] for l in salida.splitlines() if l.strip()})
        except (OSError, subprocess.SubprocessError):
            return []
    motor = shutil.which("espeak-ng") or shutil.which("espeak")
    if not motor:
        return []
    try:
        salida = subprocess.run([motor, "--voices"], capture_output=True, text=True, timeout=15).stdout
        return [l.split()[3] for l in salida.splitlines()[1:] if len(l.split()) > 3]
    except (OSError, subprocess.SubprocessError):
        return []


# --------------------------------------------------------------------------- #
# Escuchar (opcional, 100% offline con Vosk)
# --------------------------------------------------------------------------- #
_vosk_aviso_dado = False


def escucha_disponible() -> dict[str, Any]:
    try:
        import vosk  # noqa: F401
        import sounddevice  # noqa: F401
    except ImportError as exc:
        return {
            "disponible": False,
            "motivo": f"falta {exc.name}: pip install vosk sounddevice",
            "alternativa": "Usa el micrófono del navegador (Chrome/Edge en Windows) — gratis y ya funciona.",
        }
    modelo = get_config("escucha.modelo", "vosk-model-small-es-0.42")
    from pathlib import Path
    from core import BASE_DIR

    ruta = BASE_DIR / "modelos" / modelo
    if not ruta.exists():
        return {
            "disponible": False,
            "motivo": f"falta el modelo en {ruta}",
            "como": f"descarga https://alphacephei.com/vosk/models/{modelo}.zip y descomprímelo en jarvis/modelos/",
        }
    return {"disponible": True, "modelo": str(ruta)}


def escuchar_una_vez(segundos: int = 6) -> dict[str, Any]:
    """Graba del micrófono y transcribe con Vosk. Devuelve el texto."""
    estado = escucha_disponible()
    if not estado.get("disponible"):
        return {"ok": False, "motivo": estado.get("motivo", "escucha no disponible")}

    try:
        import json as _json

        import sounddevice as sd
        import vosk

        modelo = get_config("escucha.modelo", "vosk-model-small-es-0.42")
        from core import BASE_DIR

        vosk.SetLogLevel(-1)
        rec = vosk.KaldiRecognizer(vosk.Model(str(BASE_DIR / "modelos" / modelo)), 16000)
        q: "queue.Queue[bytes]" = queue.Queue()

        def cb(indata, frames, tiempo, estado_stream):  # noqa: ANN001
            q.put(bytes(indata))

        texto = []
        with sd.RawInputStream(samplerate=16000, blocksize=8000, dtype="int16",
                               channels=1, callback=cb):
            import time as _t

            fin = _t.time() + segundos
            while _t.time() < fin:
                datos = q.get(timeout=2)
                if rec.AcceptWaveform(datos):
                    texto.append(_json.loads(rec.Result()).get("text", ""))
        texto.append(_json.loads(rec.FinalResult()).get("text", ""))
        return {"ok": True, "texto": " ".join(t for t in texto if t).strip()}
    except Exception as exc:  # pragma: no cover - depende de hardware
        return {"ok": False, "motivo": str(exc)}
