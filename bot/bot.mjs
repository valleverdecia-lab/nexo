// Bot de Telegram para administrar el catálogo de Nexo.
// Corre dentro de GitHub Actions: lee mensajes, edita catalogo.js / fotos y publica.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { buscarEnLaWeb, generarFicha, generarFichaLocal, adivinarCategoria } from "./web.mjs";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TOKEN = process.env.TELEGRAM_TOKEN;
const DURACION_MS = Number(process.env.BOT_DURACION_MS || 280000);
const SIN_GIT = process.env.BOT_SIN_GIT === "1";
const API = process.env.TELEGRAM_API || "https://api.telegram.org";
const F_CAT = path.join(RAIZ, "catalogo.js");
const F_IDX = path.join(RAIZ, "index.html");
const F_EST = path.join(RAIZ, "bot", "estado.json");
const F_CFG = path.join(RAIZ, "bot", "config.json");
const DIR_FOTOS = path.join(RAIZ, "fotos");

// ---------- datos ----------
function leerCatalogo() {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(F_CAT, "utf8").replace(/const (\w+)=/g, "this.$1="), ctx);
  return { CATALOGO: ctx.CATALOGO, GRUPOS: ctx.GRUPOS };
}
function guardarCatalogo(db) {
  fs.writeFileSync(F_CAT, "const CATALOGO=" + JSON.stringify(db.CATALOGO) + ";\nconst GRUPOS=" + JSON.stringify(db.GRUPOS) + ";\n");
  let html = fs.readFileSync(F_IDX, "utf8");
  const n = db.CATALOGO.length;
  html = html.replace(/\b\d+ productos/g, `${n} productos`);
  const v = Date.now().toString(36);
  html = html.replace(/src="catalogo\.js(\?v=\w+)?"/, `src="catalogo.js?v=${v}"`);
  html = html.replace(/src="app\.js(\?v=\w+)?"/, `src="app.js?v=${v}"`);
  fs.writeFileSync(F_IDX, html);
}
const leerJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
let estado = leerJSON(F_EST, { offset: 0, owner: null, pend: {} });
const config = leerJSON(F_CFG, {});
let db = leerCatalogo();
let sucio = false, estadoSucio = false;
const cambios = [];
const confirmacionesPublicacion = [];
const fichasPendientes = [];

const usd = c => (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " USD";
const buscarP = s => db.CATALOGO.find(p => p.s === s);
const clave = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const porClave = k => k && db.CATALOGO.find(p => clave(p.s) === k);
const subs = () => Object.entries(db.GRUPOS).flatMap(([g, d]) => d.subs.map(s => ({ g, s, gn: d.nombre })));
const norm = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function numero(t) {
  t = String(t).replace(/[^0-9.,]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, "");
  return Number(t.replace(",", "."));
}
function slugDe(nombre) {
  let base = norm(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "producto";
  let s = base, i = 2;
  while (buscarP(s)) s = `${base}-${i++}`;
  return s;
}
/* extrae un nombre de producto razonable de un mensaje reenviado del proveedor */
function nombreDeTexto(t) {
  const lineas = String(t).split("\n").map(x => x.trim()).filter(Boolean)
    .filter(x => !/usd|\$|cup|precio|http|wa\.me|whatsapp|\+\d{8,}|disponible|agotado|entrega|env[ií]o|stock|pedido|contact/i.test(x));
  const cand = (lineas.slice(0, 3).sort((a, b) => b.length - a.length)[0] || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").replace(/[*_#]+/g, "").replace(/\s+/g, " ").trim();
  return cand.slice(0, 80);
}
/* aviso opcional al WhatsApp del dueño (CallMeBot u otro webhook con ?text=) */
async function avisoWhatsApp(texto) {
  const url = process.env.WHATSAPP_AVISO_URL;
  if (!url) return;
  try { await fetch(url + encodeURIComponent(texto).slice(0, 300), { signal: AbortSignal.timeout(8000) }); } catch { /* no crítico */ }
}

// ---------- Telegram ----------
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchConReintentos(url, opciones = {}, { etiqueta = "HTTP", intentos = 5, timeoutMs = 15000 } = {}) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status !== 429 && r.status < 500) return r;
      if (intento === intentos) return r;
      const info = await r.clone().json().catch(() => ({}));
      const retryAfter = Number(info.parameters?.retry_after || r.headers.get("retry-after")) * 1000;
      const espera = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 60000)
        : Math.min(30000, 1000 * (2 ** (intento - 1)));
      console.warn(`${etiqueta}: HTTP ${r.status}; reintento ${intento + 1}/${intentos} en ${espera}ms`);
      await pausa(espera);
    } catch (e) {
      if (intento === intentos) {
        console.warn(`${etiqueta}: sin respuesta tras ${intentos} intentos: ${e.message}`);
        return null;
      }
      const espera = Math.min(30000, 1000 * (2 ** (intento - 1)));
      console.warn(`${etiqueta}: ${e.message}; reintento ${intento + 1}/${intentos} en ${espera}ms`);
      await pausa(espera);
    }
  }
  return null;
}
async function tg(metodo, datos = {}) {
  const timeoutMs = metodo === "getUpdates" ? Math.max(15000, (Number(datos.timeout) || 0) * 1000 + 15000) : 15000;
  const r = await fetchConReintentos(`${API}/bot${TOKEN}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos)
  }, { etiqueta: `Telegram ${metodo}`, timeoutMs });
  if (!r) return { ok: false, description: "Fallo de red tras varios reintentos." };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    j.ok = false;
    if (!j.description) j.description = `HTTP ${r.status}`;
  }
  if (!j.ok && metodo !== "getUpdates") console.log("TG error", metodo, j.description);
  return j;
}
const enviar = (chat, text, extra = {}) => {
  if (sucio && typeof text === "string" && text.trimStart().startsWith("✅")) {
    confirmacionesPublicacion.push({ chat, text, extra, avisoEnviado: false });
    return Promise.resolve({ ok: true, pendiente: true });
  }
  return tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
};
const teclado = filas => ({ reply_markup: { inline_keyboard: filas } });
const esc = t => String(t ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Ajusta la foto al recuadro de la web (1 : 1.06) sin estirar ni cortar el producto:
// - fondo liso: quita el borde vacío y completa con el mismo color
// - foto normal: recorte mínimo (≤10%) o fondo desenfocado de la misma foto
async function prepararFoto(buf, destino) {
  const sharp = (await import("sharp")).default;
  const A = 1 / 1.06;
  const base = await sharp(buf).rotate().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).toBuffer();
  const { data, info } = await sharp(base).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x, y) => { const i = (y * w + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const esquinas = [px(1, 1), px(w - 2, 1), px(1, h - 2), px(w - 2, h - 2)];
  const c = [0, 1, 2].map(k => esquinas.map(e => e[k]).sort((a, b) => a - b)[1]);
  const cerca = p => p.every((v, k) => Math.abs(v - c[k]) < 26);
  let total = 0, iguales = 0;
  for (let x = 0; x < w; x += 4) { total += 2; iguales += cerca(px(x, 0)) + cerca(px(x, h - 1)); }
  for (let y = 0; y < h; y += 4) { total += 2; iguales += cerca(px(0, y)) + cerca(px(w - 1, y)); }
  const fondo = { r: c[0], g: c[1], b: c[2] };
  let out;
  if (iguales / total >= 0.93) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const p = px(x, y);
      if (p.some((v, k) => Math.abs(v - c[k]) > 28)) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
    if (x1 <= x0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    const m = Math.round(0.045 * Math.max(x1 - x0, y1 - y0));
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const [W, H] = cw / ch > A ? [cw, Math.round(cw / A)] : [Math.round(ch * A), ch];
    out = sharp(base).extract({ left: x0, top: y0, width: cw, height: ch })
      .extend({ left: Math.floor((W - cw) / 2), right: Math.ceil((W - cw) / 2), top: Math.floor((H - ch) / 2), bottom: Math.ceil((H - ch) / 2), background: fondo });
    out = sharp(await out.toBuffer());
  } else {
    const r = w / h, perdida = r > A ? 1 - A / r : 1 - r / A;
    if (perdida <= 0.10) {
      const [W, H] = r > A ? [Math.round(h * A), h] : [w, Math.round(w / A)];
      out = sharp(base).extract({ left: Math.floor((w - W) / 2), top: Math.floor((h - H) / 2), width: W, height: H });
    } else {
      const W = Math.max(w, Math.round(h * A)), H = Math.max(h, Math.round(w / A));
      const fondoBlur = await sharp(base).resize(W, H, { fit: "cover" }).blur(Math.max(W, H) / 20).modulate({ brightness: 0.62 }).toBuffer();
      out = sharp(fondoBlur).composite([{ input: base, left: Math.floor((W - w) / 2), top: Math.floor((H - h) / 2) }]);
    }
  }
  await sharp(await out.toBuffer()).resize(1000, 1060, { fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toFile(destino);
}

async function bajarFoto(fileId, slug) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f.ok) throw new Error("No pude descargar la foto");
  const r = await fetchConReintentos(`${API}/file/bot${TOKEN}/${f.result.file_path}`, {}, { etiqueta: "Descarga de foto", timeoutMs: 30000 });
  if (!r?.ok) throw new Error("No pude descargar la foto tras varios intentos");
  const buf = Buffer.from(await r.arrayBuffer());
  const nombre = `${slug}-${Date.now().toString(36)}.webp`;
  try {
    await prepararFoto(buf, path.join(DIR_FOTOS, nombre));
  } catch (e) {
    console.log("foto:", e.message);
    const jpg = nombre.replace(/\.webp$/, ".jpg");
    fs.writeFileSync(path.join(DIR_FOTOS, jpg), buf);
    return jpg;
  }
  return nombre;
}
function borrarFotoVieja(p) {
  if (p.f && fs.existsSync(path.join(DIR_FOTOS, p.f))) fs.unlinkSync(path.join(DIR_FOTOS, p.f));
}

// ---------- vistas ----------
const MENU = teclado([
  [{ text: "➕ Agregar producto", callback_data: "nuevo" }],
  [{ text: "🔎 Buscar / editar producto", callback_data: "buscar" }],
  [{ text: "📋 Ver categorías", callback_data: "cats" }]
]);
const AYUDA = `<b>Panel de Nexo</b>

• <b>Agregar producto</b>: elija <b>⚡ Fast</b> (reenvía el mensaje del proveedor; yo busco el producto en la web, redacto la ficha y solo le pregunto fotos y precio) o <b>🐢 Completa</b> (todo a mano, paso a paso).
• Puede subir <b>varias fotos</b> (hasta 6) e incluso un <b>vídeo-demo</b> (hasta ~18 MB).
• <b>Editar</b>: escriba cualquier palabra (ej. <i>sillón</i>) y toque el producto. Puede cambiar precio, nombre, descripciones, fotos, categoría, disponibilidad o borrarlo.
• <b>Categorías</b>: desde «📋 Ver categorías» puede <b>añadir o borrar subcategorías y grupos</b> enteros. Si borra una subcategoría con productos, estos pasan a «Otros».
• /cancelar detiene lo que esté haciendo.

Los cambios aparecen en la web en 1–3 minutos.`;

function fichaTexto(p) {
  const sp = (p.sp || []).map(([k, v]) => `   · ${esc(k)}: ${esc(v)}`).join("\n");
  return `<b>${esc(p.n)}</b>
💲 Precio: <b>${usd(p.pv)}</b>
📂 ${esc(db.GRUPOS[p.g]?.nombre)} › ${esc(p.c)}
${p.e === "agotado" ? "🔴 Agotado" : "🟢 Disponible"}

<b>Descripción corta:</b> ${esc(p.dc)}
<b>Descripción larga:</b> ${esc(p.dl)}
<b>Texto de venta:</b> ${esc(p.v)}${sp ? `\n<b>Especificaciones:</b>\n${sp}` : ""}

<code>${p.s}</code>`;
}
function fichaBotones(p) {
  const s = clave(p.s);
  return teclado([
    [{ text: "💲 Precio", callback_data: `ed:pv:${s}` }, { text: "✏️ Nombre", callback_data: `ed:n:${s}` }],
    [{ text: "📝 Desc. corta", callback_data: `ed:dc:${s}` }, { text: "📄 Desc. larga", callback_data: `ed:dl:${s}` }],
    [{ text: "💬 Texto de venta", callback_data: `ed:v:${s}` }, { text: "📋 Especificaciones", callback_data: `ed:sp:${s}` }],
    [{ text: "🖼 Cambiar foto", callback_data: `ed:foto:${s}` }, { text: "📂 Categoría", callback_data: `cat:${s}` }],
    [{ text: p.e === "agotado" ? "🟢 Marcar disponible" : "🔴 Marcar agotado", callback_data: `est:${s}:${p.e === "agotado" ? "hay" : "agotado"}` }],
    [{ text: "🗑 Borrar producto", callback_data: `del:${s}` }]
  ]);
}
async function mostrarFicha(chat, p) {
  if (sucio) {
    fichasPendientes.push({ chat, p });
    return { ok: true, pendiente: true };
  }
  const foto = path.join(DIR_FOTOS, p.f || p.s + ".webp");
  const url = config.web ? `${config.web.replace(/\/$/, "")}/fotos/${p.f || p.s + ".webp"}` : null;
  if (url && fs.existsSync(foto) && !p.f) {
    const r = await tg("sendPhoto", { chat_id: chat, photo: url });
    if (!r.ok) { /* sin foto, no pasa nada */ }
  }
  return enviar(chat, fichaTexto(p), fichaBotones(p));
}
function botonesCategorias(prefijo) {
  const filas = [];
  for (const [g, d] of Object.entries(db.GRUPOS)) {
    filas.push([{ text: `— ${d.nombre} —`, callback_data: "nada" }]);
    for (let i = 0; i < d.subs.length; i += 2)
      filas.push(d.subs.slice(i, i + 2).map((s, j) => ({ text: s, callback_data: `${prefijo}:${g}:${db.GRUPOS[g].subs.indexOf(s)}` })));
  }
  return teclado(filas);
}
function botonesGrupos(prefijo) {
  return teclado(Object.entries(db.GRUPOS).map(([g, d]) => [{ text: d.nombre, callback_data: `${prefijo}:${g}` }]));
}
function textoCategorias() {
  return Object.entries(db.GRUPOS).map(([g, d]) => `<b>${esc(d.nombre)}</b>\n` + d.subs.map(s => `  · ${esc(s)} (${db.CATALOGO.filter(p => p.g === g && p.c === s).length})`).join("\n")).join("\n\n");
}
const MENU_CATS = () => teclado([
  [{ text: "➕ Añadir subcategoría", callback_data: "cadd" }],
  [{ text: "🗑 Borrar subcategoría", callback_data: "cdel" }],
  [{ text: "🗂 Crear grupo", callback_data: "gadd" }, { text: "🗂 Borrar grupo", callback_data: "gdel" }],
  [{ text: "◀ Volver al menú", callback_data: "menu" }]
]);

// ---------- edición ----------
const CAMPOS = { pv: "precio", n: "nombre", dc: "descripción corta", dl: "descripción larga", v: "texto de venta", sp: "especificaciones", foto: "foto" };
function marcar(msg) { sucio = true; cambios.push(msg); }

async function aplicarEdicion(chat, campo, p, msg) {
  const txt = (msg.text || msg.caption || "").trim();
  if (campo === "foto") {
    const fid = msg.photo?.at(-1)?.file_id || (msg.document?.mime_type?.startsWith("image/") ? msg.document.file_id : null);
    if (!fid) return enviar(chat, "Envíeme una <b>foto</b> (o /cancelar).");
    const nombre = await bajarFoto(fid, p.s);
    borrarFotoVieja(p);
    p.f = nombre;
    marcar(`Foto de ${p.n}`);
  } else if (!txt) {
    return enviar(chat, "Escríbame el texto nuevo (o /cancelar).");
  } else if (campo === "pv") {
    const n = numero(txt);
    if (!n || n <= 0) return enviar(chat, "Escriba solo el número, por ejemplo <b>450</b>.");
    p.pv = Math.round(n * 100);
    marcar(`Precio de ${p.n}: ${usd(p.pv)}`);
  } else if (campo === "sp") {
    if (/^(borrar|ninguna)$/i.test(txt)) p.sp = [];
    else p.sp = txt.split("\n").map(l => l.split(/:(.*)/s)).filter(x => x[1]).map(([k, v]) => [k.trim(), v.trim()]);
    marcar(`Especificaciones de ${p.n}`);
  } else {
    p[campo] = txt;
    marcar(`${CAMPOS[campo]} de ${p.n}`);
  }
  delete estado.pend[chat];
  estadoSucio = true;
  await enviar(chat, "✅ Guardado. La web se actualiza en 1–3 minutos.");
  return mostrarFicha(chat, p);
}

// ---------- alta de productos (fast / lenta, varias fotos, video, web) ----------
const fotoId = msg => msg.photo?.at(-1)?.file_id || (msg.document?.mime_type?.startsWith("image/") ? msg.document.file_id : null);
const videoId = msg => (msg.video?.file_id) || (msg.document?.mime_type?.startsWith("video/") ? msg.document.file_id : null);

/* busca en la web, redacta la ficha y la muestra */
async function redactarFicha(chat, st) {
  const d = st.datos;
  await tg("sendChatAction", { chat_id: chat, action: "typing" });
  const hallazgos = await buscarEnLaWeb(`${d.n} especificaciones ficha técnica`);
  const ficha = await generarFicha(d.n, hallazgos, d.c);
  d.dc = ficha.dc; d.dl = ficha.dl; d.sp = ficha.sp; d.v = ficha.v;
  const adiv = adivinarCategoria(d.n, db.GRUPOS);
  if (adiv) { d.g = adiv.g; d.c = adiv.c; }
  estadoSucio = true;
  const previo = `🔍 Busqué <b>${esc(d.n)}</b> en la web y redacté la ficha:\n\n<b>Desc. corta:</b> ${esc(d.dc)}\n<b>Texto de venta:</b> ${esc(d.v)}${d.sp?.length ? `\n<b>Especificaciones:</b>\n${d.sp.map(([k, v]) => `   · ${esc(k)}: ${esc(v)}`).join("\n")}` : ""}${d.c ? `\n\n📂 Categoría: <b>${esc(db.GRUPOS[d.g]?.nombre)} › ${esc(d.c)}</b> (puede cambiarla después buscando el producto)` : ""}`;
  return enviar(chat, previo + "\n\nPuede ajustar todo después (busque el producto y toque «Editar»).");
}

/* crea el producto a partir del estado acumulado */
async function crearProducto(chat, st) {
  const d = st.datos;
  const p = { s: slugDe(d.n), n: d.n, c: d.c, g: d.g, pv: d.pv, po: d.pv, e: "hay", dc: d.dc, dl: d.dl, sp: d.sp || [], v: d.v };
  const archivos = [];
  for (const fid of st.fotos.slice(0, 6)) {
    try { archivos.push(await bajarFoto(fid, p.s)); } catch { /* foto suelta */ }
  }
  const ok = archivos.filter(Boolean);
  if (ok.length === 1) p.f = ok[0];
  else if (ok.length > 1) p.fs = ok;
  if (st.video) {
    try { p.vd = await bajarVideo(st.video, p.s); } catch { /* video suelto */ }
  }
  db.CATALOGO.unshift(p);
  marcar(`Nuevo: ${p.n}`);
  delete estado.pend[chat]; estadoSucio = true;
  await enviar(chat, `✅ <b>${esc(p.n)}</b> agregado${p.fs ? ` con ${p.fs.length} fotos` : ""}${p.vd ? " y vídeo" : ""}. Aparecerá primero en el catálogo en 1–3 minutos.`);
  return mostrarFicha(chat, p);
}

/* pregunta cuántas fotos y prepara la recolección */
function preguntarFotos(chat, st) {
  st.paso = "fotos-cuantas"; estadoSucio = true;
  return enviar(chat, "🖼 ¿Cuántas fotos tiene el producto?", teclado([
    [{ text: "1 foto", callback_data: "nfoto:1" }, { text: "2 fotos", callback_data: "nfoto:2" }, { text: "3 fotos", callback_data: "nfoto:3" }],
    [{ text: "4 fotos", callback_data: "nfoto:4" }, { text: "5 fotos", callback_data: "nfoto:5" }, { text: "6 fotos", callback_data: "nfoto:6" }]
  ]));
}

async function pasoNuevo(chat, msg) {
  const st = estado.pend[chat];
  const txt = (msg.text || msg.caption || "").trim();
  const d = st.datos;
  const fid = fotoId(msg);
  const vid = videoId(msg);

  if (st.paso === "modo") return enviar(chat, "Toque <b>⚡ Fast</b> o <b>🐢 Completa</b> para empezar (o /cancelar).");

  /* las fotos/vídeo pueden llegar en cualquier momento del alta: se acumulan */
  if (fid && ["entrada", "nombre", "foto"].includes(st.paso) && !st.fotos.includes(fid) && st.fotos.length < 6) st.fotos.push(fid);
  if (vid && !st.video) st.video = vid;

  /* -------- modo FAST -------- */
  if (st.modo === "fast") {
    if (st.paso === "entrada") {
      const nombre = nombreDeTexto(txt);
      if (!nombre && !st.fotos.length && !st.video)
        return enviar(chat, "⚡ Reenvíeme el mensaje del proveedor (texto y/o fotos), o escriba el nombre del producto (o /cancelar).");
      if (nombre) {
        d.n = nombre;
        await redactarFicha(chat, st);
        return preguntarFotos(chat, st);
      }
      st.paso = "nombre"; estadoSucio = true;
      return enviar(chat, `📸 Recibido. ¿Cómo se llama el producto? (con el nombre lo busco en la web y redacto la ficha)`);
    }
    if (st.paso === "nombre") {
      if (!txt) return enviar(chat, `📸 Foto guardada. Escríbame el nombre del producto (o /cancelar).`);
      d.n = txt;
      await redactarFicha(chat, st);
      return preguntarFotos(chat, st);
    }
    if (st.paso === "fotos-cuantas") {
      return enviar(chat, "Toque un botón de arriba para decirme cuántas fotos son.");
    }
    if (st.paso === "foto") {
      if (!fid && !vid) {
        const faltan = st.fotosTotal - st.fotos.length;
        if (faltan > 0) return enviar(chat, `Envíeme las fotos (faltan <b>${faltan}</b>). Un vídeo-demo también sirve: reenvíelo y lo añado.`);
      }
      if (st.fotos.length >= st.fotosTotal) {
        st.paso = "precio"; estadoSucio = true;
        return enviar(chat, `📸 Listo, ${st.fotosTotal} foto(s) recibida(s).\n\n💲 ¿Precio que verá el cliente, en USD? (solo el número, ej. <b>450</b>)`);
      }
      return enviar(chat, `✅ Foto ${st.fotos.length}/${st.fotosTotal}. Siga enviando.`);
    }
    if (st.paso === "precio") {
      const n = numero(txt);
      if (!n || n <= 0) return enviar(chat, "Escriba solo el número, por ejemplo <b>450</b>.");
      d.pv = Math.round(n * 100);
      if (!d.g || !d.c) {
        st.paso = "espera-cat"; estadoSucio = true;
        return enviar(chat, "📂 No pude adivinar la categoría. Elija una:", botonesCategorias("ncat"));
      }
      return crearProducto(chat, st);
    }
    if (st.paso === "espera-cat") {
      return enviar(chat, "Toque una categoría de las de arriba (o /cancelar).");
    }
  }

  /* -------- modo LENTA: flujo clásico ampliado -------- */
  if (st.paso === "l-nombre") {
    if (!txt) return enviar(chat, "Escriba el nombre del producto.");
    d.n = txt; st.paso = "l-precio";
    return enviar(chat, "💲 ¿Precio que verá el cliente, en USD? (solo el número, ej. <b>450</b>)");
  }
  if (st.paso === "l-precio") {
    const n = numero(txt);
    if (!n || n <= 0) return enviar(chat, "Escriba solo el número, por ejemplo <b>450</b>.");
    d.pv = Math.round(n * 100); st.paso = "l-cat";
    return enviar(chat, "📂 Elija la categoría:", botonesCategorias("ncat"));
  }
  if (st.paso === "l-desc") {
    if (!txt) return enviar(chat, "Escriba una descripción del producto.");
    d.dl = txt;
    d.dc = txt.length > 90 ? txt.slice(0, txt.lastIndexOf(" ", 88)) + "…" : txt;
    st.paso = "l-venta";
    return enviar(chat, "💬 Texto de venta (por qué le conviene al cliente). Escríbalo, o toque <b>Hacerlo automático</b>.", teclado([[{ text: "Hacerlo automático", callback_data: "nauto" }]]));
  }
  if (st.paso === "l-venta") {
    if (!txt) return enviar(chat, "Escriba el texto de venta o toque «Hacerlo automático».");
    d.v = txt;
    return preguntarFotos(chat, st);
  }
  if (st.paso === "fotos-cuantas") {
    return enviar(chat, "Toque un botón de arriba para decirme cuántas fotos son.");
  }
  if (st.paso === "foto") {
    if (!fid && !vid) {
      const faltan = st.fotosTotal - st.fotos.length;
      if (faltan > 0) return enviar(chat, `Envíeme las fotos (faltan <b>${faltan}</b>). Un vídeo-demo también sirve: reenvíelo y lo añado.`);
    }
    if (st.fotos.length >= st.fotosTotal) return crearProducto(chat, st);
    return enviar(chat, `✅ Foto ${st.fotos.length}/${st.fotosTotal}. Siga enviando.`);
  }
  return enviar(chat, "Algo se cruzó. /cancelar y empezamos de nuevo.", MENU);
}

// ---------- gestión de categorías ----------
function pasoCat(chat, msg) {
  const st = estado.pend[chat];
  const txt = (msg.text || "").trim();
  if (st.paso === "addsub") {
    const nombre = txt.replace(/\s+/g, " ").slice(0, 40);
    if (!nombre) return enviar(chat, "Escriba el nombre de la subcategoría (o /cancelar).");
    const d = db.GRUPOS[st.g];
    if (d.subs.some(s => norm(s) === norm(nombre))) return enviar(chat, `«${esc(nombre)}» ya existe en ${esc(d.nombre)}. Otro nombre (o /cancelar).`);
    d.subs.push(nombre);
    marcar(`Nueva subcategoría: ${d.nombre} › ${nombre}`);
    delete estado.pend[chat]; estadoSucio = true;
    return enviar(chat, `✅ Añadida <b>${esc(nombre)}</b> en ${esc(d.nombre)}. Ya puede usarla al agregar productos. La web se actualiza en 1–3 minutos.`, MENU_CATS());
  }
  if (st.paso === "addgrp") {
    const nombre = txt.replace(/\s+/g, " ").slice(0, 40);
    if (!nombre) return enviar(chat, "Escriba el nombre del grupo (o /cancelar).");
    let key = norm(nombre).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grupo";
    while (db.GRUPOS[key]) key += "-2";
    db.GRUPOS[key] = { nombre, subs: ["Otros"] };
    marcar(`Nuevo grupo: ${nombre}`);
    delete estado.pend[chat]; estadoSucio = true;
    return enviar(chat, `✅ Grupo <b>${esc(nombre)}</b> creado con la subcategoría «Otros». Añada más subcategorías cuando quiera. La web se actualiza en 1–3 minutos.`, MENU_CATS());
  }
  return enviar(chat, "Toque una opción del menú de categorías (o /cancelar).", MENU_CATS());
}

// ---------- router ----------
async function onMensaje(msg) {
  const chat = msg.chat.id;
  const txt = (msg.text || "").trim();

  if (!estado.owner) {
    const m = txt.match(/^\/(?:dueno|dueño)\s+(\S+)/i);
    if (m && config.claveHash && crypto.createHash("sha256").update(m[1]).digest("hex") === config.claveHash) {
      estado.owner = chat; estadoSucio = true;
      await enviar(chat, "🔐 Listo, ahora usted es el dueño de este bot. Nadie más podrá usarlo.");
      return enviar(chat, AYUDA, MENU);
    }
    return enviar(chat, "Este bot es privado. Si es el dueño, envíe: /dueno SU_CLAVE");
  }
  if (chat !== estado.owner) return enviar(chat, "Este bot es privado.");

  if (/^\/(start|ayuda|menu|help)\b/i.test(txt)) { delete estado.pend[chat]; estadoSucio = true; return enviar(chat, AYUDA, MENU); }
  if (/^\/cancelar\b/i.test(txt)) { delete estado.pend[chat]; estadoSucio = true; return enviar(chat, "Cancelado.", MENU); }
  if (/^\/nuevo\b/i.test(txt)) return iniciarNuevo(chat);

  const st = estado.pend[chat];
  if (st?.tipo === "nuevo") return pasoNuevo(chat, msg);
  if (st?.tipo === "cat") return pasoCat(chat, msg);
  if (st?.tipo === "editar") {
    const p = buscarP(st.s);
    if (!p) { delete estado.pend[chat]; return enviar(chat, "Ese producto ya no existe.", MENU); }
    return aplicarEdicion(chat, st.campo, p, msg);
  }
  if (txt && !txt.startsWith("/")) return buscar(chat, txt);
  return enviar(chat, AYUDA, MENU);
}

async function iniciarNuevo(chat) {
  estado.pend[chat] = { tipo: "nuevo", modo: null, paso: "modo", datos: {}, fotos: [], fotosTotal: 0, video: null }; estadoSucio = true;
  return enviar(chat, "➕ <b>Nuevo producto</b>\n\n¿Cómo lo agregamos?", teclado([
    [{ text: "⚡ Fast — reenvía y listo", callback_data: "nmodo:fast" }],
    [{ text: "🐢 Completa — todo a mano", callback_data: "nmodo:lenta" }]
  ]));
}

async function bajarVideo(fileId, slug) {
  const f = await tg("getFile", { file_id: fileId });
  if (!f.ok) throw new Error("No pude descargar el vídeo");
  const r = await fetchConReintentos(`${API}/file/bot${TOKEN}/${f.result.file_path}`, {}, { etiqueta: "Descarga de vídeo", timeoutMs: 30000 });
  if (!r?.ok) throw new Error("No pude descargar el vídeo tras varios intentos");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 18 * 1024 * 1024) throw new Error("Vídeo demasiado grande (máx. ~18 MB)");
  const ext = (f.result.file_path.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nombre = `${slug}-video-${Date.now().toString(36)}.${ext || "mp4"}`;
  fs.writeFileSync(path.join(DIR_FOTOS, nombre), buf);
  return nombre;
}

async function buscar(chat, q) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  const res = db.CATALOGO.filter(p => { const h = norm(`${p.n} ${p.c} ${p.dc}`); return t.every(w => h.includes(w)); }).slice(0, 12);
  if (!res.length) return enviar(chat, `No encontré nada con «${esc(q)}». Pruebe con otra palabra.`);
  return enviar(chat, `Encontré ${res.length}${res.length === 12 ? " (o más)" : ""}. Toque uno:`,
    teclado(res.map(p => [{ text: `${p.e === "agotado" ? "🔴" : "🟢"} ${p.n.slice(0, 40)} · ${usd(p.pv)}`, callback_data: `ver:${clave(p.s)}` }])));
}

async function onBoton(q) {
  const chat = q.message?.chat?.id;
  await tg("answerCallbackQuery", { callback_query_id: q.id });
  if (!chat || chat !== estado.owner) return;
  const [acc, a, b] = q.data.split(":");
  const p = porClave(acc === "ed" ? b : a);

  if (acc === "nada") return;
  if (acc === "nuevo") return iniciarNuevo(chat);
  if (acc === "nmodo") {
    const st = estado.pend[chat]; if (st?.tipo !== "nuevo" || st.paso !== "modo") return;
    st.modo = a; estadoSucio = true;
    if (a === "fast") {
      st.paso = "entrada";
      return enviar(chat, "⚡ <b>Modo fast</b>\n\nReenvíeme el mensaje del proveedor (texto y/o fotos). Yo busco el producto en la web, redacto la ficha y le pido precio y fotos. Si el nombre no sale del mensaje, se lo pregunto.\n\nAdelante (o /cancelar).");
    }
    st.paso = "l-nombre";
    return enviar(chat, "🐢 <b>Modo completa</b>\n\n¿Cómo se llama el producto? (o /cancelar)");
  }
  if (acc === "nfoto") {
    const st = estado.pend[chat]; if (st?.tipo !== "nuevo" || st.paso !== "fotos-cuantas") return;
    st.fotosTotal = Math.min(6, Math.max(1, Number(a) || 1));
    st.paso = "foto"; estadoSucio = true;
    if (st.fotos.length >= st.fotosTotal) {
      /* ya llegó todo en el reenvío */
      if (st.modo === "fast") {
        st.paso = "precio";
        return enviar(chat, `📸 Ya tengo las ${st.fotosTotal} foto(s).\n\n💲 ¿Precio que verá el cliente, en USD? (solo el número, ej. <b>450</b>)`);
      }
      return crearProducto(chat, st);
    }
    const faltan = st.fotosTotal - st.fotos.length;
    return enviar(chat, `🖼 Envíeme ${faltan === 1 ? "la foto" : `las <b>${faltan}</b> fotos`}${st.modo === "fast" ? "" : " del producto"}${st.video ? "" : ". Si tiene vídeo-demo, reenvíelo también."}`);
  }
  if (acc === "buscar") return enviar(chat, "Escriba el nombre o una palabra del producto (ej. <i>nevera</i>).");
  if (acc === "cats") {
    return enviar(chat, `🗂 <b>Categorías</b>\n\n${textoCategorias()}\n\n¿Qué quiere hacer?`, MENU_CATS());
  }
  if (acc === "menu") return enviar(chat, AYUDA, MENU);
  /* --- gestión de categorías --- */
  if (acc === "cadd" && !a) {
    estado.pend[chat] = { tipo: "cat", paso: "addsub-g" }; estadoSucio = true;
    return enviar(chat, "➕ ¿A qué grupo añado la subcategoría?", botonesGrupos("cadd"));
  }
  if (acc === "cadd" && a && db.GRUPOS[a]) {
    const st = estado.pend[chat]; if (st?.tipo !== "cat") return;
    st.paso = "addsub"; st.g = a; estadoSucio = true;
    return enviar(chat, `Escriba el nombre de la nueva subcategoría para <b>${esc(db.GRUPOS[a].nombre)}</b> (o /cancelar):`);
  }
  if (acc === "cdel" && !a) {
    estado.pend[chat] = { tipo: "cat", paso: "delsub-g" }; estadoSucio = true;
    return enviar(chat, "🗑 ¿De qué grupo borro una subcategoría?", botonesGrupos("cdel"));
  }
  if (acc === "cdel" && a && db.GRUPOS[a]) {
    const d = db.GRUPOS[a];
    return enviar(chat, `🗑 Subcategoría de <b>${esc(d.nombre)}</b> que quiero borrar:`, teclado(
      d.subs.map(s => [{ text: `${s} (${db.CATALOGO.filter(p => p.g === a && p.c === s).length})`, callback_data: `cdels:${a}:${d.subs.indexOf(s)}` }]).concat([[{ text: "◀ Atrás", callback_data: "cats" }]])
    ));
  }
  if (acc === "cdels" && db.GRUPOS[a]) {
    const d = db.GRUPOS[a], sub = d.subs[Number(b)];
    if (!sub) return enviar(chat, "Esa subcategoría ya no existe.", MENU_CATS());
    const n = db.CATALOGO.filter(p => p.g === a && p.c === sub).length;
    const tieneOtros = d.subs.includes("Otros");
    if (n > 0 && !tieneOtros) return enviar(chat, `⚠️ «${esc(sub)}» tiene <b>${n}</b> producto(s) y el grupo no tiene «Otros» donde moverlos. Cree primero la subcategoría «Otros» o mueva los productos.`, MENU_CATS());
    return enviar(chat, n > 0
      ? `¿Borrar «${esc(sub)}» y mover sus <b>${n}</b> producto(s) a «Otros»?`
      : `¿Borrar «${esc(sub)}»? No tiene productos.`,
      teclado([[{ text: "Sí, borrar", callback_data: `cdelok:${a}:${b}` }, { text: "No", callback_data: "cats" }]]));
  }
  if (acc === "cdelok" && db.GRUPOS[a]) {
    const d = db.GRUPOS[a], i = Number(b), sub = d.subs[i];
    if (!sub) return enviar(chat, "Esa subcategoría ya no existe.", MENU_CATS());
    if (d.subs.length <= 1) return enviar(chat, "⚠️ Un grupo no puede quedarse sin subcategorías. Añada otra primero.", MENU_CATS());
    let movidos = 0;
    if (d.subs.includes("Otros")) for (const p of db.CATALOGO) if (p.g === a && p.c === sub) { p.c = "Otros"; movidos++; }
    d.subs.splice(i, 1);
    marcar(`Borrada subcategoría: ${d.nombre} › ${sub}${movidos ? ` (${movidos} → Otros)` : ""}`);
    delete estado.pend[chat]; estadoSucio = true;
    return enviar(chat, `✅ Borrada <b>${esc(sub)}</b>${movidos ? `, ${movidos} producto(s) movidos a «Otros»` : ""}.\n\n${textoCategorias()}`, MENU_CATS());
  }
  if (acc === "gadd") {
    estado.pend[chat] = { tipo: "cat", paso: "addgrp" }; estadoSucio = true;
    return enviar(chat, "🗂 Escriba el nombre del grupo nuevo (ej. <b>Tecnología</b>). Le creo dentro la subcategoría «Otros» (o /cancelar):");
  }
  if (acc === "gdel" && !a) return enviar(chat, "🗂 Grupo que quiero borrar (solo si no tiene productos):", botonesGrupos("gdel"));
  if (acc === "gdel" && a && db.GRUPOS[a]) {
    const n = db.CATALOGO.filter(p => p.g === a).length;
    if (n > 0) return enviar(chat, `⚠️ <b>${esc(db.GRUPOS[a].nombre)}</b> tiene <b>${n}</b> producto(s). Mueva o borre los productos primero.`, MENU_CATS());
    if (Object.keys(db.GRUPOS).length <= 1) return enviar(chat, "⚠️ Debe existir al menos un grupo.", MENU_CATS());
    return enviar(chat, `¿Borrar el grupo <b>${esc(db.GRUPOS[a].nombre)}</b> y todas sus subcategorías? No tiene productos.`,
      teclado([[{ text: "Sí, borrar", callback_data: `gdelok:${a}` }, { text: "No", callback_data: "cats" }]]));
  }
  if (acc === "gdelok" && db.GRUPOS[a]) {
    const nombre = db.GRUPOS[a].nombre;
    delete db.GRUPOS[a];
    marcar(`Borrado grupo: ${nombre}`);
    delete estado.pend[chat]; estadoSucio = true;
    return enviar(chat, `✅ Grupo <b>${esc(nombre)}</b> borrado.\n\n${textoCategorias()}`, MENU_CATS());
  }
  if (acc === "ncat") {
    const st = estado.pend[chat]; if (st?.tipo !== "nuevo") return;
    st.datos.g = a; st.datos.c = db.GRUPOS[a].subs[Number(b)]; estadoSucio = true;
    if (st.modo === "fast") {
      if (st.paso === "espera-cat" && st.datos.pv) return crearProducto(chat, st);
      return enviar(chat, `📂 ${esc(st.datos.c)}. Puede seguir.`);
    }
    st.paso = "l-desc";
    return enviar(chat, `📂 ${esc(st.datos.c)}\n\n📝 Escriba la descripción del producto (qué es, medidas, material, garantía…).`);
  }
  if (acc === "nauto") {
    const st = estado.pend[chat]; if (st?.tipo !== "nuevo") return;
    await tg("sendChatAction", { chat_id: chat, action: "typing" });
    const h = await buscarEnLaWeb(`${st.datos.n} especificaciones`);
    const f = generarFichaLocal(st.datos.n, h);
    st.datos.v = f.v;
    if (!st.datos.sp?.length) st.datos.sp = f.sp;
    estadoSucio = true;
    return preguntarFotos(chat, st);
  }
  if (!p) return enviar(chat, "Ese producto ya no existe.", MENU);
  if (acc === "ver") return mostrarFicha(chat, p);
  if (acc === "ed") {
    estado.pend[chat] = { tipo: "editar", campo: a, s: p.s }; estadoSucio = true;
    const pide = { pv: "Escriba el <b>precio nuevo</b> en USD (solo el número).", foto: "Envíeme la <b>foto nueva</b>.", sp: "Escriba las especificaciones, una por línea, así:\n<code>Garantía: 7 días\nColor: Negro</code>\n(o «borrar» para quitarlas)" }[a]
      || `Escriba el/la <b>${CAMPOS[a]}</b> nuevo/a:`;
    return enviar(chat, `${pide}\n\n(/cancelar para salir)`);
  }
  if (acc === "cat") return enviar(chat, `📂 Nueva categoría para <b>${esc(p.n)}</b>:`, botonesCategorias(`mv|${clave(p.s)}`));
  if (acc === "est") {
    const textoBoton = q.message?.reply_markup?.inline_keyboard?.flat()?.find(x => x.callback_data === q.data)?.text || "";
    const objetivo = b === "agotado" || b === "hay" ? b
      : textoBoton.includes("Marcar agotado") ? "agotado"
      : textoBoton.includes("Marcar disponible") ? "hay" : null;
    if (!objetivo) return enviar(chat, "⚠️ Ese botón está desactualizado. Vuelva a abrir la ficha del producto.", MENU);
    if (p.e === objetivo) return enviar(chat, `ℹ️ El catálogo ya marca <b>${esc(p.n)}</b> como ${objetivo === "agotado" ? "agotado" : "disponible"}. No repetí la acción; revise la web antes de volver a pulsar.`);
    p.e = objetivo;
    marcar(`${p.n}: ${p.e === "agotado" ? "agotado" : "disponible"}`);
    await enviar(chat, `✅ ${esc(p.n)} ahora está <b>${p.e === "agotado" ? "agotado" : "disponible"}</b>.`);
    return mostrarFicha(chat, p);
  }
  if (acc === "del") return enviar(chat, `¿Seguro que quiere borrar <b>${esc(p.n)}</b>? No se puede deshacer.`,
    teclado([[{ text: "Sí, borrar", callback_data: `delok:${clave(p.s)}` }, { text: "No", callback_data: `ver:${clave(p.s)}` }]]));
  if (acc === "delok") {
    db.CATALOGO = db.CATALOGO.filter(x => x !== p);
    borrarFotoVieja(p);
    const orig = path.join(DIR_FOTOS, p.s + ".webp");
    if (fs.existsSync(orig)) fs.unlinkSync(orig);
    marcar(`Borrado: ${p.n}`);
    return enviar(chat, `✅ Borrado <b>${esc(p.n)}</b>.`, MENU);
  }
}
// mover de categoría: callback "mv|slug:g:i"
async function onBotonMover(q) {
  const chat = q.message?.chat?.id;
  await tg("answerCallbackQuery", { callback_query_id: q.id });
  if (chat !== estado.owner) return;
  const [pre, g, i] = q.data.split(":");
  const p = porClave(pre.split("|")[1]);
  if (!p || !db.GRUPOS[g]) return enviar(chat, "No encontré ese producto.", MENU);
  p.g = g; p.c = db.GRUPOS[g].subs[Number(i)];
  marcar(`${p.n} → ${p.c}`);
  await enviar(chat, `✅ Movido a <b>${esc(db.GRUPOS[g].nombre)} › ${esc(p.c)}</b>.`);
  return mostrarFicha(chat, p);
}

// ---------- publicar ----------
async function githubApi(metodo, ruta) {
  const token = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("Falta GH_TOKEN o GITHUB_REPOSITORY para verificar Pages");
  const r = await fetchConReintentos(`https://api.github.com/repos/${repo}${ruta}`, {
    method: metodo,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  }, { etiqueta: `GitHub ${metodo} ${ruta}`, timeoutMs: 15000 });
  if (!r) throw new Error(`Sin respuesta de GitHub en ${ruta}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${ruta}: HTTP ${r.status} ${data.message || ""}`.trim());
  return data;
}
async function esperarPages(commit) {
  const fin = Date.now() + 240000;
  let build;
  while (Date.now() < fin) {
    build = await githubApi("GET", "/pages/builds/latest");
    if (build.commit === commit && build.status === "built") return build;
    if (build.commit === commit && build.status === "errored")
      throw new Error(`GitHub Pages marcó error: ${build.error?.message || "sin detalle"}`);
    await pausa(5000);
  }
  throw new Error(`Pages no confirmó el commit ${commit} (último estado: ${build?.status || "sin estado"})`);
}
async function avisarFalloPublicacion(texto, reintentara = true) {
  const chats = [...new Set(confirmacionesPublicacion.map(x => x.chat))];
  if (!chats.length && estado.owner) chats.push(estado.owner);
  for (const chat of chats) {
    const pendientes = confirmacionesPublicacion.filter(x => x.chat === chat);
    if (pendientes.length && pendientes.every(x => x.avisoEnviado)) continue;
    const r = await tg("sendMessage", {
      chat_id: chat,
      text: `⚠️ ${texto} No repita el cambio hasta revisar la web.${reintentara ? " Seguiré reintentando la publicación." : " No se enviará un check hasta confirmar la publicación."}`,
      parse_mode: "HTML"
    });
    if (r.ok) for (const x of pendientes) x.avisoEnviado = true;
  }
}
async function enviarConfirmacionesPublicadas() {
  const pendientes = confirmacionesPublicacion.splice(0);
  for (const x of pendientes) {
    const r = await tg("sendMessage", {
      chat_id: x.chat,
      text: `${x.text}\n\n🌐 Publicación verificada en Nexo.`,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...x.extra
    });
    if (!r.ok) console.warn(`No pude entregar la confirmación publicada a ${x.chat}: ${r.description || "error Telegram"}`);
  }
}
async function pushConReintentos() {
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      execSync("git pull -q --rebase -X ours origin main", { cwd: RAIZ, stdio: "pipe", timeout: 30000 });
      execSync("git push -q origin HEAD:main", { cwd: RAIZ, stdio: "pipe", timeout: 30000 });
      return;
    } catch (e) {
      ultimoError = e;
      try { execSync("git rebase --abort", { cwd: RAIZ, stdio: "ignore" }); } catch { /* puede no haber rebase abierto */ }
      if (intento < 3) await pausa(1000 * (2 ** (intento - 1)));
    }
  }
  throw ultimoError;
}
async function publicar() {
  const cambioWeb = sucio;
  if (!cambioWeb && !estadoSucio) return true;
  if (SIN_GIT) {
    console.warn("Publicación omitida: BOT_SIN_GIT está activado.");
    await avisarFalloPublicacion("La publicación no está habilitada en este entorno.", false);
    return false;
  }
  const msg = cambioWeb ? "Bot: " + (cambios.join("; ") || "actualización de catálogo").slice(0, 200) : "Bot: estado";
  let pushOk = false;
  try {
    if (cambioWeb) {
      guardarCatalogo(db);
      execSync("node --check catalogo.js", { cwd: RAIZ, stdio: "pipe" });
    }
    fs.writeFileSync(F_EST, JSON.stringify(estado, null, 1));
    execSync("git add -A catalogo.js index.html fotos bot/estado.json", { cwd: RAIZ, stdio: "pipe" });
    const staged = execSync("git diff --cached --name-only", { cwd: RAIZ, encoding: "utf8" }).trim();
    if (staged) execSync(`git commit -q -m ${JSON.stringify(msg)}`, { cwd: RAIZ, stdio: "pipe" });
    await pushConReintentos();
    pushOk = true;
    const commit = execSync("git rev-parse HEAD", { cwd: RAIZ, encoding: "utf8" }).trim();
    if (cambioWeb) {
      await githubApi("POST", "/pages/builds");
      await esperarPages(commit);
    }
    sucio = estadoSucio = false;
    cambios.length = 0;
    if (cambioWeb) {
      await avisoWhatsApp(`Nexo web actualizada: ${msg}`);
      await enviarConfirmacionesPublicadas();
      const fichas = fichasPendientes.splice(0);
      for (const ficha of fichas) await mostrarFicha(ficha.chat, ficha.p);
    }
    return true;
  } catch (e) {
    console.error("publicación:", e.message);
    await avisarFalloPublicacion(pushOk
      ? "GitHub recibió el cambio, pero Pages no confirmó que terminara la publicación."
      : "No pude confirmar el guardado en GitHub.", !pushOk);
    if (pushOk) {
      sucio = estadoSucio = false;
      cambios.length = 0;
      confirmacionesPublicacion.length = 0;
      fichasPendientes.length = 0;
    }
    return false;
  }
}

// ---------- bucle ----------
export async function procesar(u) {
  try {
    if (u.message) await onMensaje(u.message);
    else if (u.callback_query) {
      if (/^mv\|/.test(u.callback_query.data)) await onBotonMover(u.callback_query);
      else await onBoton(u.callback_query);
    }
  } catch (e) {
    console.log("error", e);
    const chat = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
    if (chat === estado.owner) await enviar(chat, "⚠️ Algo falló con eso. Inténtelo de nuevo.");
  }
}

async function main() {
  if (!TOKEN) { console.log("Falta TELEGRAM_TOKEN"); process.exit(1); }
  await tg("setMyCommands", { commands: [
    { command: "menu", description: "Abrir el panel" }, { command: "nuevo", description: "Agregar producto" }, { command: "cancelar", description: "Cancelar lo actual" }
  ] });
  const fin = Date.now() + DURACION_MS;
  while (Date.now() < fin) {
    const espera = Math.max(1, Math.min(50, Math.floor((fin - Date.now()) / 1000) - 5));
    const r = await tg("getUpdates", { offset: estado.offset, timeout: espera, allowed_updates: ["message", "callback_query"] });
    if (!r.ok) {
      if (sucio || estadoSucio) await publicar();
      await pausa(3000);
      continue;
    }
    for (const u of r.result) {
      estado.offset = u.update_id + 1; estadoSucio = true;
      await procesar(u);
    }
    if (sucio || estadoSucio) await publicar();
  }
  if (sucio || estadoSucio) await publicar();
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
