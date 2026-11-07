# Michi — instalado en este repo

Instalación hecha el 2026-11-07 desde [michiworks/Michi](https://github.com/michiworks/Michi) (v0.3.2, licencia ISC).

> Aclaración: esto quedó instalado en el workspace del repo `nexo` (un contenedor Linux),
> **no en tu PC**. Al final tienes el comando para instalarlo en tu máquina.

## Qué hay

| Ruta | Contenido |
|---|---|
| `michi/` | Clon del código (41 MB, **ignorado por git** — no se versiona) |
| `michi/backend/dist/` | Backend compilado (Express + SQLite + agentes) |
| `michi/frontend/build/` | Frontend compilado (React/Vite), servido por el backend |
| `michi/.michi-data/` | Base de datos y preferencias locales (ignorado por git) |
| `michi.sh` | Lanzador: `./michi.sh` |

## Cómo arrancarlo

```bash
cd /home/user/nexo
./michi.sh            # http://localhost:3000
PORT=4000 ./michi.sh  # otro puerto
```

En la UI del sandbox aparece como preview en el puerto **3000**.
El script exporta solo lo necesario para que el preview funcione (`MICHI_BIND_HOST=0.0.0.0`
más `MICHI_ALLOWED_HOSTS` / `MICHI_CORS_ORIGINS` con el host del preview). Si añades un
host nuevo: `MICHI_EXTRA_HOSTS=mi-dominio.com MICHI_EXTRA_ORIGINS=https://mi-dominio.com ./michi.sh`.

Para dejarlo corriendo en segundo plano: `nohup ./michi.sh > michi.log 2>&1 &`

## Qué necesita configurarse para que sirva de algo

Michi es un **workspace de agentes**: la app arranca y se navega, pero para chatear
necesita al menos un *runtime* autenticado. Los registrados al arrancar son:

`kiro`, `crew`, `pi`, `claude`, `codex`, `antigravity`, `cursor`, `grok`

Ahora mismo ninguno tiene credenciales, por eso el log avisa:
`[ClaudeRuntime] Auth pre-flight warning: No claude auth found`.

Opciones (Settings → Model, o por entorno):

- **`ANTHROPIC_API_KEY`** para Claude Code, o `claude /login` si tienes el CLI.
- **Pi** con cualquier proveedor de API (OpenAI, etc.) desde Settings.
- CLI ya instalados (`codex`, `cursor`, `grok`, `kiro`) si están en el `PATH`.

Sin una de esas, la UI funciona pero no responde a los prompts.

## Reinstalar desde cero

```bash
rm -rf michi
git clone --depth 1 https://github.com/michiworks/Michi.git michi && rm -rf michi/.git
cd michi
npm install --workspace backend --workspace shared --workspace runtime \
  --workspace frontend --include-workspace-root=false --no-audit --no-fund
npm run build
```

Requisitos: Node ≥ 22.19 (aquí hay 22.22.3). El `npm run build` tarda ~1 min 40 s.

## Instalarlo en tu PC (Windows / macOS)

En **Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/michiworks/Michi/main/install.ps1 | iex
```

Clona en `%USERPROFILE%\Michi`, baja Node 22 si falta, compila el instalador NSIS y crea
un acceso en el menú Inicio. Recomiendan Visual Studio Build Tools (si no, usa binarios precompilados).

En **macOS Apple Silicon**: descarga el DMG firmado desde
[releases](https://github.com/michiworks/Michi/releases/latest), o desde fuente:

```bash
curl -fsSL https://raw.githubusercontent.com/michiworks/Michi/main/install.sh | bash
```

Instala en `~/Applications/michi.app`.

En **Linux**: mismo `install.sh`, o la variante servidor:

```bash
npm install && npm run build && node backend/dist/server.js
```

## Notas

- No es un bot de mensajería (nada de Telegram/WhatsApp): es una app de escritorio
  con backend local. Si lo que querías era un bot de chat, dime y buscamos otra cosa.
- El `bot/` que ya existía en este repo (bot.mjs / web.mjs, con su workflow `bot.yml`)
  no se tocó.
- Datos y logs: `michi/.michi-data/` y `~/.michi/logs/`.
