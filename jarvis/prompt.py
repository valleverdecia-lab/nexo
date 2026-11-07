"""
Jarvis — personalidad y catálogo de herramientas para el prompt del sistema.

El modelo recibe: quién es, qué herramientas tiene, y la regla de que para usar
una debe responder con un objeto JSON. Todo en texto plano para que funcione
igual con un modelo de 3B y con uno de frontera.
"""
from __future__ import annotations

import json
from typing import Any

from core import get_config

HERRAMIENTAS: list[dict[str, Any]] = [
    {"nombre": "abrir_app", "args": {"app": "texto"}, "que": "Abre un programa permitido (chrome, code, spotify, calc, notepad...)."},
    {"nombre": "abrir_web", "args": {"url": "texto"}, "que": "Abre una URL, o busca en Google si es una frase."},
    {"nombre": "buscar_web", "args": {"consulta": "texto"}, "que": "Busca en Google."},
    {"nombre": "captura_pantalla", "args": {}, "que": "Captura la pantalla y guarda el PNG en el escritorio."},
    {"nombre": "volumen", "args": {"nivel": "0-100 | subir | bajar | silenciar"}, "que": "Cambia el volumen del sistema."},
    {"nombre": "multimedia", "args": {"orden": "play | pausa | siguiente | anterior"}, "que": "Controla la música."},
    {"nombre": "bloquear_pc", "args": {}, "que": "Bloquea la sesión."},
    {"nombre": "apagar_pc", "args": {"confirmar": "bool"}, "que": "Apaga el equipo en 60 s. El usuario debe confirmar en pantalla."},
    {"nombre": "cancelar_apagado", "args": {}, "que": "Cancela un apagado programado."},
    {"nombre": "estado_sistema", "args": {}, "que": "CPU, RAM, disco y batería."},
    {"nombre": "fecha_hora", "args": {}, "que": "Fecha y hora actuales."},
    {"nombre": "listar_archivos", "args": {"ruta": "texto"}, "que": "Lista una carpeta permitida (escritorio, documentos, descargas)."},
    {"nombre": "leer_archivo", "args": {"ruta": "texto"}, "que": "Lee un archivo de texto permitido."},
    {"nombre": "escribir_archivo", "args": {"ruta": "texto", "contenido": "texto", "anadir": "bool"}, "que": "Crea o sobrescribe un archivo permitido."},
    {"nombre": "crear_carpeta", "args": {"ruta": "texto"}, "que": "Crea una carpeta permitida."},
    {"nombre": "buscar_archivos", "args": {"patron": "texto", "ruta": "texto"}, "que": "Busca archivos por patrón, ej. *.pdf."},
    {"nombre": "crear_nota", "args": {"texto": "texto", "titulo": "texto"}, "que": "Añade una nota rápida."},
    {"nombre": "leer_notas", "args": {}, "que": "Devuelve las notas guardadas."},
    {"nombre": "temporizador", "args": {"segundos": "int", "etiqueta": "texto"}, "que": "Pone un temporizador con aviso."},
    {"nombre": "ejecutar_comando", "args": {"comando": "texto"}, "que": "Shell del sistema. Solo si el usuario lo pide explícitamente; siempre pide confirmación."},
]

CATALOGO = "\n".join(
    f"- {h['nombre']}({', '.join(f'{k}: {v}' for k, v in h['args'].items())}): {h['que']}"
    for h in HERRAMIENTAS
)

REGLAS_HERRAMIENTAS = f"""
## Herramientas

Puedes actuar sobre la computadora del usuario. Para eso responde ÚNICAMENTE con un objeto JSON, sin texto alrededor:

{{"accion": "nombre", "args": {{...}}}}          una acción
{{"acciones": [{{"accion": "...", "args": {{...}}}}, ...]}}   varias en cadena

Disponibles:
{CATALOGO}

Reglas:
- Solo usa nombres y argumentos de esa lista. No inventes herramientas.
- Si te falta un dato imprescindible (por ejemplo el nivel exacto de volumen), pregúntalo en texto normal.
- Si el usuario pide algo fuera de las carpetas permitidas, ni lo intentes: explícalo en una frase.
- Para conversación normal responde en texto plano. No uses JSON.
"""


def contexto_maquina() -> str:
    import platform
    from pathlib import Path

    from core import info_sistema

    info = info_sistema()
    partes = [
        f"Sistema: {info.get('so')} ({platform.machine()})",
        f"Usuario: {Path.home()}",
        "Carpetas permitidas: " + ", ".join(get_config("seguridad.carpetas_permitidas") or []),
    ]
    if info.get("ram_total_gb"):
        partes.append(f"RAM: {info['ram_total_gb']} GB")
    return " · ".join(partes)


def system_prompt(con_herramientas: bool = True) -> str:
    nombre = get_config("nombre", "Jarvis")
    personalidad = get_config("cerebro.personalidad") or "Hablas español, directo y útil."
    base = (
        f"Eres {nombre}, el asistente personal de este usuario, corriendo en su propio equipo. "
        f"{personalidad}\n\n"
        f"Contexto de la máquina: {contexto_maquina()}\n"
    )
    if con_herramientas:
        base += REGLAS_HERRAMIENTAS
    return base


def extraer_accion(texto: str) -> dict[str, Any] | None:
    """Si la respuesta del modelo es (solo) un JSON de acción, lo devuelve."""
    limpio = (texto or "").strip()
    if not limpio.startswith("{") or not limpio.endswith("}"):
        return None
    try:
        datos = json.loads(limpio)
    except json.JSONDecodeError:
        return None
    if isinstance(datos, dict) and (datos.get("accion") or isinstance(datos.get("acciones"), list)):
        return datos
    return None
