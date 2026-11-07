"""
Jarvis — conversaciones persistentes en SQLite (stdlib, `sqlite3`).

Un solo archivo: jarvis/jarvis.db. FTS5 opcional para buscar (si el SQLite del
sistema lo trae; si no, se degrada a LIKE).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from core import BASE_DIR

DB_PATH = BASE_DIR / "jarvis.db"
_lock = threading.Lock()
_con: sqlite3.Connection | None = None


def _conexion() -> sqlite3.Connection:
    global _con
    if _con is None:
        _con = sqlite3.connect(DB_PATH, check_same_thread=False)
        _con.row_factory = sqlite3.Row
        _con.execute("PRAGMA journal_mode=WAL")
        _con.execute("PRAGMA synchronous=NORMAL")
        _crear_esquema(_con)
    return _con


def _crear_esquema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS conversaciones (
            id TEXT PRIMARY KEY,
            titulo TEXT NOT NULL,
            creada REAL NOT NULL,
            actualizada REAL NOT NULL,
            archivada INTEGER NOT NULL DEFAULT 0,
            proveedor TEXT DEFAULT '',
            modelo TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS mensajes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversacion TEXT NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
            rol TEXT NOT NULL,
            contenido TEXT NOT NULL,
            creado REAL NOT NULL,
            meta TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mensajes_conv ON mensajes(conversacion, id);
        CREATE INDEX IF NOT EXISTS idx_conv_act ON conversaciones(archivada, actualizada DESC);
        """
    )
    try:
        con.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS mensajes_fts "
            "USING fts5(contenido, conversacion UNINDEXED, mensaje_id UNINDEXED)"
        )
    except sqlite3.OperationalError:
        pass  # SQLite sin FTS5: la búsqueda usará LIKE
    con.commit()


def _tiene_fts(con: sqlite3.Connection) -> bool:
    fila = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='mensajes_fts'"
    ).fetchone()
    return fila is not None


# --------------------------------------------------------------------------- #
# Conversaciones
# --------------------------------------------------------------------------- #
def crear(titulo: str = "Nueva conversación", proveedor: str = "", modelo: str = "") -> dict[str, Any]:
    ahora = time.time()
    ident = uuid.uuid4().hex[:16]
    with _lock:
        con = _conexion()
        con.execute(
            "INSERT INTO conversaciones (id, titulo, creada, actualizada, proveedor, modelo) "
            "VALUES (?,?,?,?,?,?)",
            (ident, titulo[:120], ahora, ahora, proveedor, modelo),
        )
        con.commit()
    return {"id": ident, "titulo": titulo[:120], "creada": ahora, "actualizada": ahora}


def listar(limite: int = 100, incluir_archivadas: bool = False) -> list[dict[str, Any]]:
    con = _conexion()
    where = "" if incluir_archivadas else "WHERE archivada = 0"
    filas = con.execute(
        f"SELECT c.*, (SELECT COUNT(*) FROM mensajes m WHERE m.conversacion = c.id) AS n "
        f"FROM conversaciones c {where} ORDER BY actualizada DESC LIMIT ?",
        (limite,),
    ).fetchall()
    return [dict(f) for f in filas]


def obtener(ident: str) -> dict[str, Any] | None:
    con = _conexion()
    fila = con.execute("SELECT * FROM conversaciones WHERE id = ?", (ident,)).fetchone()
    return dict(fila) if fila else None


def renombrar(ident: str, titulo: str) -> bool:
    with _lock:
        con = _conexion()
        cur = con.execute("UPDATE conversaciones SET titulo = ? WHERE id = ?",
                          (titulo.strip()[:120] or "Sin título", ident))
        con.commit()
    return cur.rowcount > 0


def archivar(ident: str, archivada: bool = True) -> bool:
    with _lock:
        con = _conexion()
        cur = con.execute("UPDATE conversaciones SET archivada = ? WHERE id = ?",
                          (1 if archivada else 0, ident))
        con.commit()
    return cur.rowcount > 0


def borrar(ident: str) -> bool:
    with _lock:
        con = _conexion()
        con.execute("DELETE FROM mensajes WHERE conversacion = ?", (ident,))
        try:
            con.execute("DELETE FROM mensajes_fts WHERE conversacion = ?", (ident,))
        except sqlite3.OperationalError:
            pass
        cur = con.execute("DELETE FROM conversaciones WHERE id = ?", (ident,))
        con.commit()
    return cur.rowcount > 0


def renombrar_si_es_nueva(ident: str, titulo: str) -> None:
    """Solo pone el título si sigue siendo el genérico (primer mensaje)."""
    con = _conexion()
    con.execute(
        "UPDATE conversaciones SET titulo = ? WHERE id = ? AND titulo = 'Nueva conversación'",
        (titulo.strip()[:120] or "Nueva conversación", ident),
    )
    con.commit()


# --------------------------------------------------------------------------- #
# Mensajes
# --------------------------------------------------------------------------- #
def añadir_mensaje(ident: str, rol: str, contenido: str, meta: dict[str, Any] | None = None) -> int:
    ahora = time.time()
    with _lock:
        con = _conexion()
        cur = con.execute(
            "INSERT INTO mensajes (conversacion, rol, contenido, creado, meta) VALUES (?,?,?,?,?)",
            (ident, rol, contenido, ahora, json.dumps(meta or {}, ensure_ascii=False)),
        )
        con.execute("UPDATE conversaciones SET actualizada = ? WHERE id = ?", (ahora, ident))
        if _tiene_fts(con) and contenido.strip():
            con.execute(
                "INSERT INTO mensajes_fts (contenido, conversacion, mensaje_id) VALUES (?,?,?)",
                (contenido, ident, cur.lastrowid),
            )
        con.commit()
        return int(cur.lastrowid or 0)


def mensajes(ident: str, limite: int = 400) -> list[dict[str, Any]]:
    con = _conexion()
    filas = con.execute(
        "SELECT * FROM mensajes WHERE conversacion = ? ORDER BY id ASC LIMIT ?",
        (ident, limite),
    ).fetchall()
    salida = []
    for f in filas:
        d = dict(f)
        try:
            d["meta"] = json.loads(d.get("meta") or "{}")
        except json.JSONDecodeError:
            d["meta"] = {}
        salida.append(d)
    return salida


def historial_para_modelo(ident: str, limite: int = 24) -> list[dict[str, str]]:
    """Últimos turnos en el formato que esperan los proveedores."""
    filas = mensajes(ident)[-limite:]
    return [{"role": f["rol"], "content": f["contenido"]}
            for f in filas if f["rol"] in ("user", "assistant") and f["contenido"].strip()]


def borrar_mensajes_desde(ident: str, mensaje_id: int) -> int:
    """Para 'regenerar' o editar: elimina el mensaje y todo lo posterior."""
    with _lock:
        con = _conexion()
        cur = con.execute("DELETE FROM mensajes WHERE conversacion = ? AND id >= ?",
                          (ident, mensaje_id))
        con.commit()
        return cur.rowcount


def buscar(texto: str, limite: int = 40) -> list[dict[str, Any]]:
    con = _conexion()
    texto = (texto or "").strip()
    if not texto:
        return []
    if _tiene_fts(con):
        try:
            filas = con.execute(
                "SELECT mensaje_id, conversacion, substr(contenido, 1, 220) AS extracto "
                "FROM mensajes_fts WHERE mensajes_fts MATCH ? ORDER BY rank LIMIT ?",
                (texto.replace('"', "") + "*", limite),
            ).fetchall()
            return [dict(f) for f in filas]
        except sqlite3.OperationalError:
            pass
    filas = con.execute(
        "SELECT id AS mensaje_id, conversacion, substr(contenido, 1, 220) AS extracto "
        "FROM mensajes WHERE contenido LIKE ? ORDER BY id DESC LIMIT ?",
        (f"%{texto}%", limite),
    ).fetchall()
    return [dict(f) for f in filas]


def estadisticas() -> dict[str, Any]:
    con = _conexion()
    convs = con.execute("SELECT COUNT(*) FROM conversaciones").fetchone()[0]
    msgs = con.execute("SELECT COUNT(*) FROM mensajes").fetchone()[0]
    caracteres = con.execute("SELECT COALESCE(SUM(LENGTH(contenido)),0) FROM mensajes").fetchone()[0]
    tamano = DB_PATH.stat().st_size if Path(DB_PATH).exists() else 0
    return {"conversaciones": convs, "mensajes": msgs, "caracteres": caracteres,
            "tamano_kb": round(tamano / 1024, 1)}
