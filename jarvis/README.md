# Jarvis — asistente local para tu PC

Asistente de voz y control de tu computadora. Habla, escucha y ejecuta órdenes reales:
abrir programas, cambiar el volumen, capturas, archivos, notas, temporizadores, estado
del sistema, apagar el equipo — **todo con confirmación para lo delicado**.

Sin dependencias: solo Python 3.9+ y su librería estándar. Nada de `pip install` para
arrancar. Sin cuenta, sin nube obligatoria.

---

## Instalación en tu PC (Windows, 3 pasos)

1. Instala **Python 3.9+** desde [python.org](https://www.python.org/downloads/windows/)
   marcando **«Add python.exe to PATH»**.
2. Copia la carpeta `jarvis/` a tu equipo (por ejemplo a `C:\Jarvis`). No necesitas el resto del repo.
3. Doble clic en **`iniciar.bat`** — o, para dejarlo instalado del todo:

```powershell
cd C:\Jarvis
.\instalar.ps1
```

El instalador crea un acceso directo en el escritorio, te ofrece arranque automático al
iniciar sesión, comprueba las voces de Windows y abre la interfaz.

La interfaz queda en **http://127.0.0.1:8765**.

macOS/Linux: `./iniciar.sh` (`chmod +x iniciar.sh` la primera vez).

---

## Qué sabe hacer

| Área | Órdenes de ejemplo |
|---|---|
| Apps | «abre chrome», «abre la calculadora», «abre visual studio code» |
| Web | «abre youtube.com», «busca en google recetas de pan» |
| Pantalla | «captura la pantalla» → PNG en el escritorio |
| Audio | «pon el volumen al 30», «sube el volumen», «silencia», «pausa la música» |
| Sistema | «cuánta ram uso», «qué batería queda», «qué hora es», «qué día es hoy» |
| Archivos | «lista el escritorio», «busca *.pdf en documentos», «lee notas.txt» |
| Notas | «apunta comprar café mañana», «mis notas» |
| Tiempo | «temporizador de 5 minutos», «avísame en 30 segundos» |
| Equipo | «bloquea la pc», «apaga la pc» (pide confirmación), «cancela el apagado» |
| Shell | «ejecuta ipconfig» (siempre pide confirmación en la UI) |

Todo eso funciona **sin IA y sin internet**, con el intérprete de reglas
(`acciones.interpretar_local`). Unas 40 frases típicas.

---

## El cerebro: cuando quieres conversación de verdad

El intérprete de reglas entiende órdenes; no conversa. Si quieres que entienda
«bájale la música que me duele la cabeza» o «ordena mis descargas por fecha»,
conecta un modelo en **⚙ ajustes**:

| Proveedor | Clave | Coste |
|---|---|---|
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | capa gratuita generosa — **la opción recomendada** |
| **Ollama** | ninguna | 100% local y gratis; `ollama pull llama3.1` |
| OpenAI | platform.openai.com | de pago |
| Anthropic | console.anthropic.com | de pago |

La clave se guarda en `jarvis/config.json` en tu disco y solo se envía al proveedor que
elijas. El modelo **no ejecuta nada**: propone `{accion, args}`, y `server.py` valida
contra el registro real de acciones antes de tocar el sistema.

---

## Voz

**Hablar**: Windows SAPI mediante PowerShell — gratis y offline. Si solo tienes la voz en
inglés y la quieres en español: *Configuración → Hora e idioma → Voz → Agregar voces*.
macOS usa `say`; Linux necesita `espeak-ng`.

**Escuchar**: dos caminos.
- **Micrófono del navegador** (ya funciona): botón 🎙 en la UI. Web Speech API de Chrome/Edge,
  en español, gratis. Es lo más rápido de poner en marcha.
- **Vosk offline** (opcional, para que no dependa del navegador):
  `pip install vosk sounddevice`, descarga
  [vosk-model-small-es-0.42.zip](https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip)
  y descomprímelo en `jarvis/modelos/`. Luego `escucha.activar: true` en `config.json`.

---

## Seguridad — cómo está construido

Tres capas independientes, y ninguna se puede saltar desde el chat:

1. **Carpetas permitidas.** Solo se lee/escribe dentro de `Documents`, `Desktop` y
   `Downloads` del usuario (configurable). Se bloquea el *path traversal* y cualquier ruta
   absoluta fuera de esa lista.
2. **Lista de apps permitidas.** `abrir_app` solo lanza lo que está en
   `seguridad.apps_permitidas`.
3. **Confirmación por token.** `ejecutar_comando` y `apagar_pc` **nunca** se ejecutan
   directamente: devuelven un token que caduca en 180 s y hay que pulsar *Confirmar* en la UI.
   Además hay un blocklist de patrones catastróficos (`format`, `diskpart`, `bcdedit`,
   `rm -rf /`, `vssadmin delete`, …) que se aplica incluso si el usuario confirma.

Deliberadamente **no** implementado: leer contraseñas, claves ni el historial del navegador;
enviar correos o mensajes en tu nombre; compras. Si quieres añadir algo así, es una acción
nueva en `acciones.py` y una entrada en el catálogo — y yo te recomendaría no hacerlo.

---

## Estructura

```
jarvis/
├── server.py        # HTTP (stdlib), validación, confirmaciones, ejecución
├── cerebro.py       # prompt + llamadas a OpenAI/Anthropic/Gemini/Ollama
├── acciones.py      # las 20 acciones + intérprete de reglas sin IA
├── voz.py           # TTS (SAPI/say/espeak) y STT opcional (Vosk)
├── core.py          # config, guardas de seguridad, info del sistema
├── config.json      # todo lo ajustable
├── ui/index.html    # interfaz (un solo archivo, sin build)
├── iniciar.bat      # Windows
├── iniciar.sh       # macOS/Linux
├── instalar.ps1     # instalador Windows (accesos, inicio automático)
└── test_jarvis.py   # 62 pruebas
```

Ejecutar las pruebas: `python3 jarvis/test_jarvis.py`

---

## Añadir una acción nueva

```python
# acciones.py
@accion("abrir_carpeta_descargas")
def abrir_carpeta_descargas() -> dict:
    return _abrir_proceso(["explorer", str(resolver_ruta("descargas"))])
```

Y añádela a `HERRAMIENTAS` en `cerebro.py` para que el modelo sepa que existe.
Listo: aparece en `/api/estado` y el intérprete ya puede usarla.

---

## Limitaciones honestas

- **No es un LLM de ciencia ficción.** Sin proveedor configurado es un buen intérprete de
  comandos, no una conversación.
- **La voz de Windows suena robótica.** Para algo mejor hay que pagar (ElevenLabs) o
  montar un TTS local (Piper) — no incluido.
- **Las acciones de Linux/macOS están sin probar en hardware real**; el código de Windows
  es el camino principal. Si algo falla en tu equipo, `jarvis.jarvis.log` dirá qué.
- **No escucha de fondo** con la palabra clave «Jarvis» salvo que configures Vosk.
- La UI tiene que estar abierta para el botón de confirmación; si cierras la pestaña, la
  orden delicada simplemente caduca (nunca se ejecuta sola).
