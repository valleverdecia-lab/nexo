// Búsqueda web + redacción automática de fichas para el bot de Nexo.
// Estrategia:
//   1. Si hay OPENAI_API_KEY (opcional), redacta con LLM usando lo encontrado en la web.
//   2. Si no, DuckDuckGo (sin clave) + extracción de especificaciones por patrones
//      + plantillas de marketing por tipo de producto (cada una resuelve un problema distinto).
export const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";

const limpiar = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/* ---------- búsqueda en la web (DuckDuckGo, sin clave) ---------- */
export async function buscarEnLaWeb(consulta) {
  const out = { titulos: [], texto: "" };
  try {
    const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(consulta), {
      headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000)
    });
    const html = await r.text();
    out.titulos = [...html.matchAll(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 6).map(m => limpiar(m[1]));
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g)].map(m => limpiar(m[1])).join(" ");
    const enlaces = [...html.matchAll(/href="([^"]*uddg=[^"]+)"/g)].slice(0, 4).map(m => {
      try { return decodeURIComponent(m[1].match(/uddg=([^&]+)/)[1]); } catch { return null; }
    }).filter(Boolean);
    out.texto = snippets;
    /* bajar las 2 primeras páginas y sacar texto plano */
    for (const url of enlaces.slice(0, 2)) {
      try {
        const c = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
        if (!c.ok) continue;
        const t = await c.text();
        const cuerpo = limpiar(t.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " "));
        out.texto += " " + cuerpo.slice(0, 6000);
      } catch { /* página lenta o bloqueada: se ignora */ }
    }
    out.texto = out.texto.replace(/\s+/g, " ").slice(0, 14000);
  } catch { /* sin internet o DDG caído: seguimos con lo que haya */ }
  return out;
}

/* ---------- extracción de especificaciones ---------- */
const PATRONES = [
  ["Potencia", /(\d+(?:[.,]\d+)?)\s*(kW|HP|CV|BTU)\b/i, m => `${m[1].replace(",", ".")} ${m[2].toUpperCase()}`],
  ["Potencia", /(\d{3,5})\s*W\b/i, m => `${m[1]} W`],
  ["Capacidad", /(\d+(?:[.,]\d+)?)\s*(Ah|kWh|mAh|kVA)\b/i, m => `${m[1].replace(",", ".")} ${m[2]}`],
  ["Voltaje", /(\d{2,3}(?:[.,]\d+)?)\s*V(?:oltios)?\b/i, m => `${m[1].replace(",", ".")} V`],
  ["Capacidad", /(\d+(?:[.,]\d+)?)\s*(litros|kg|kilogramos|pies|libras|toneladas)\b/i, m => `${m[1].replace(",", ".")} ${({ kg: "kg", kilogramos: "kg", litros: "litros", pies: "pies", libras: "lb", toneladas: "ton" })[m[2].toLowerCase()] || m[2]}`],
  ["Dimensiones", /(\d{2,3}(?:[.,]\d+)?)\s*(cm|mm)?\s*[x×]\s*(\d{2,3}(?:[.,]\d+)?)\s*(cm|mm)?(?:\s*[x×]\s*(\d{2,3}(?:[.,]\d+)?))?/i, m => `${m[1]}×${m[3]}${m[5] ? "×" + m[5] : ""} ${m[2] || m[4] || "cm"}`.trim()],
  ["Pantalla", /(\d{2}(?:[.,]\d+)?)\s*(?:pulgadas|"|”|inches)\b/i, m => `${m[1].replace(",", ".")} pulgadas`],
  ["Frecuencia", /(\d{2,3})\s*Hz\b/i, m => `${m[1]} Hz`],
];
export function extraerSpecs(nombre, hallazgos) {
  const sp = [];
  const visto = new Set();
  /* el nombre del producto es la fuente más fiable; luego títulos; al final el texto crudo */
  const fuentes = [nombre, (hallazgos.titulos || []).join(" "), hallazgos.texto || ""];
  for (const fuente of fuentes) {
    for (const [clave, re, fmt] of PATRONES) {
      if (visto.has(clave)) continue;
      const m = String(fuente).match(re);
      if (m) { visto.add(clave); sp.push([clave, fmt(m)]); }
    }
  }
  /* marca conocida en el nombre */
  const MARCAS = ["Samsung", "LG", "Hisense", "TCL", "Royal", "EcoFlow", "Jackery", "Midea", "Haier", "Bosch", "Sony", "Panasonic", "Philips", "JBL", "Anker", "Duro", "Kipor", "Firman", "Vevor", "Sumry", "Sako", "Topmaq", "Movcan", "Bevomecon", "Insignia", "Xiaomi", "Honda", "Yamaha"];
  const marca = MARCAS.find(m => new RegExp(`\\b${m}\\b`, "i").test(nombre));
  if (marca && !visto.has("Marca")) sp.unshift(["Marca", marca]);
  return sp.slice(0, 6);
}

/* ---------- tipo de producto (para la plantilla de marketing) ---------- */
const TIPOS = [
  ["clima", /split|aire acondicionado|btu|climatizador|ventilador|enfriador|air cooler/i],
  ["energia", /bater[ií]a|inversor|panel solar|planta el[eé]ctrica|generador|ups|regulador|kwh|ah\b|solar/i],
  ["refrigeracion", /nevera|refrigerador|congelador|freezer|frigor[ií]fico|exhibidor/i],
  ["limpieza", /aspiradora|lavadora|secadora|lavaplatos|limpiadora|vaporera|fregadora/i],
  ["cocina", /estufa|cocina|horno|hornilla|freidora|air ?fryer|licuadora|batidora|cafetera|microondas|olla/i],
  ["tv", /televisor|smart ?tv|monitor|proyector|bocina|equipo de m[uú]sica|soundbar|barra de sonido/i],
  ["movilidad", /bicicleta|moto|triciclo|scooter|patinete|carro|auto\b/i],
  ["descanso", /sill[oó]n|sof[aá]|colch[oó]n|cama|silla|mesa|mueble|pergol/i],
  ["agua", /calentador de agua|ducha el[eé]ctrica|bomba de agua|tinaco|tanque|piscina/i],
];

/* descripciones largas de respaldo por tipo (cuando la web no aporta nada útil) */
const PLANTILLAS_DL = {
  clima: n => `Equipamiento de climatización para enfriar salas y dormitorios incluso en los días más calurosos. Instalación y asesoría disponibles por WhatsApp.`,
  energia: n => `Solución de energía para respaldar la casa durante los apagones: compatible con inversores y sistemas solares. Asesoría gratuita para dimensionar lo que su casa necesita.`,
  refrigeracion: n => `Refrigeración confiable para conservar alimentos y bebidas con tranquilidad, con entrega a domicilio en La Habana.`,
  limpieza: n => `Equipo para limpieza del hogar que ahorra tiempo y esfuerzo en las tareas diarias.`,
  cocina: n => `Equipamiento de cocina para facilitar la preparación diaria de alimentos. Vídeo-demostrativo disponible por WhatsApp.`,
  tv: n => `Equipamiento de audio y video para el entretenimiento de la familia en casa.`,
  movilidad: n => `Movilidad eléctrica para transportarse sin depender de la gasolina: carga en casa y mantenimiento asesorado.`,
  descanso: n => `Mobiliario para el hogar pensado para el descanso y la vida diaria, con foto real y precio claro.`,
  agua: n => `Solución para el manejo del agua en el hogar, con instalación asesorada y soporte después de la compra.`,
};

/* ---------- redacción con criterio de marketing (sin LLM) ---------- */
/* Cada plantilla resuelve UN problema concreto del cliente cubano. */
const PLANTILLAS = {
  clima: (n, sp) => `El calor en Cuba no perdona y un ventilador no basta. ${n} enfría la habitación de verdad${sp.Capacidad ? ` (${sp.Capacidad})` : ""}: duerme sin despertarse a medianoche y recibe visitas sin pena. Confirmamos existencias, coordinamos la entrega y le explicamos por WhatsApp lo que necesite saber antes de pagar.`,
  energia: (n, sp) => `Cuando la luz se va, su casa no tiene por qué quedarse a oscuras. ${n}${sp.Capacidad ? ` (${sp.Capacidad})` : ""}${sp.Voltaje ? ` de ${sp.Voltaje}` : ""} mantiene el refrigerador, los abanicos y la tele andando durante el apagón. Le asesoramos gratis para que compre exactamente lo que su casa necesita — ni más, ni menos.`,
  refrigeracion: (n, sp) => `Tirar comida por un apagón es tirar dinero. ${n}${sp.Capacidad ? ` (${sp.Capacidad})` : ""} conserva lo suyo con tranquilidad${sp.Marca ? `, con la calidad ${sp.Marca}` : ""}. Foto real, precio claro y entrega a domicilio: se lo llevamos hasta la cocina.`,
  limpieza: (n, sp) => `Su tiempo vale más que fregar. ${n} hace el trabajo pesado${sp.Capacidad ? ` (${sp.Capacidad})` : ""} mientras usted se ocupa de lo suyo. Si tiene dudas de si le conviene, agende una llamada gratuita antes de comprar y se lo explicamos sin compromiso.`,
  cocina: (n, sp) => `Cocinar con lo justo cansa y cuesta. ${n} ${sp.Capacidad ? `(${sp.Capacidad}) ` : ""}hace la vida en la cocina más fácil y más rápida, todos los días. Le enviamos vídeo-demostrativo por WhatsApp para que lo vea funcionando antes de decidir.`,
  tv: (n, sp) => `La sala de la casa merece algo mejor. ${n}${sp.Pantalla ? ` de ${sp.Pantalla}` : ""} convierte las noches de la familia en cine${sp.Marca ? ` con la confianza ${sp.Marca}` : ""}. Se lo entregamos en casa y le ayudamos a dejarlo montado.`,
  movilidad: (n, sp) => `Moverse en Cuba sin depender del camello ni de la gasolina. ${n} es transporte propio que se carga en la casa${sp.Capacidad ? ` (${sp.Capacidad})` : ""}. Le explicamos autonomía real y mantenimiento antes de que pague un peso.`,
  descanso: (n, sp) => `Descansar bien no es un lujo: es salud. ${n} está pensado para durar y para que la casa se vea como usted quiere. Foto real, precio claro y entrega coordinada hasta su puerta.`,
  agua: (n, sp) => `El agua no puede ser un problema todos los días. ${n}${sp.Capacidad ? ` (${sp.Capacidad})` : ""} resuelve lo suyo una vez y bien: instalación asesorada y soporte después de la compra.`,
  base: (n, sp) => `${n} resuelve lo que usted necesita sin vueltas ni sorpresas: foto real, precio claro y existencias confirmadas antes de pagar. Si quiere verlo antes, le enviamos vídeo-demostrativo por WhatsApp o agendamos una llamada gratuita.`,
};
function plantillaDe(nombre) {
  for (const [t, re] of TIPOS) if (re.test(nombre)) return t;
  return "base";
}
export function generarFichaLocal(nombre, hallazgos) {
  const sp = extraerSpecs(nombre, hallazgos);
  const tipo = plantillaDe(nombre);
  const spObj = Object.fromEntries(sp);
  const v = PLANTILLAS[tipo](nombre, spObj);
  /* descripción larga: primera frase útil de la web, si no, plantilla por tipo */
  const frases = limpiar(hallazgos.texto).match(/[^.!?]{40,240}[.!?]/g) || [];
  const BASURA = /haz clic|haga clic|click here|comprar ahora|añadir al carrito|ver m[aá]s|env[ií]o gratis|iniciar sesi[oó]n|reg[ií]strese|descuento|cup[oó]n|cookies|suscr[ií]base/i;
  const dlWeb = frases.find(f => !BASURA.test(f) && /[a-záéíóú]{4,}/i.test(f));
  const spTxt = sp.length ? " " + sp.map(([k, val]) => `${k}: ${val}`).join(", ") + "." : "";
  const dl = dlWeb
    ? limpiar(`${nombre}. ${dlWeb}${spTxt}`).slice(0, 400)
    : limpiar(`${nombre}. ${PLANTILLAS_DL[tipo] ? PLANTILLAS_DL[tipo](nombre, spObj) : "Disponible en Nexo con entrega a domicilio en La Habana y coordinación para todo el país."}${spTxt}`).slice(0, 400);
  const dc = dl.length > 90 ? dl.slice(0, dl.lastIndexOf(" ", 88)) + "…" : dl;
  return { dc, dl, sp, v };
}

/* ---------- redacción con LLM (opcional, si existe OPENAI_API_KEY) ---------- */
export async function generarFicha(nombre, hallazgos, categoria) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
      const modelo = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model: modelo, temperature: 0.6,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `Eres el redactor de fichas de producto de Nexo, tienda cubana que vende a clientes finales y a gestores de venta. Escribe en español de Cuba, trato de usted, sin exageraciones. Reglas: descripciones CONCRETAS y personalizadas según el producto y sus especificaciones reales (nada de frases genéricas tipo "calidad garantizada" o "excelente producto"); el texto de venta (v) resuelve UN problema concreto del cliente cubano y termina con una acción suave; máximo 45 palabras el texto de venta, 300 la descripción larga, 90 la corta. Responde SOLO JSON: {"dc": "...", "dl": "...", "v": "...", "sp": [["clave","valor"],...]}` },
            { role: "user", content: `Producto: ${nombre}\nCategoría: ${categoria || "por determinar"}\nInformación encontrada en la web:\n${hallazgos.texto.slice(0, 6000) || "(sin resultados; use su conocimiento del tipo de producto)"}` }
          ]
        })
      });
      const j = await r.json();
      const c = JSON.parse(j.choices[0].message.content);
      if (c.dc && c.dl && c.v) {
        return { dc: String(c.dc).slice(0, 120), dl: String(c.dl).slice(0, 450), v: String(c.v).slice(0, 400), sp: Array.isArray(c.sp) ? c.sp.slice(0, 8).filter(x => Array.isArray(x) && x[0]) : [] };
      }
    } catch (e) { /* si falla, usamos la versión local */ }
  }
  return generarFichaLocal(nombre, hallazgos);
}

/* ---------- adivinar categoría por palabras clave ---------- */
const CLAVES = [
  [/split|aire acondicionado|btu|climatizador|ventilador|abanic/i, "hogar", "Electrodomésticos"],
  [/nevera|refrigerad|congelador|freezer|exhibidor|frigor/i, "hogar", "Electrodomésticos"],
  [/lavadora|secadora|lavaplatos/i, "hogar", "Electrodomésticos"],
  [/aspiradora|limpiadora|robot/i, "hogar", "Electrodomésticos"],
  [/televisor|smart ?tv|monitor|proyector/i, "hogar", "Electrodomésticos"],
  [/bater[ií]a|inversor|panel solar|planta el[eé]ctrica|generador|solar|kwh|\bah\b|ups|regulador/i, "hogar", "Energía"],
  [/estufa|horno|hornilla|freidora|licuadora|batidora|cafetera|microondas|olla|fregadero/i, "hogar", "Cocina y comedor"],
  [/sill[oó]n|sof[aá]|colch[oó]n|cama|silla|mesa|comedor|mueble|pergol|estante|armario|zapatera/i, "hogar", "Sala y descanso"],
  [/bocina|equipo de m[uú]sica|soundbar|micr[oó]fono|audio|karaoke/i, "hogar", "Entretenimiento"],
  [/bicicleta|scooter|patinete/i, "vehiculos", "Otros vehículos"],
  [/triciclo/i, "vehiculos", "Triciclos"],
  [/moto\b|moto el[eé]ctrica/i, "vehiculos", "Motos"],
  [/carro|auto\b|veh[ií]culo|camioneta|neum[aá]tico/i, "vehiculos", "Carros"],
  [/piscina|columpio|pergola|terraza|jard[ií]n|bbq|asador/i, "hogar", "Exterior"],
  [/caja fuerte|cajafuerte/i, "hogar", "Caja Fuerte"],
  [/ni[ñn]o|ni[ñn]a|infantil|bebe|beb[eé]|trampol[ií]n/i, "hogar", "Artículos infantiles"],
  [/escritorio|impresora|papeler|l[aá]piz|oficina/i, "hogar", "Oficina"],
  [/herramienta|taladro|amoladora|destornillador|martillo|soldadora|sierra|funda|tornillo|clavo/i, "hogar", "Ferretería"],
  [/reloj|bol[ií]grafo|perfume|joya|cartera|bolso/i, "hogar", "Otros"],
];
export function adivinarCategoria(nombre, GRUPOS) {
  for (const [re, g, c] of CLAVES) {
    if (!re.test(nombre)) continue;
    let cat = c;
    if (g === "vehiculos" && !cat) {
      cat = /bicicleta|scooter|patinete/i.test(nombre) ? "Motos" : /triciclo/i.test(nombre) ? "Triciclos" : "Otros vehículos";
    }
    if (!GRUPOS[g] || !GRUPOS[g].subs.includes(cat)) {
      /* fallback: primera subcategoría del grupo */
      cat = GRUPOS[g] ? GRUPOS[g].subs[0] : null;
    }
    if (cat) return { g, c: cat };
  }
  return null;
}
