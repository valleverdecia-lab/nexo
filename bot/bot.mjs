// Bot de Telegram para administrar el catálogo de Nexo.
// Corre dentro de GitHub Actions: lee mensajes, edita catalogo.js / fotos y publica.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

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
function textoVentaAuto(p) {
  return `${p.n} es de esos productos que se notan desde el primer día. Resuelve lo que necesita, se ve bien en su casa y le da la tranquilidad de haber comprado algo que vale la pena. Escríbanos y se lo llevamos.`;
}

// ---------- Telegram ----------
async function tg(metodo, datos = {}) {
  const r = await fetch(`${API}/bot${TOKEN}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && metodo !== "getUpdates") console.log("TG error", metodo, j.description);
  return j;
}
const enviar = (chat, text, extra = {}) => tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
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
  const r = await fetch(`${API}/file/bot${TOKEN}/${f.result.file_path}`);
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

• <b>Agregar producto</b>: le pido nombre, precio, categoría, descripción y foto.
• <b>Editar</b>: escriba cualquier palabra (ej. <i>sillón</i>) y toque el producto.
• Dentro de cada producto puede cambiar precio, nombre, descripciones, foto, categoría, disponibilidad o borrarlo.
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
    [{ text: p.e === "agotado" ? "🟢 Marcar disponible" : "🔴 Marcar agotado", callback_data: `est:${s}` }],
    [{ text: "🗑 Borrar producto", callback_data: `del:${s}` }]
  ]);
}
async function mostrarFicha(chat, p) {
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

// ---------- alta de productos (paso a paso) ----------
async function pasoNuevo(chat, msg) {
  const st = estado.pend[chat];
  const txt = (msg.text || msg.caption || "").trim();
  const d = st.datos;
  if (st.paso === "nombre") {
    if (!txt) return enviar(chat, "Escriba el nombre del producto.");
    d.n = txt; st.paso = "precio";
    return enviar(chat, "💲 ¿Precio que verá el cliente, en USD? (solo el número, ej. <b>450</b>)");
  }
  if (st.paso === "precio") {
    const n = numero(txt);
    if (!n || n <= 0) return enviar(chat, "Escriba solo el número, por ejemplo <b>450</b>.");
    d.pv = Math.round(n * 100); st.paso = "cat";
    return enviar(chat, "📂 Elija la categoría:", botonesCategorias("ncat"));
  }
  if (st.paso === "desc") {
    if (!txt) return enviar(chat, "Escriba una descripción del producto.");
    d.dl = txt;
    d.dc = txt.length > 90 ? txt.slice(0, txt.lastIndexOf(" ", 88)) + "…" : txt;
    st.paso = "venta";
    return enviar(chat, "💬 Texto de venta (por qué le conviene al cliente). Escríbalo, o toque <b>Hacerlo automático</b>.", teclado([[{ text: "Hacerlo automático", callback_data: "nauto" }]]));
  }
  if (st.paso === "venta") {
    if (!txt) return enviar(chat, "Escriba el texto de venta o toque «Hacerlo automático».");
    d.v = txt; st.paso = "foto";
    return enviar(chat, "🖼 Ahora envíeme la <b>foto</b> del producto.");
  }
  if (st.paso === "foto") {
    const fid = msg.photo?.at(-1)?.file_id || (msg.document?.mime_type?.startsWith("image/") ? msg.document.file_id : null);
    if (!fid) return enviar(chat, "Envíeme una <b>foto</b> del producto.");
    const p = { s: slugDe(d.n), n: d.n, c: d.c, g: d.g, pv: d.pv, po: d.pv, e: "hay", dc: d.dc, dl: d.dl, sp: [], v: d.v };
    p.f = await bajarFoto(fid, p.s);
    db.CATALOGO.unshift(p);
    marcar(`Nuevo: ${p.n}`);
    delete estado.pend[chat]; estadoSucio = true;
    await enviar(chat, "✅ Producto agregado. Aparecerá primero en el catálogo en 1–3 minutos.");
    return mostrarFicha(chat, p);
  }
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
  if (st?.tipo === "editar") {
    const p = buscarP(st.s);
    if (!p) { delete estado.pend[chat]; return enviar(chat, "Ese producto ya no existe.", MENU); }
    return aplicarEdicion(chat, st.campo, p, msg);
  }
  if (txt && !txt.startsWith("/")) return buscar(chat, txt);
  return enviar(chat, AYUDA, MENU);
}

async function iniciarNuevo(chat) {
  estado.pend[chat] = { tipo: "nuevo", paso: "nombre", datos: {} }; estadoSucio = true;
  return enviar(chat, "➕ <b>Nuevo producto</b>\n\n¿Cómo se llama? (o /cancelar)");
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
  if (acc === "buscar") return enviar(chat, "Escriba el nombre o una palabra del producto (ej. <i>nevera</i>).");
  if (acc === "cats") {
    const t = Object.entries(db.GRUPOS).map(([g, d]) => `<b>${esc(d.nombre)}</b>\n` + d.subs.map(s => `  · ${esc(s)} (${db.CATALOGO.filter(p => p.g === g && p.c === s).length})`).join("\n")).join("\n\n");
    return enviar(chat, t, MENU);
  }
  if (acc === "ncat") {
    const st = estado.pend[chat]; if (st?.tipo !== "nuevo") return;
    st.datos.g = a; st.datos.c = db.GRUPOS[a].subs[Number(b)]; st.paso = "desc"; estadoSucio = true;
    return enviar(chat, `📂 ${esc(st.datos.c)}\n\n📝 Escriba la descripción del producto (qué es, medidas, material, garantía…).`);
  }
  if (acc === "nauto") {
    const st = estado.pend[chat]; if (st?.tipo !== "nuevo") return;
    st.datos.v = textoVentaAuto(st.datos); st.paso = "foto"; estadoSucio = true;
    return enviar(chat, "🖼 Ahora envíeme la <b>foto</b> del producto.");
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
    p.e = p.e === "agotado" ? "hay" : "agotado";
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
    return enviar(chat, `🗑 Borrado <b>${esc(p.n)}</b>. Desaparece de la web en 1–3 minutos.`, MENU);
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
function publicar() {
  if (sucio) guardarCatalogo(db);
  if (sucio || estadoSucio) fs.writeFileSync(F_EST, JSON.stringify(estado, null, 1));
  if (SIN_GIT || (!sucio && !estadoSucio)) { sucio = estadoSucio = false; return; }
  const msg = sucio ? "Bot: " + cambios.splice(0).join("; ").slice(0, 200) : "Bot: estado";
  try {
    execSync("git add -A catalogo.js index.html fotos bot/estado.json", { cwd: RAIZ });
    execSync(`git commit -q -m ${JSON.stringify(msg)}`, { cwd: RAIZ });
    execSync("git pull -q --rebase -X ours origin main && git push -q origin HEAD:main", { cwd: RAIZ, shell: "/bin/bash" });
    if (sucio && process.env.GH_TOKEN && process.env.GITHUB_REPOSITORY) {
      execSync(`curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/$GITHUB_REPOSITORY/pages/builds >/dev/null`, { shell: "/bin/bash" });
    }
  } catch (e) { console.log("git:", e.message); }
  sucio = estadoSucio = false;
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
    if (!r.ok) { await new Promise(s => setTimeout(s, 3000)); continue; }
    for (const u of r.result) {
      estado.offset = u.update_id + 1; estadoSucio = true;
      await procesar(u);
    }
    if (r.result.length) publicar();
  }
  publicar();
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
