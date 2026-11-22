// ---------- Sincronización diaria con el proveedor (dev.tiendapadel5.com, WooCommerce) ----------
// Lee la API pública de la tienda del proveedor (Store API, solo lectura, sin usuario) y actualiza en tu catálogo:
//   · costo en € y disponibilidad en el proveedor de las palas que ya tienes
//   · palas nuevas: se publican solas (con foto, ficha y descripción del proveedor) y aparecen en «Novedades»
// No toca: tu almacén (existencias y costo real), descuentos, nombres que cambiaste, fotos propias ni fichas que completaste.
// Protecciones: si el proveedor no responde o trae muchas menos palas de lo normal no se cambia nada; si el costo
// de una pala cambia más de 30 % no se aplica solo (queda en el panel para que lo confirmes); antes de cambiar se
// guarda la versión anterior del catálogo («Deshacer último cambio»).
// Corre a la 1:00 p. m. de Guadalajara = 8:00 p. m. en Madrid (9:00 p. m. en su horario de verano): ya terminó el día del
// proveedor y quedan 8 horas antes de tu corte de las 9:00 p. m.
const PROVEEDOR = {
  base: "https://dev.tiendapadel5.com",
  categoriaPalas: 164,            // «Palas de pádel» en su tienda
  horas: [13],                    // hora de México
  maxCambioPct: 30,
  minProporcion: 0.7,             // si trae menos del 70 % de las palas que tienes del proveedor, algo anda mal
  maxNuevasPorVez: 12,            // ficha completa (descripción) de las nuevas; las demás entran en la siguiente vuelta
  agente: "{{tienda.clave}}-inventario/1.0 (+{{tienda.sitio}})",
};
const MARCAS_PROV = ["Black Crown","Drop Shot","Royal Padel","Vibor-A","Bullpadel","Starvie","Varlion","Babolat","Adidas","Wilson","Dunlop","Kelme","Vairo","Siux","Head","Nox","Aca","Lok","Joma","Puma","Oxdog","Enebe","Softee","Akkeron","Kombat","Tecnifibre","Endless","Ringo","Mystica","Slazenger"];
const MAPA_DESC_PROV = { peso: "Peso", balance: "Balance", nucleo: "Núcleo", "material de las caras": "Cara", caras: "Cara", "material caras": "Cara", cara: "Cara", forma: "Forma", acabado: "Acabado", grosor: "Grosor", marco: "Marco" };
const FORMAS_PROV = { hibrida: "Híbrida", redonda: "Redonda", diamante: "Diamante", lagrima: "Lágrima", geometrica: "Geométrica" };
const PALETA_PROV = ["#1c55ff", "#a8ff00", "#ffffff", "#00c2ff", "#7a5cff", "#ff3b5c", "#2a2f3a"];
const normProv = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const slugProv = t => normProv(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const claveNombreProv = n => normProv(n).replace(/^(pala de padel |pala )/, "").replace(/[^a-z0-9]/g, "");
const tituloProv = t => { const x = String(t).trim().toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1); };
const valorProv = t => tituloProv(t).replace(/(\d+)\s*k\b/gi, "$1K").replace(/\beva\b/gi, "EVA").replace(/\s+/g, " ").slice(0, 60);
const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", ordm: "º", ordf: "ª", deg: "°" };
const textoDeHtml = h => String(h || "")
  .replace(/<\s*(br|\/p|\/li|\/h\d|\/div|\/tr)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function marcaDeProv(nombre, cats) {
  const n = " " + normProv(nombre).replace(/[^a-z0-9]+/g, " ") + " ";
  for (const m of MARCAS_PROV) if (n.includes(" " + normProv(m).replace(/[^a-z0-9]+/g, " ") + " ")) return m;
  for (const c of cats) { const x = c.match(/^palas de p[aá]del (?:de )?(.+)$/i); if (x && !/\d/.test(x[1]) && !/^(set|pickleball)/i.test(x[1])) return x[1].replace(/\b\w/g, l => l.toUpperCase()); }
  return "";
}
// Producto de la Store API → pala con el mismo formato que el import por CSV
function palaDeApi(a) {
  const cats = (a.categories || []).map(c => textoDeHtml(c.name));
  const nombre = textoDeHtml(a.name).slice(0, 120);
  if (!nombre || !cats.some(c => /^palas de p[aá]del/i.test(c)) || /pickleball/i.test(nombre + " " + cats.join(" "))) return null;
  const minor = Number(a.prices?.currency_minor_unit ?? 2), costo = Math.round(Number(a.prices?.price) / 10 ** minor * 100) / 100;
  if (!(costo > 0) || (a.prices?.currency_code && a.prices.currency_code !== "EUR")) return null;
  const specs = {}, marca = marcaDeProv(nombre, cats); if (marca) specs.Marca = marca;
  const temp = cats.map(c => (c.match(/(20\d\d)\s*$/) || [])[1]).find(Boolean); if (temp) specs.Temporada = temp;
  const url = /^https:\/\//i.test(a.permalink || "") ? a.permalink : undefined, img = (a.images || []).map(i => i.src).find(s => /^https:\/\//i.test(s || ""));
  return { nombre, costoEur: costo, specs, temp, urlProveedor: url, imagenOrigen: img, agotado: a.is_in_stock === false, idProv: a.id };
}
// Ficha y descripción de una pala nueva (una consulta por pala)
async function detallePala(idProv) {
  const r = await fetch(`${PROVEEDOR.base}/wp-json/wc/store/v1/products/${idProv}?_fields=description,short_description,images`, { headers: { "user-agent": PROVEEDOR.agente, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return {};
  const d = await r.json(), descripcion = textoDeHtml(d.description).slice(0, 6000), specs = {};
  for (const linea of descripcion.split("\n")) {
    const m = linea.replace(/^•\s*/, "").match(/^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30}?)\s*:\s*(.{1,60})$/); if (!m) continue;
    const k = MAPA_DESC_PROV[normProv(m[1])]; if (!k || specs[k]) continue;
    specs[k] = k === "Forma" ? (FORMAS_PROV[normProv(m[2])] || valorProv(m[2])) : valorProv(m[2]);
  }
  const imagen = (d.images || []).map(i => i.src).find(s => /^https:\/\//i.test(s || ""));
  return { descripcion, specs, resumen: textoDeHtml(d.short_description).slice(0, 400), imagen };
}
async function leerPalasProveedor() {
  // Ojo: la API devuelve vacíos los campos anidados de listas (p. ej. «categories.name»): se piden completos.
  // Sin fotos (pesan ~1 MB por página): la foto de las palas nuevas se toma de su ficha.
  const campos = "id,name,permalink,prices,is_in_stock,categories";
  const palas = [];
  let paginas = 1;
  for (let pg = 1; pg <= Math.min(paginas, 10); pg++) {
    const r = await fetch(`${PROVEEDOR.base}/wp-json/wc/store/v1/products?category=${PROVEEDOR.categoriaPalas}&per_page=100&page=${pg}&_fields=${campos}`,
      { headers: { "user-agent": PROVEEDOR.agente, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`el proveedor respondió ${r.status} (página ${pg})`);
    paginas = Number(r.headers.get("x-wp-totalpages")) || 1;
    const lista = await r.json();
    if (!Array.isArray(lista)) throw new Error("respuesta inesperada del proveedor");
    for (const a of lista) { const p = palaDeApi(a); if (p) palas.push(p); }
    if (lista.length && !palas.length && pg === 1) throw new Error(`el proveedor respondió ${lista.length} productos, pero ninguno se reconoció como pala (¿cambió el formato de su tienda?)`);
  }
  return palas;
}

async function sincronizarProveedor(env, { motivo = "automática" } = {}) {
  const inicio = new Date().toISOString(), hoy = hoyMX();
  const estadoPrevio = (await leerDoc(env, "proveedor-estado"))?.valor || {};
  const guardarEstado = e => escribirDoc(env, "proveedor-estado", { ...estadoPrevio, ...e, ultima: inicio, motivo });
  let palas;
  try { palas = await leerPalasProveedor(); }
  catch (e) { const error = e.name === "TimeoutError" ? "el proveedor tardó demasiado en responder" : String(e.message || e).slice(0, 200); await guardarEstado({ ok: false, error }); return { ok: false, error }; }

  const base = await leerCatalogoBase(env);
  const delProveedor = base.productos.filter(p => p.urlProveedor && p.categoria === "palas");
  if (palas.length < Math.max(20, delProveedor.length * PROVEEDOR.minProporcion)) {
    const error = `el proveedor trajo solo ${palas.length} palas (tienes ${delProveedor.length}); no se cambió nada por seguridad`;
    await guardarEstado({ ok: false, error }); return { ok: false, error };
  }
  // Empate: por URL del proveedor y, si no, por nombre
  const porUrl = new Map(base.productos.filter(p => p.urlProveedor).map(p => [p.urlProveedor, p]));
  const porNombre = new Map(base.productos.map(p => [claveNombreProv(p.nombre), p]));
  const usados = new Set(), nuevas = [];
  for (const n of palas) {
    const e = (n.urlProveedor && porUrl.get(n.urlProveedor)) || porNombre.get(claveNombreProv(n.nombre));
    if (e && !usados.has(e.id)) { n.id = e.id; usados.add(e.id); }
    else if (!e && !n.agotado) nuevas.push(n);   // las agotadas se agregan cuando vuelvan a tener
  }
  // Ficha y descripción de las nuevas (con límite por vuelta)
  const ids = new Set(base.productos.map(p => p.id)), aAgregar = nuevas.slice(0, PROVEEDOR.maxNuevasPorVez);
  for (const n of aAgregar) {
    let id = slugProv(n.nombre) || "pala-" + n.idProv; while (ids.has(id)) id = (id + "-2").slice(0, 80);
    ids.add(id); n.id = id;
    try { n.detalle = await detallePala(n.idProv); } catch { n.detalle = {}; }
    if (!n.imagenOrigen && n.detalle.imagen) n.imagenOrigen = n.detalle.imagen;
  }
  const enProveedor = new Map(palas.filter(n => n.id).map(n => [n.id, n]));
  const cambios = [], revisar = { ...(estadoPrevio.revisar || {}) }, ignorados = estadoPrevio.ignorados || {};
  const anio = Number(hoy.slice(0, 4));

  const transformar = c => {
    cambios.length = 0;
    const productos = c.productos.map(e => {
      const n = enProveedor.get(e.id);
      if (!n) {   // ya no está en el proveedor
        if (e.urlProveedor && e.categoria === "palas" && !e.agotadoProveedor && usados.size) { cambios.push({ tipo: "ya no está", nombre: e.nombre }); return { ...e, agotadoProveedor: true }; }
        return e;
      }
      const m = { ...e };
      if (n.costoEur !== e.costoEur) {
        const pct = e.costoEur ? Math.abs(n.costoEur - e.costoEur) / e.costoEur * 100 : 0;
        if (e.costoEur && pct > PROVEEDOR.maxCambioPct) { if (ignorados[e.id] !== n.costoEur) revisar[e.id] = { nombre: e.nombre, de: e.costoEur, a: n.costoEur, desde: hoy }; }
        else { m.costoEur = n.costoEur; if (e.costoEur) m.cambioCosto = { de: e.costoEur, a: n.costoEur, fecha: hoy }; delete revisar[e.id]; cambios.push({ tipo: n.costoEur < e.costoEur ? "bajó" : "subió", id: e.id, nombre: e.nombre, de: e.costoEur, a: n.costoEur }); }
      } else delete revisar[e.id];
      if (!!e.agotadoProveedor !== n.agotado) { if (n.agotado) m.agotadoProveedor = true; else delete m.agotadoProveedor; cambios.push({ tipo: n.agotado ? "agotada" : "otra vez disponible", nombre: e.nombre }); }
      if (n.urlProveedor && !e.urlProveedor) m.urlProveedor = n.urlProveedor;
      // Foto del proveedor solo si la pala no tiene una foto tuya
      if (n.imagenOrigen && n.imagenOrigen !== e.imagenOrigen && (!e.imagen || e.fotoDe)) m.imagenOrigen = n.imagenOrigen;
      // Ficha: solo los datos que falten (no se pisan los que completaste)
      for (const [k, v] of Object.entries(n.specs)) if (!m.specs?.[k]) m.specs = { ...(m.specs || {}), [k]: v };
      if (n.temp && +n.temp >= anio && !(e.etiquetas || []).includes("nuevo")) m.etiquetas = [...(e.etiquetas || []), "nuevo"];
      return m;
    });
    for (const n of aAgregar) {
      if (productos.some(p => p.id === n.id)) continue;
      const d = n.detalle || {};
      productos.push({ id: n.id, nombre: n.nombre, categoria: "palas", costoEur: n.costoEur, specs: { ...d.specs, ...n.specs }, stock: 0, entrega: "inmediata",
        etiquetas: n.temp && +n.temp >= anio ? ["nuevo"] : [], color: PALETA_PROV[productos.length % PALETA_PROV.length],
        urlProveedor: n.urlProveedor, imagenOrigen: n.imagenOrigen, ...(d.resumen ? { resumen: d.resumen } : {}), nuevoDesde: hoy });
      cambios.push({ tipo: "nueva", nombre: n.nombre, a: n.costoEur });
    }
    return { ...c, productos: validarProductos(productos), actualizado: new Date().toISOString() };
  };
  // Se calcula primero sin guardar: si no hay cambios, no se toca el catálogo
  transformar({ productos: base.productos });
  if (cambios.length) {
    await escribirDoc(env, "catalogo:anterior", { productos: base.productos, actualizado: base.actualizado });
    await modificarDoc(env, "catalogo", () => ({ productos: CATALOGO_INICIAL }), transformar);
    const desc = Object.fromEntries(aAgregar.filter(n => n.detalle?.descripcion).map(n => [n.id, n.detalle.descripcion]));
    if (Object.keys(desc).length) await modificarDoc(env, "descripciones", () => ({}), d => ({ ...d, ...desc }));
  }
  // Fotos de las nuevas (las demás se descargan en las revisiones de cada hora)
  let fotos = [];
  const conFoto = aAgregar.filter(n => n.imagenOrigen).map(n => n.id).slice(0, 6);
  if (conFoto.length) { try { fotos = await descargarFotos(env, conFoto); } catch {} }
  const resumen = { nuevas: cambios.filter(c => c.tipo === "nueva").length, precios: cambios.filter(c => c.tipo === "bajó" || c.tipo === "subió").length,
    agotadas: cambios.filter(c => c.tipo === "agotada" || c.tipo === "ya no está").length, disponibles: cambios.filter(c => c.tipo === "otra vez disponible").length };
  const historial = [{ fecha: inicio, ...resumen }, ...(estadoPrevio.historial || [])].slice(0, 30);
  await guardarEstado({ ok: true, error: null, palas: palas.length, cambios: cambios.slice(0, 200), resumen, revisar, historial,
    pendientes: Math.max(0, nuevas.length - aAgregar.length), fotos: fotos.filter(f => f.ok).length });
  return { ok: true, palas: palas.length, ...resumen, revisar: Object.keys(revisar).length, cambios };
}
// Aplica (o descarta) un cambio de costo que se detuvo por ser mayor al 30 %
async function aplicarRevisionProveedor(env, ids, aplicar) {
  const est = (await leerDoc(env, "proveedor-estado"))?.valor || {}, revisar = { ...(est.revisar || {}) };
  const elegidos = ids.filter(id => revisar[id]);
  if (aplicar && elegidos.length) await modificarDoc(env, "catalogo", () => ({ productos: CATALOGO_INICIAL }), c => ({ ...c, productos: c.productos.map(p => revisar[p.id] && elegidos.includes(p.id) ? { ...p, costoEur: revisar[p.id].a, cambioCosto: { de: p.costoEur, a: revisar[p.id].a, fecha: hoyMX() } } : p), actualizado: new Date().toISOString() }));
  const ignorados = { ...(est.ignorados || {}) };
  for (const id of elegidos) { if (!aplicar) ignorados[id] = revisar[id].a; delete revisar[id]; }   // ignorado: no se vuelve a preguntar por ese mismo precio
  await escribirDoc(env, "proveedor-estado", { ...est, revisar, ignorados });
  return elegidos.length;
}
// Fotos que siguen pendientes (palas nuevas o con foto nueva del proveedor): unas cuantas por revisión
async function fotosPendientesProveedor(env, max = 3) {
  const cat = await leerCatalogoBase(env);
  const ids = cat.productos.filter(p => p.imagenOrigen && p.fotoDe !== p.imagenOrigen && (!p.imagen || p.fotoDe) && !p.agotadoProveedor).map(p => p.id).slice(0, max);
  return ids.length ? (await descargarFotos(env, ids)).filter(f => f.ok).length : 0;
}
