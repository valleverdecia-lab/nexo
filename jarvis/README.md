# Jarvis — un ChatGPT ilimitado en tu PC

Chat con streaming, historial persistente y voz, corriendo **en tu máquina** con **Ollama**:
sin cuotas, sin coste por mensaje, sin internet obligatorio. Y cuando se lo pides, actúa:
abre programas, captura pantalla, cambia el volumen, ordena archivos, pone temporizadores.

Cero dependencias de Python. Solo `python` y, para el cerebro, Ollama instalado aparte.

---

## Las 3 cosas que tienes que hacer tú

### 1. Instalar Python (una vez)
[python.org/downloads/windows](https://www.python.org/downloads/windows/) → marca **«Add python.exe to PATH»**.

Comprobar: abre PowerShell y escribe `python --version`. Debe decir 3.9 o más.

### 2. Instalar Ollama (una vez) — esto es lo que lo hace ilimitado

```powershell
winget install Ollama.Ollama
```

O descarga el instalador de [ollama.com/download](https://ollama.com/download). Abre Ollama
una vez para que arranque el servicio (se queda en la bandeja del sistema).

### 3. Descargar un modelo (una vez, ~2 GB)

```powershell
ollama pull llama3.2
```

Si tienes menos de 8 GB de RAM: `ollama pull qwen2.5:3b` y pon ese nombre en ⚙ ajustes.
Con 16 GB o más y gráfica decente: `ollama pull qwen2.5:7b` — se nota bastante.

**A partir de aquí no vuelves a pagar ni a esperar cuotas. Nunca.**

---

## Arrancarlo

Copia la carpeta `jarvis/` a tu equipo (por ejemplo `C:\Jarvis`) y:

- **Doble clic en `iniciar.bat`** → abre `http://127.0.0.1:8765`
- O para dejarlo instalado: PowerShell en `C:\Jarvis` → `.\instalar.ps1`
  (acceso directo en el escritorio, arranque automático opcional, comprueba Ollama y voces)

macOS/Linux: `./iniciar.sh`.

---

## Qué hay dentro

| Pestaña / botón | Qué hace |
|---|---|
| **+ Nueva conversación** | Hilo nuevo. Cada chat se guarda en SQLite y se titula solo. |
| **Buscar** (arriba de la lista) | Busca dentro de todas tus conversaciones (FTS5). |
| **🛠** | Activa/desactiva que Jarvis pueda actuar en la PC. Apagado = solo conversación. |
| **🔊** | Lee cada respuesta en voz alta (SAPI de Windows, offline). |
| **🎙** | Dictado en español con el micrófono del navegador (Chrome/Edge). |
| **⚙** | Cambiar motor, modelo, personalidad, temperatura, contexto y voz. |
| **copiar / leer / regenerar** | Aparecen al pasar el ratón sobre una respuesta. |

Streaming token a token, markdown (código, listas, tablas simples), historial que sobrevive
al reinicio y exportación a Markdown desde `/api/exportar?chat=<id>`.

### Órdenes de sistema que entiende sin gastar modelo

«abre chrome» · «qué hora es» · «cuánta ram uso» · «captura la pantalla» · «volumen al 30» ·
«temporizador de 5 minutos» · «apunta comprar café» · «lista el escritorio» · «bloquea la pc»

---

## Otros motores (todos opcionales)

| Motor | Clave | Cuota |
|---|---|---|
| **Ollama** (local) | no | **ninguna** |
| **Compatible OpenAI** — LM Studio, Jan, llama.cpp, OpenRouter, Groq | según el servidor | según el servidor |
| Gemini | sí ([AI Studio](https://aistudio.google.com/apikey)) | gratuita limitada |
| OpenAI / Anthropic | sí, de pago | por uso |

En ⚙ ajustes el motor «API compatible con OpenAI» apunta por defecto a
`http://localhost:1234/v1` (LM Studio). Con OpenRouter o Groq pones su URL y su clave.

---

## Seguridad — cómo está construido y por qué

Tres capas que **ningún mensaje puede saltarse**, ni siquiera con un prompt malicioso:

1. **Carpetas permitidas.** Solo se lee/escribe dentro de `Documents`, `Desktop` y `Downloads`.
   La comprobación resuelve la ruta y rechaza `../`, rutas absolutas fuera de la lista y vacías.
2. **Lista blanca de apps.** `abrir_app` solo lanza lo que está en `seguridad.apps_permitidas`.
3. **Confirmación por token.** `ejecutar_comando` y `apagar_pc` **nunca** se ejecutan solos:
   devuelven un token de 180 s que hay que aprobar con un botón. Si el modelo intenta
   escribir `confirmado: true` en los argumentos, se descarta — probado en las pruebas.

Además, un blocklist de patrones catastróficos (`format`, `diskpart`, `bcdedit`, `rm -rf /`,
`vssadmin delete`, `dd of=/dev/…`) que se aplica incluso después de tu confirmación.

**Lo que Jarvis no hace**, por diseño: leer contraseñas, claves o el historial del navegador;
enviar correos o mensajes en tu nombre; comprar; acceder a `C:\Windows` o a tus unidades de red.

---

## Estructura

```
jarvis/
├── server.py        # HTTP + SSE, validación, confirmaciones, ejecución
├── llm.py           # streaming de Ollama / compatible / OpenAI / Anthropic / Gemini
├── chats.py         # conversaciones en SQLite con FTS5
├── prompt.py        # personalidad + catálogo de herramientas + parser de acciones
├── acciones.py      # 20 acciones + intérprete de reglas sin modelo
├── voz.py           # TTS (SAPI/say/espeak) y STT opcional (Vosk)
├── core.py          # config, guardas de seguridad, info del sistema
├── config.json      # todo lo ajustable
├── ui/index.html    # la interfaz (un archivo, sin build)
├── iniciar.bat / .sh / instalar.ps1
└── test_jarvis.py   # 83 pruebas, incluye un Ollama falso para probar el streaming
```

Pruebas: `python3 jarvis/test_jarvis.py`

---

## API (por si quieres automatizarlo)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/chat/stream` | `{texto, chat?, herramientas?}` → SSE (`meta`, `delta`, `acciones`, `permiso`, `fin`) |
| POST | `/api/chat` | Igual, sin streaming (devuelve JSON) |
| GET | `/api/chats` · `/api/chats/<id>` | Lista / conversación completa |
| POST | `/api/chat/nuevo` · `/borrar` · `/renombrar` · `/regenerar` | Gestión de hilos |
| POST | `/api/confirmar` | `{token}` → ejecuta la acción delicada aprobada |
| GET | `/api/estado` · `/api/modelos` · `/api/buscar?q=` | Estado, modelos del motor, búsqueda |
| POST | `/api/accion` | Ejecuta una acción del registro directamente |

---

## Limitaciones honestas

- **La calidad depende del modelo que descargues.** `llama3.2` (3B) es correcto para español
  y órdenes; para conversación larga y razonamiento, un 7B/14B se nota. No es GPT-4.
- **La voz de Windows suena robótica.** Mejorarla = pagar un TTS en la nube o montar Piper (no incluido).
- **El código de macOS/Linux está escrito pero sin probar en hardware real.** La ruta Windows es la principal.
- **Sin Ollama, esto no es un ChatGPT**: es un buen intérprete de órdenes. El aviso amarillo de la UI te lo dirá.
- La UI solo escucha de fondo con la palabra clave si configuras Vosk (`escucha.activar`).
