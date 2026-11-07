<#
  Jarvis — instalador para Windows.

  Uso (PowerShell, en la carpeta del proyecto):

      .\jarvis\instalar.ps1

  Qué hace:
    1. Comprueba que hay Python 3.9+.
    2. Crea un acceso en el escritorio "Jarvis" (sin ventana negra).
    3. Registra Jarvis para que arranque solo al iniciar sesión (opcional).
    4. Abre el navegador en la interfaz.
    5. (Opcional) Instala Vosk para escuchar sin internet.

  No instala nada de Python salvo lo que pidas con las preguntas.
#>
[CmdletBinding()]
param(
    [switch]$SinInicioAutomatico,
    [switch]$SinNavegador
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$jarvis = $PSScriptRoot

function Escribir($texto, $color = "Cyan") { Write-Host $texto -ForegroundColor $color }

Escribir "`n=== Jarvis · instalación en Windows ===`n"

# ---------------------------------------------------------------- Python
$python = $null
foreach ($candidato in @("python", "py", "python3")) {
    try {
        $v = & $candidato -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v) {
            $partes = $v.Split(".")
            if ([int]$partes[0] -ge 3 -and [int]$partes[1] -ge 9) {
                $python = $candidato
                Escribir "Python $v detectado ($candidato)" "Green"
                break
            }
        }
    } catch { }
}
if (-not $python) {
    Escribir "No encontré Python 3.9 o superior." "Red"
    Escribir "Descárgalo de https://www.python.org/downloads/windows/ y marca «Add python.exe to PATH»." "Yellow"
    exit 1
}

# ---------------------------------------------------------------- prueba rápida
Escribir "`nProbando el servidor…"
$prueba = & $python "$jarvis\server.py" --help 2>&1
if ($LASTEXITCODE -ne 0) {
    Escribir "El servidor no arranca:" "Red"
    Write-Host $prueba
    exit 1
}
Escribir "Servidor OK (solo librería estándar, sin dependencias)." "Green"

# ---------------------------------------------------------------- acceso directo
$escritorio = [Environment]::GetFolderPath("Desktop")
$acceso = Join-Path $escritorio "Jarvis.lnk"
$shell = New-Object -ComObject WScript.Shell
$atajo = $shell.CreateShortcut($acceso)
$atajo.TargetPath = $python
$atajo.Arguments = "`"$jarvis\server.py`""
$atajo.WorkingDirectory = $raiz
$atajo.Description = "Jarvis — asistente local"
$atajo.WindowStyle = 7  # minimizada
$atajo.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
$atajo.Save()
Escribir "Acceso directo creado: $acceso" "Green"

# ---------------------------------------------------------------- inicio automático
if (-not $SinInicioAutomatico) {
    $respuesta = Read-Host "`n¿Quieres que Jarvis arranque solo al iniciar sesión? (s/N)"
    if ($respuesta -match "^[sS]") {
        $inicio = [Environment]::GetFolderPath("Startup")
        $accesoInicio = Join-Path $inicio "Jarvis.lnk"
        $atajo2 = $shell.CreateShortcut($accesoInicio)
        $atajo2.TargetPath = $python
        $atajo2.Arguments = "`"$jarvis\server.py`""
        $atajo2.WorkingDirectory = $raiz
        $atajo2.WindowStyle = 7
        $atajo2.Save()
        Escribir "Añadido al inicio automático: $accesoInicio" "Green"
        Escribir "Para quitarlo, borra ese acceso directo." "Yellow"
    }
}

# ---------------------------------------------------------------- voz de Windows
Escribir "`nComprobando voces instaladas…"
$voces = & powershell -NoProfile -Command @"
Add-Type -AssemblyName System.Speech
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { `$_.VoiceInfo.Name }
"@
if ($voces) {
    Escribir ("  " + ($voces -join ", ")) "Green"
    Escribir "  Si son voces en inglés y quieres español: Configuración > Hora e idioma > Voz > Agregar voces." "Yellow"
} else {
    Escribir "  No hay ninguna voz. Windows debería traer alguna; revisa Configuración > Voz." "Yellow"
}

# ---------------------------------------------------------------- escucha offline
if (-not $SinNavegador) {
    $respuesta = Read-Host "`n¿Instalar escucha offline con Vosk (pip install vosk sounddevice)? (s/N)"
    if ($respuesta -match "^[sS]") {
        Escribir "Instalando vosk y sounddevice…"
        & $python -m pip install --quiet vosk sounddevice
        if ($LASTEXITCODE -eq 0) {
            Escribir "Instalado. Falta el modelo: descarga vosk-model-small-es-0.42.zip de" "Green"
            Escribir "  https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip" "Yellow"
            Escribir "  y descomprímelo en: $jarvis\modelos\" "Yellow"
        } else {
            Escribir "Falló la instalación de Vosk. No pasa nada: el micrófono del navegador funciona igual." "Yellow"
        }
    }
}

# ---------------------------------------------------------------- arrancar
Escribir "`nTodo listo. Arrancando Jarvis…" "Cyan"
Start-Process -FilePath $python -ArgumentList "`"$jarvis\server.py`"" -WorkingDirectory $raiz -WindowStyle Minimized
Start-Sleep -Seconds 2
if (-not $SinNavegador) { Start-Process "http://127.0.0.1:8765" }

Escribir @"

────────────────────────────────────────────────────────
  Jarvis está en  http://127.0.0.1:8765
  Configuración:  $jarvis\config.json
  Notas:          $jarvis\notas.txt
  Log:            $jarvis\jarvis.log

  Siguiente paso: en la UI, pulsa ⚙ ajustes y elige un
  cerebro. Gemini tiene capa gratuita:
  https://aistudio.google.com/apikey
────────────────────────────────────────────────────────
"@ "Cyan"
