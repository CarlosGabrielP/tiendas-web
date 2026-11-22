// ---------- Completar la ficha técnica de una pala (PadelProShop + Gemini) ----------
// 1) Busca la pala en PadelProShop (tienda Shopify): su tabla «Detalles del producto» trae peso, forma, material de la cara, goma…
//    Esos datos se leen tal cual, sin IA.
// 2) Gemini (clave GEMINI_API_KEY, nivel gratuito) lee los textos (descripción de PadelProShop y de tu proveedor) y propone lo que falte
//    (balance, punto dulce, perfil, dureza, corazón…). Cada dato debe traer la frase exacta de donde salió; si esa frase no está en el
//    texto, se descarta. Nada se guarda sin tu aprobación en el panel.
const PPS = "https://padelproshop.com";
const FICHA_CAMPOS = ["Material cara", "Núcleo (goma)", "Peso", "Balance", "Punto dulce", "Perfil", "Forma", "Acabado", "Corazón", "Dureza", "Marco", "Nivel", "Tipo de juego"];
// Modelos de Gemini: los «flash» y «flash-lite» que tenga la cuenta, del más nuevo al más viejo (Google retira versiones viejas).
// Cada modelo tiene su propio límite gratuito: si uno se agota, se usa el siguiente. GEMINI_MODEL fija uno a mano.
let MODELOS_GEMINI = { lista: [], hasta: 0 };
const AGOTADOS_GEMINI = {};   // modelo → hasta cuándo no usarlo (límite por minuto o por día)
async function modelosGemini(env) {
  if (env.GEMINI_MODEL) return [String(env.GEMINI_MODEL).replace(/^models\//, "")];
  if (MODELOS_GEMINI.lista.length && Date.now() < MODELOS_GEMINI.hasta) return MODELOS_GEMINI.lista;
  let lista = [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_API_KEY }, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)-flash/) || [])[1]) || 0;
    lista = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""))
      .filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?(-latest)?$/.test(n))
      .sort((a, b) => ver(b) - ver(a) || (/-lite/.test(a) ? 1 : 0) - (/-lite/.test(b) ? 1 : 0));
  } catch {}
  if (!lista.length) lista = ["gemini-3.8-flash"];
  MODELOS_GEMINI = { lista: lista.slice(0, 6), hasta: Date.now() + 6 * 3600e3 };
  return MODELOS_GEMINI.lista;
}
async function modeloGemini(env) { const l = await modelosGemini(env); return l.find(m => !(AGOTADOS_GEMINI[m] > Date.now())) || l[0]; }
// El límite gratuito diario de Google se renueva a medianoche de California (1:00 a. m. en Guadalajara; 2:00 a. m. en su horario de verano)
function finDiaPacifico() {
  const ahora = new Date(), h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(ahora));
  const m = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", minute: "numeric" }).format(ahora));
  return Date.now() + ((24 - h) * 60 - m) * 60e3;
}
// Lee el 429 de Google: ¿límite por minuto o por día? ¿cuánto esperar?
function cuotaGemini(d) {
  const det = d?.error?.details || [], ids = det.flatMap(x => (x.violations || []).map(v => String(v.quotaId || v.quotaMetric || ""))).join(" ");
  const espera = parseFloat((det.find(x => x.retryDelay)?.retryDelay || "").replace("s", "")) || 0;
  const porDia = /PerDay|per_day|daily/i.test(ids) || (!/PerMinute|per_minute/i.test(ids) && /day|diario/i.test(String(d?.error?.message || "")));
  return { porDia, espera };
}
// Llama a Gemini con el primer modelo que tenga cuota. Un reintento si la conexión se corta o Google está saturado (500/503).
async function llamarGemini(env, cuerpo, ms) {
  const lista = await modelosGemini(env), usados = [];
  let ultimo = null;
  for (const modelo of lista) {
    if (AGOTADOS_GEMINI[modelo] > Date.now() && modelo !== lista[lista.length - 1]) continue;
    usados.push(modelo);
    let r;
    for (let intento = 1; ; intento++) {
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
          method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(ms) });
        if ((r.status === 500 || r.status === 503) && intento === 1) { await new Promise(x => setTimeout(x, 1500)); continue; }
        break;
      } catch (e) {
        if (e.name === "TimeoutError" || intento > 1) { const x = new Error(e.name === "TimeoutError" ? `tardó más de ${Math.round(ms / 1000)} s (modelo ${modelo})` : `error de conexión con Google (${String(e.message || e).slice(0, 100)}; modelo ${modelo})`); x.causa = e; throw x; }
        await new Promise(x => setTimeout(x, 1500));
      }
    }
    if (r.status === 404) { MODELOS_GEMINI.hasta = 0; ultimo = { r, modelo }; continue; }   // el modelo ya no existe: se prueba el siguiente
    if (r.status === 429) {   // sin cuota en este modelo: se aparta y se prueba el siguiente
      const d = await r.clone().json().catch(() => ({})), q = cuotaGemini(d);
      AGOTADOS_GEMINI[modelo] = q.porDia ? finDiaPacifico() : Date.now() + Math.max(q.espera, 20) * 1000;
      ultimo = { r, modelo, cuota: q, usados: [...usados] };
      continue;
    }
    return { r, modelo };
  }
  return ultimo || { r: new Response("{}", { status: 503 }), modelo: lista[0] };
}
// Mensaje claro cuando se acabó la cuota gratuita
function mensajeCuota(res) {
  const q = res.cuota || {}, mods = (res.usados || [res.modelo]).join(", ");
  return q.porDia
    ? `Se acabó el límite gratuito de hoy de Gemini (probé: ${mods}). Se renueva a la 1:00 a. m. de Guadalajara. Mientras, los datos de PadelProShop sí se muestran.`
    : `Gemini pide esperar${q.espera ? ` unos ${Math.ceil(q.espera)} s` : " un minuto"} (límite por minuto del plan gratuito; probé: ${mods}). Vuelve a intentarlo en un momento.`;
}
const normFicha = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.+]+/g, " ").trim();
const textoPlanoHtml = h => String(h || "").replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
async function traer(url, tipo = "text") {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; {{tienda.clave}}-fichas/1.0; +{{tienda.sitio}})", accept: tipo === "json" ? "application/json" : "text/html" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} respondió ${r.status}`);
  return tipo === "json" ? r.json() : r.text();
}
// Abreviaturas que usan las marcas y las tiendas (CMF = Comfort, CTRL = Control…)
const SINONIMOS = { cmf: "comfort", comf: "comfort", ctrl: "control", ctl: "control", pwr: "power", hyb: "hybrid", hybr: "hybrid", ltd: "limited", edt: "edition",
  jr: "junior", w: "woman", wmn: "woman", women: "woman", mujer: "woman", attk: "attack", att: "attack", lite: "light", lt: "light" };
const palabrasFicha = t => normFicha(t).replace(/\b(pala|padel|by|de|la|el|edition)\b/g, " ").split(" ").filter(Boolean).map(w => SINONIMOS[w] || w);
const expandirAbrev = t => String(t).split(/\s+/).map(w => SINONIMOS[normFicha(w)] ? SINONIMOS[normFicha(w)] : w).join(" ");
// Qué tan parecido es el nombre de la tienda con el nuestro: todas nuestras palabras deben estar; los números (año, versión) cuentan doble
function parecido(nuestro, suyo) {
  const a = palabrasFicha(nuestro), b = new Set(palabrasFicha(suyo));
  if (!a.length) return 0;
  const peso = w => /\d/.test(w) ? 2 : 1, total = a.reduce((s, w) => s + peso(w), 0), ok = a.reduce((s, w) => s + (b.has(w) ? peso(w) : 0), 0);
  const extrasNum = [...b].filter(w => /^\d+(\.\d+)?k?$/.test(w) && !a.includes(w)).length;   // «Elite 6» cuando buscamos «Elite»
  const extrasModelo = [...b].filter(w => ["comfort", "control", "power", "hybrid", "light", "attack", "junior", "woman", "limited", "pro", "team", "carbon"].includes(w) && !a.includes(w)).length;   // otra versión del mismo modelo
  return Math.max(0, ok / total - extrasNum * .15 - extrasModelo * .1);
}
async function buscarEnPPS(nombre) {
  const base = nombre.replace(/^pala\s+/i, "").slice(0, 80), consultas = [...new Set([base, expandirAbrev(base)])], vistos = new Map();
  for (const q of consultas) {
    const d = await traer(`${PPS}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=8`, "json").catch(() => null);
    for (const p of d?.resources?.results?.products || []) if ((/pala/i.test(p.title) || /pala/i.test(p.product_type || "")) && !vistos.has(p.handle)) vistos.set(p.handle, p);
  }
  return [...vistos.values()].map(p => ({ titulo: p.title, handle: p.handle, url: `${PPS}/products/${p.handle}`, imagen: p.image || p.featured_image?.url || "", parecido: Math.round(parecido(nombre, p.title) * 100) / 100 }))
    .sort((x, y) => y.parecido - x.parecido);
}
const ETIQUETAS_PPS = { "peso": "Peso", "nivel de juego": "Nivel", "forma": "Forma", "marco": "Marco", "material cara": "Material cara", "material de la cara": "Material cara", "material caras": "Material cara",
  "goma": "Núcleo (goma)", "nucleo": "Núcleo (goma)", "superficie": "Acabado", "balance": "Balance", "dureza": "Dureza", "perfil": "Perfil", "grosor": "Perfil", "punto dulce": "Punto dulce", "tipo de juego": "Tipo de juego" };
async function fichaPPS(handle) {
  const url = `${PPS}/products/${encodeURIComponent(handle)}`;
  const [html, js] = await Promise.all([traer(url), traer(url + ".js", "json").catch(() => null)]);
  const filas = [...html.matchAll(/product-details-table__label">([\s\S]*?)<\/td>\s*<td class="product-details-table__value">([\s\S]*?)<\/td>/g)]
    .map(m => [textoPlanoHtml(m[1]), textoPlanoHtml(m[2])]).filter(([k, v]) => k && v);
  const campos = {};
  for (const [k, v] of filas) {
    const c = ETIQUETAS_PPS[normFicha(k)];
    if (c && !campos[c]) campos[c] = { valor: v, fuente: "PadelProShop · tabla de detalles", url, evidencia: `${k}: ${v}` };
  }
  return { url, titulo: js?.title || handle, campos, descripcion: textoPlanoHtml(js?.description || "").slice(0, 6000) };
}
// Gemini: extrae solo datos que estén escritos en los textos, cada uno con su cita
async function fichaGemini(env, nombre, textos, faltan) {
  if (!env.GEMINI_API_KEY) return { estado: "sin clave" };
  const prompt = `Eres un asistente que extrae la ficha técnica de una pala de pádel llamada «${nombre}».
Usa EXCLUSIVAMENTE los textos de abajo. No uses conocimiento propio ni supongas nada.
Para cada dato encontrado devuelve "valor" (corto, en español de México) y "cita": la frase EXACTA copiada del texto (máximo 160 caracteres) donde aparece ese dato.
Si un dato no aparece explícitamente, no lo incluyas.
Datos que buscamos: ${faltan.join(", ")}.
Guía: "Material cara" = material de las caras (p. ej. carbono 3K, 12K, 18K, Fibrix, fibra de vidrio). "Núcleo (goma)" = goma/núcleo (EVA, Multieva, foam…). "Balance" = alto/medio/bajo o en mm/cm. "Punto dulce" = tamaño o ubicación del punto dulce. "Perfil" = grosor en mm. "Corazón" = tecnología o tipo de puente/corazón. "Dureza" = dura/media/blanda.
Responde solo JSON con la forma {"campos":[{"dato":"...","valor":"...","cita":"...","texto":1}]} donde "texto" es el número del texto de donde salió.

${textos.map((t, i) => `TEXTO ${i + 1} (${t.fuente}):\n${t.texto}`).join("\n\n")}`;
  let r;
  let llamada;
  try { llamada = await llamarGemini(env, { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }, 50000); ({ r } = llamada); }
  catch (e) { return { estado: "error", error: `Gemini no respondió: ${e.message}. Intenta de nuevo en un momento.` }; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { estado: "error", error: r.status === 429 || d?.error?.status === "RESOURCE_EXHAUSTED" ? mensajeCuota(llamada) : `Gemini respondió ${r.status} (modelo ${llamada.modelo}): ${String(d?.error?.message || "").slice(0, 160)}` };
  let res; try { res = JSON.parse(d?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}"); } catch { return { estado: "error", error: "Gemini devolvió un formato inesperado." }; }
  const campos = {}, descartados = [];
  for (const c of Array.isArray(res.campos) ? res.campos : []) {
    const dato = FICHA_CAMPOS.find(f => normFicha(f) === normFicha(c.dato)), t = textos[(Number(c.texto) || 0) - 1];
    if (!dato || !c.valor || !c.cita) continue;
    // Comprobación anti-invención: la cita tiene que estar, palabra por palabra, en el texto de origen
    const fuenteOk = t && normFicha(t.texto).includes(normFicha(c.cita)) ? t : textos.find(x => normFicha(x.texto).includes(normFicha(c.cita)));
    if (!fuenteOk || normFicha(c.cita).length < 4) { descartados.push(`${dato}: «${String(c.valor).slice(0, 40)}» (la cita no aparece en la fuente)`); continue; }
    if (!campos[dato]) campos[dato] = { valor: String(c.valor).slice(0, 80), fuente: `${fuenteOk.fuente} · leído por Gemini`, url: fuenteOk.url || "", evidencia: String(c.cita).slice(0, 200), ia: true };
  }
  return { estado: "ok", campos, descartados };
}
async function completarFicha(env, id, handle) {
  const cat = await leerCatalogo(env), p = cat.productos.find(x => x.id === id);
  if (!p) throw new Error("Producto no encontrado.");
  const candidatos = await buscarEnPPS(p.nombre).catch(e => { throw new Error("No se pudo buscar en PadelProShop: " + e.message); });
  const elegido = handle ? (candidatos.find(c => c.handle === handle) || { handle, titulo: handle, url: `${PPS}/products/${handle}`, parecido: null }) : candidatos[0];
  let pps = null;
  if (elegido) pps = await fichaPPS(elegido.handle).catch(() => null);
  const propia = ((await leerDoc(env, "descripciones"))?.valor || {})[id] || "";
  const textos = [pps?.descripcion && { fuente: "PadelProShop · descripción", url: pps.url, texto: pps.descripcion }, propia && { fuente: "Tu descripción (proveedor)", url: p.urlProveedor || "", texto: propia.slice(0, 6000) }].filter(Boolean);
  const yaTiene = { ...(pps?.campos || {}) };
  const faltan = FICHA_CAMPOS.filter(f => !yaTiene[f]);
  const ia = textos.length && faltan.length ? await fichaGemini(env, p.nombre, textos, faltan) : { estado: env.GEMINI_API_KEY ? "nada que buscar" : "sin clave" };
  const campos = FICHA_CAMPOS.map(clave => { const x = yaTiene[clave] || ia.campos?.[clave]; return x ? { clave, ...x, actual: p.specs?.[clave] || "" } : null; }).filter(Boolean);
  return { producto: { id: p.id, nombre: p.nombre, specs: p.specs || {} }, elegido: elegido ? { ...elegido, encontrada: !!pps } : null, candidatos: candidatos.slice(0, 6), campos, ia: { estado: ia.estado, error: ia.error, descartados: ia.descartados || [] } };
}
// Prueba de conexión SIN gastar cuota: solo consulta la lista de modelos (no genera texto)
async function probarGemini(env) {
  if (!env.GEMINI_API_KEY) return { ok: false, mensaje: "Falta guardar GEMINI_API_KEY en Cloudflare (Variables and Secrets)." };
  let r;
  try { r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": env.GEMINI_API_KEY }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { return { ok: false, mensaje: `No se pudo conectar con Google: ${e.name === "TimeoutError" ? "tardó demasiado" : String(e.message || e).slice(0, 100)}. Intenta de nuevo.` }; }
  if (!r.ok) { const d = await r.json().catch(() => ({})); return { ok: false, mensaje: `Google rechazó la clave de Gemini (${r.status}): ${String(d?.error?.message || "").slice(0, 140)}` }; }
  const lista = await modelosGemini(env), libre = lista.find(m => !(AGOTADOS_GEMINI[m] > Date.now()));
  return libre ? { ok: true, mensaje: `Gemini listo (${libre}${lista.length > 1 ? `; si se agota, usa ${lista.filter(m => m !== libre).slice(0, 2).join(", ")}` : ""})` }
    : { ok: false, mensaje: "Gemini: se acabó el límite gratuito de hoy en todos los modelos. Se renueva a la 1:00 a. m. de Guadalajara." };
}
async function apiFicha(request, env, ruta, url) {
  try {
    // Ajustes del Reel por pala (puntos en la foto y textos), compartidos entre tus dispositivos
    if (ruta === "/ficha/reel" && request.method === "GET") return json({ reel: ((await leerDoc(env, "reels"))?.valor || {})[String(url.searchParams.get("id") || "")] || null });
    if (ruta === "/ficha/reel" && request.method === "PUT") {
      let b = {}; try { b = await request.json(); } catch {}
      const id = String(b.id || "").slice(0, 80), punto = q => ({ x: Math.min(1, Math.max(0, Number(q?.x) || 0)), y: Math.min(1, Math.max(0, Number(q?.y) || 0)) });
      if (!/^[a-z0-9-]+$/.test(id)) return json({ error: "Producto inválido." }, 400);
      const limpio = o => Object.fromEntries(Object.entries(o || {}).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), String(v ?? "").slice(0, 90)]));
      const reel = { puntos: Object.fromEntries(Object.entries(b.puntos || {}).slice(0, 8).map(([k, v]) => [String(k).slice(0, 20), punto(v)])), textos: limpio(b.textos), auto: limpio(b.auto), fecha: new Date().toISOString() };
      await modificarDoc(env, "reels", () => ({}), d => ({ ...d, [id]: reel }));
      return json({ ok: true });
    }
    if (ruta === "/ficha/ia" && request.method === "GET") return json(await probarGemini(env));
    if (ruta === "/ficha/buscar" && request.method === "POST") {
      let b = {}; try { b = await request.json(); } catch {}
      return json(await completarFicha(env, String(b.id || ""), b.handle ? String(b.handle).replace(/[^a-z0-9-]/gi, "").slice(0, 120) : ""));
    }
    return json({ error: "No encontrado." }, 404);
  } catch (e) { return json({ error: String(e.message || e).slice(0, 200) }, 502); }
}
