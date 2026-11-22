// {{tienda.nombre}} — servidor de la tienda (Cloudflare Pages, modo _worker.js)
// build.py reemplaza los marcadores __...__ por el HTML, las imágenes y el catálogo inicial.
//
// Requiere en el proyecto de Pages:
//   - D1 vinculado como DB (datos: catálogo, pedidos, cupones, configuración; consistente)
//   - KV vinculado como CATALOGO (solo fotos; y lectura única para migrar datos antiguos a D1)
//   - Secreto ADMIN_PASSWORD (Settings → Variables and Secrets)
//   - Secreto BANXICO_TOKEN (token del SIE de Banxico, para el tipo de cambio EUR→MXN)
//   - Secreto MP_ACCESS_TOKEN (Mercado Pago; credenciales de PRUEBA en Preview, de producción en Production)
//   - Secreto MP_WEBHOOK_SECRET (opcional, valida la firma de las notificaciones de Mercado Pago)

const HTML_PUBLICO = __HTML_PUBLICO__;
const HTML_ADMIN = __HTML_ADMIN__;
const HTML_LEGALES = __HTML_LEGALES__;
// Motor del minijuego (el mismo código que corre en el navegador; build.py lo inserta aquí)
__MOTOR_JUEGO__     // privacidad, terminos, devoluciones, facturacion
const ESTATICOS = __ESTATICOS__;            // { "/img/...": [tipo, base64] }
const CATALOGO_INICIAL = __CATALOGO_INICIAL__;

const INICIO = "/*CATALOGO_INICIO*/", FIN = "/*CATALOGO_FIN*/";
const CATS = {{json:tienda.categorias}};   // categorías (tienda.json de la tienda)
const CATEGORIAS = Object.keys(CATS), CATEGORIA_PRINCIPAL = "{{tienda.categoriaPrincipal}}";
const MODULOS = {{json:tienda.modulos}};   // módulos encendidos (tienda.json → modulos)
const NIVELES = ["iniciacion", "intermedio", "avanzado"];
const JUEGOS = ["control", "polivalente", "ataque"];
const ETIQUETAS = ["nuevo", "oferta", "top"];
const SESION_HORAS = 8;
const MAX_IMAGEN = 2 * 1024 * 1024;
const TIPOS_IMAGEN = ["image/webp", "image/jpeg", "image/png"];
const TIPOS_IMAGEN_PROVEEDOR = /^image\/(webp|jpeg|png|avif|gif)$/;
const MAX_IMAGEN_PROVEEDOR = 4 * 1024 * 1024;
const PRIVADOS = ["costoEur", "descuento", "urlProveedor", "imagenOrigen", "fotoDe", "agotadoProveedor", "costoReal", "cambioCosto"];   // nunca llegan a la tienda
const SEGURIDAD = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// Política de contenido: solo se ejecutan los scripts propios de cada página (por su hash). Si alguien lograra
// inyectar HTML, su código no correría ni podría mandar datos a otro sitio. Excepción: las estadísticas de
// visitas de Cloudflare (Web Analytics), que Cloudflare agrega solo en el dominio propio.
const CSP_CACHE = new Map();
async function cspDe(pagina) {
  if (CSP_CACHE.has(pagina)) return CSP_CACHE.get(pagina);
  const hashes = [];
  for (const m of pagina.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1]));
    hashes.push(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(h)))}'`);
  }
  const csp = ["default-src 'self'", `script-src 'self' https://static.cloudflareinsights.com ${hashes.join(" ")}`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self' https://cloudflareinsights.com", "frame-ancestors 'none'", "base-uri 'self'",
    "form-action 'self'", "object-src 'none'"].join("; ");
  if (CSP_CACHE.size > 20) CSP_CACHE.clear();
  CSP_CACHE.set(pagina, csp);
  return csp;
}

const bin = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...SEGURIDAD, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
// cspBase: página de la que salen los scripts (las páginas SEO comparten los mismos scripts que la base)
const html = async (body, extra = {}, cspBase = body, status = 200) =>
  new Response(body, { status, headers: { ...SEGURIDAD, "content-security-policy": await cspDe(cspBase), "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...extra } });

// ---------- Almacenamiento (D1): documentos con versión y escritura condicionada ----------
// Cada documento (catálogo, cupones, configuración…) lleva un número de versión. Las escrituras
// "condicionadas" solo se aplican si nadie lo cambió desde que se leyó; así una venta nunca se pierde
// porque el panel guarde una copia vieja (y viceversa).
async function leerDoc(env, clave) {
  const r = await env.DB.prepare("SELECT valor, version, actualizado FROM datos WHERE clave = ?").bind(clave).first();
  if (r) return { valor: JSON.parse(r.valor), version: r.version, actualizado: r.actualizado };
  // Migración automática de los datos que estaban en KV
  const viejo = env.CATALOGO ? await env.CATALOGO.get(clave, "json") : null;
  if (viejo == null) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO datos (clave, valor, version, actualizado) VALUES (?, ?, 1, ?)").bind(clave, JSON.stringify(viejo), new Date().toISOString()).run();
  return leerDoc(env, clave);
}
// versionEsperada: undefined = escribir siempre; 0 = solo si no existe; n = solo si sigue en la versión n. Devuelve la nueva versión o null si hubo conflicto.
async function escribirDoc(env, clave, valor, versionEsperada) {
  const v = JSON.stringify(valor), ahora = new Date().toISOString();
  if (versionEsperada === undefined)
    return (await env.DB.prepare("INSERT INTO datos (clave, valor, version, actualizado) VALUES (?, ?, 1, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, version = datos.version + 1, actualizado = excluded.actualizado RETURNING version").bind(clave, v, ahora).first()).version;
  if (versionEsperada === 0)
    return (await env.DB.prepare("INSERT INTO datos (clave, valor, version, actualizado) VALUES (?, ?, 1, ?) ON CONFLICT(clave) DO NOTHING RETURNING version").bind(clave, v, ahora).first())?.version ?? null;
  return (await env.DB.prepare("UPDATE datos SET valor = ?, version = version + 1, actualizado = ? WHERE clave = ? AND version = ? RETURNING version").bind(v, ahora, clave, versionEsperada).first())?.version ?? null;
}
// Lee → modifica → escribe condicionado, reintentando si otro proceso escribió en medio
async function modificarDoc(env, clave, inicial, fn) {
  for (let i = 0; i < 8; i++) {
    const d = await leerDoc(env, clave);
    const actual = d ? d.valor : inicial();
    const nuevo = await fn(actual);
    if (nuevo === undefined) return actual;
    if ((await escribirDoc(env, clave, nuevo, d ? d.version : 0)) != null) return nuevo;
  }
  throw new Error("Hubo demasiados cambios simultáneos; intenta de nuevo.");
}

// Límite de intentos (contraseñas, cupones, pedidos) sin gastar la cuota de KV: memoria del servidor + D1
const MEMORIA_INTENTOS = new Map();
async function excedido(env, clave, max) {
  const m = MEMORIA_INTENTOS.get(clave), ahora = Date.now();
  if (m && m.expira > ahora && m.n >= max) return true;
  const r = await env.DB.prepare("SELECT n, expira FROM intentos WHERE clave = ?").bind(clave).first();
  return !!(r && r.expira > ahora && r.n >= max);
}
async function sumarIntento(env, clave, segundos) {
  const ahora = Date.now();
  const r = await env.DB.prepare(`INSERT INTO intentos (clave, n, expira) VALUES (?, 1, ?) ON CONFLICT(clave) DO UPDATE SET
      n = CASE WHEN intentos.expira < ? THEN 1 ELSE intentos.n + 1 END, expira = CASE WHEN intentos.expira < ? THEN excluded.expira ELSE intentos.expira END RETURNING n, expira`)
    .bind(clave, ahora + segundos * 1000, ahora, ahora).first();
  MEMORIA_INTENTOS.set(clave, r);
  if (MEMORIA_INTENTOS.size > 5000) MEMORIA_INTENTOS.clear();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM intentos WHERE expira < ?").bind(ahora).run();   // limpieza ocasional
  return r.n;
}
const ipDe = request => request.headers.get("cf-connecting-ip") || "desconocida";

// ---------- Catálogo y almacén ----------
// El CATÁLOGO guarda los datos de cada producto (se puede reemplazar con un CSV o con el proveedor).
// El ALMACÉN guarda lo físico: existencias por producto/talla y el costo real de tus compras. Solo lo cambian las ventas,
// las cancelaciones, las compras y las existencias que editas a mano. La tienda ve los dos juntos (leerCatalogo).
async function leerCatalogoBase(env) {
  const d = await leerDoc(env, "catalogo");
  if (d && Array.isArray(d.valor.productos)) return { ...d.valor, version: d.version, actualizado: d.actualizado || d.valor.actualizado || null };
  return { productos: CATALOGO_INICIAL, actualizado: null, version: 0 };
}
const sumaVariantes = vs => vs.some(x => x.stock == null && x.disponible !== false) ? null : vs.reduce((t, x) => t + (x.disponible === false ? 0 : x.stock || 0), 0);
const instantanea = p => { const { stock, costoReal, soloAlmacen, ...q } = p; if (q.variantes) q.variantes = q.variantes.map(({ stock, ...v }) => v); return q; };
// Entrada de almacén a partir de un producto (para la migración y para la primera vez que se mueve un producto)
function entradaDe(p) {
  if (!p) return null;
  const tallas = p.variantes?.length ? Object.fromEntries(p.variantes.map(v => [v.talla, v.stock ?? null])) : null;
  return { stock: tallas ? null : (p.stock ?? null), ...(tallas ? { tallas } : {}), ...(p.costoReal ? { costoReal: p.costoReal } : {}), producto: instantanea(p) };
}
const totalAlmacen = e => e.tallas ? Object.values(e.tallas).reduce((t, x) => t + (x > 0 ? x : 0), 0) : (e.stock > 0 ? e.stock : 0);
function conAlmacen(p, e) {
  const q = { ...p };
  if (q.variantes?.length) { q.variantes = q.variantes.map(v => ({ ...v, stock: e.tallas && v.talla in e.tallas ? e.tallas[v.talla] : (v.stock ?? null) })); q.stock = sumaVariantes(q.variantes); }
  else if (e.stock !== undefined) q.stock = e.stock;
  if (e.costoReal) q.costoReal = e.costoReal; else delete q.costoReal;
  return q;
}
async function leerAlmacen(env) {
  let d = await leerDoc(env, "almacen");
  if (!d) {   // primera vez: se copian al almacén las existencias y costos que estaban dentro del catálogo
    const base = await leerCatalogoBase(env), items = {};
    // Solo lo que de verdad tienes: entrega inmediata con piezas (o con costo real de una compra). Lo bajo pedido no entra al almacén.
    for (const p of base.productos) { const e = entradaDe(p); if (p.costoReal || (p.entrega !== "pedido" && totalAlmacen(e) > 0)) items[p.id] = e; }
    await modificarDoc(env, "almacen", () => ({ items }), v => v?.items ? v : { items });
    d = await leerDoc(env, "almacen");
  }
  return { items: d?.valor?.items || {}, version: d?.version || 0 };
}
async function leerCatalogo(env) {
  const [base, alm] = await Promise.all([leerCatalogoBase(env), leerAlmacen(env)]), vistos = new Set();
  const productos = base.productos.map(p => { vistos.add(p.id); const e = alm.items[p.id]; return e ? conAlmacen(p, e) : p; });
  // Lo que tienes en almacén aunque ya no venga en el catálogo del proveedor se sigue mostrando mientras haya piezas
  for (const [id, e] of Object.entries(alm.items)) if (!vistos.has(id) && e.producto && totalAlmacen(e) > 0) productos.push({ ...conAlmacen(e.producto, e), soloAlmacen: true });
  return { ...base, productos, versionAlmacen: alm.version };
}
// Mueve existencias en el almacén. movs: [{ id, talla, delta }]; si no hay suficientes, sale lo que haya y devuelve lo que faltó
async function moverExistencias(env, movs) {
  const base = await leerCatalogoBase(env), mapa = new Map(base.productos.map(p => [p.id, p])), faltan = [], hechos = [];
  await modificarDoc(env, "almacen", () => ({ items: {} }), a => {
    faltan.length = 0; hechos.length = 0; const items = { ...(a.items || {}) };
    for (const [n, m] of movs.entries()) {
      const e = items[m.id] ? { ...items[m.id], tallas: items[m.id].tallas ? { ...items[m.id].tallas } : undefined } : entradaDe(mapa.get(m.id));
      if (!e) continue;
      const st = m.talla ? e.tallas?.[m.talla] : e.stock;
      if (st == null) continue;                                     // sin control de existencias
      if (!items[m.id] && m.delta < 0 && !(st > 0)) { faltan[n] = -m.delta; hechos[n] = 0; continue; }   // bajo pedido: no estaba en tu almacén
      const nuevo = m.delta < 0 ? Math.max(0, st + m.delta) : st + m.delta;
      if (m.delta < 0 && st + m.delta < 0) faltan[n] = -(st + m.delta);
      if (m.talla) e.tallas[m.talla] = nuevo; else e.stock = nuevo;
      if (mapa.get(m.id)) e.producto = instantanea(mapa.get(m.id));
      items[m.id] = e; hechos[n] = nuevo - st;
    }
    return { ...a, items };
  });
  return { faltan, hechos };
}
// Fija existencias a un valor (edición manual). lista: [{ id, talla, stock }] — stock null = sin control de existencias
async function fijarExistencias(env, lista, productos) {
  const mapa = new Map(productos.map(p => [p.id, p])), conflictos = [];
  await modificarDoc(env, "almacen", () => ({ items: {} }), a => {
    const items = { ...(a.items || {}) }; conflictos.length = 0;
    for (const x of lista) {
      // Si mientras editabas una venta cambió esa existencia, no se sobrescribe (x.base = valor al empezar a editar)
      if ("base" in x && items[String(x.id)]) { const e = items[String(x.id)], actual = x.talla ? e.tallas?.[String(x.talla)] : e.stock;
        if ((actual ?? null) !== (x.base ?? null)) { conflictos.push({ id: String(x.id), talla: x.talla || "", actual: actual ?? null }); continue; } }
      const id = String(x.id || ""), p = mapa.get(id); if (!p && !items[id]) continue;
      const stock = x.stock == null || x.stock === "" ? null : Math.max(0, Math.floor(Number(x.stock) || 0));
      const e = items[id] ? { ...items[id], tallas: items[id].tallas ? { ...items[id].tallas } : undefined } : entradaDe(p);
      if (x.talla) { e.tallas = e.tallas || {}; e.tallas[String(x.talla)] = stock; } else e.stock = stock;
      if (p) e.producto = instantanea(p);
      items[id] = e;
    }
    return { ...a, items };
  });
  return conflictos;
}
const versionCatalogo = async env => { const r = await env.DB.prepare("SELECT clave, version FROM datos WHERE clave IN ('catalogo', 'almacen')").all();
  const v = Object.fromEntries((r.results || []).map(x => [x.clave, x.version])); return `${v.catalogo ?? 0}.${v.almacen ?? 0}`; };
// ---------- Precio dinámico: costo € × factor × tipo de cambio Banxico × (1 + IVA), terminado en 9 ----------
const CONFIG_INICIAL = { factor: 1.65, iva: 16, tcManual: null };
async function leerConfig(env) { return { ...CONFIG_INICIAL, ...((await leerDoc(env, "config"))?.valor || {}) }; }
const SERIE_EUR = "SF46410";   // Banxico SIE: tipo de cambio peso por euro
// ctx (opcional): si el valor guardado está viejo, se actualiza EN SEGUNDO PLANO y la visita no espera a Banxico
async function tipoCambio(env, forzar = false, ctx = null) {
  const guardado = (await leerDoc(env, "tipo-cambio"))?.valor || null;
  const reciente = guardado && Date.now() - guardado.consultado < 6 * 3600e3;
  if ((reciente && !forzar) || !env.BANXICO_TOKEN) return guardado;
  if (ctx?.waitUntil && guardado?.valor && !forzar) { ctx.waitUntil(consultarBanxico(env, guardado).catch(() => {})); return guardado; }
  return consultarBanxico(env, guardado);
}
async function consultarBanxico(env, guardado) {
  try {
    const r = await fetch(`https://www.banxico.org.mx/SieAPIRest/service/v1/series/${SERIE_EUR}/datos/oportuno`,
      { headers: { "Bmx-Token": env.BANXICO_TOKEN, accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Banxico respondió ${r.status}`);
    const d = (await r.json())?.bmx?.series?.[0]?.datos?.[0];
    const valor = parseFloat(String(d?.dato ?? "").replace(/,/g, ""));
    if (!(valor > 5 && valor < 100)) throw new Error("Banxico no devolvió un tipo de cambio válido");
    const nuevo = { valor, fecha: d.fecha, consultado: Date.now(), fuente: "Banxico" };
    await escribirDoc(env, "tipo-cambio", nuevo);
    return nuevo;
  } catch (e) {
    // Conserva el último valor y reintenta en ~1 h
    const marca = { ...(guardado || {}), consultado: Date.now() - 5 * 3600e3, error: String(e.message || e).slice(0, 200) };
    await escribirDoc(env, "tipo-cambio", marca);
    return marca;
  }
}
const redondear9 = x => Math.ceil((x + 1) / 10) * 10 - 1;     // 3,410.40 → 3,419
__PRECIO__
function precioDe(p, tc, cfg) {
  if (p.costoEur == null) return { precio: p.precio ?? null, precioAntes: p.precioAntes };
  if (!tc) return { precio: null };
  // Modo «costo»: costo puesto en México + ganancia (precio.js). Modo «factor»: costo € × factor × TC × (1 + IVA)
  const base = cfg.modo === "costo" ? precioProducto(p, tc, cfg).precio : p.costoEur * cfg.factor * tc * (1 + (cfg.iva ?? 16) / 100), d = p.descuento || 0;
  return d > 0 ? { precio: redondear9(base * (1 - d / 100)), precioAntes: redondear9(base) } : { precio: redondear9(base) };
}
function paraTienda(p, tc, cfg) {
  const q = { ...p, ...precioDe(p, tc, cfg) };
  for (const k of PRIVADOS) delete q[k];
  if (q.precioAntes == null) delete q.precioAntes;
  return q;
}

// Con existencias en 0 el producto pasa a "bajo pedido" (no se oculta). Solo se oculta con disponible = no.
// Agotado en el proveedor y sin existencias propias → oculto (no se puede pedir).
const existenciasPropias = p => p.variantes?.length ? p.variantes.some(v => v.stock > 0) : p.stock > 0;
const visible = p => p.disponible !== false && !(p.agotadoProveedor && !existenciasPropias(p)) && (!p.variantes?.length || p.variantes.some(v => v.disponible !== false));

function paginaPublica(productos, tc, cfg, tienda = productos.filter(visible).map(p => paraTienda(p, tc, cfg))) {
  const i = HTML_PUBLICO.indexOf(INICIO), f = HTML_PUBLICO.indexOf(FIN);
  // JSON seguro dentro de <script>: sin "</" ni separadores de línea Unicode.
  const datos = JSON.stringify(tienda)
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return HTML_PUBLICO.slice(0, i + INICIO.length) + datos + HTML_PUBLICO.slice(f);
}

// Validación en el servidor (el panel ya valida, pero nunca se confía en el cliente).
function texto(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function urlHttps(v) {
  if (typeof v !== "string" || !v) return undefined;
  try { const u = new URL(v.trim()); if (u.protocol === "https:" && v.length <= 500) return u.toString(); } catch {}
  return undefined;
}
function urlImagen(v) {
  if (typeof v !== "string" || !v) return undefined;
  if (/^img\/[a-z0-9\/._-]+$/i.test(v) || /^\/media\/[a-z0-9-]+(\?v=\d+)?$/i.test(v)) return v;
  try { const u = new URL(v); if (u.protocol === "https:") return u.toString().slice(0, 500); } catch {}
  return undefined;
}
function validarProductos(lista) {
  if (!Array.isArray(lista)) throw new Error("Formato inválido.");
  if (lista.length > 2000) throw new Error("Máximo 2000 productos.");
  const ids = new Set();
  return lista.map((p, n) => {
    const id = texto(p.id, 80).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Producto ${n + 1}: id inválido.`);
    if (ids.has(id)) throw new Error(`Producto ${n + 1}: id repetido (${id}).`);
    ids.add(id);
    const nombre = texto(p.nombre, 120);
    if (!nombre) throw new Error(`Producto ${n + 1}: falta el nombre.`);
    if (!CATEGORIAS.includes(p.categoria)) throw new Error(`Producto ${n + 1}: categoría inválida.`);
    const num = v => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
    const entero = v => (Number.isInteger(v) && v >= 0 ? v : null);
    let stock = p.stock == null ? null : entero(p.stock), variantes;
    if (Array.isArray(p.variantes) && p.variantes.length) {
      const tallas = new Set();
      variantes = p.variantes.slice(0, 30).map(v => {
        const talla = texto(v.talla, 20);
        if (!talla || tallas.has(talla)) throw new Error(`Producto ${n + 1}: talla vacía o repetida.`);
        tallas.add(talla);
        const out = { talla, stock: v.stock == null ? null : entero(v.stock) };
        if (v.disponible === false) out.disponible = false;
        return out;
      });
      stock = variantes.some(v => v.stock == null && v.disponible !== false) ? null : variantes.reduce((t, v) => t + (v.disponible === false ? 0 : v.stock || 0), 0);
    }
    const specs = {};
    for (const [k, v] of Object.entries(p.specs || {}).slice(0, 16)) {
      const kk = texto(k, 30), vv = texto(String(v), 80);
      if (kk && vv) specs[kk] = vv;
    }
    const prod = {
      id, nombre, categoria: p.categoria,
      precio: num(p.precio),
      specs,
      etiquetas: (Array.isArray(p.etiquetas) ? p.etiquetas : []).filter(e => ETIQUETAS.includes(e)),
      stock,
      entrega: p.entrega === "pedido" ? "pedido" : "inmediata",
      color: /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "{{tienda.colores.primario}}",
    };
    if (variantes) prod.variantes = variantes;
    if (p.disponible === false) prod.disponible = false;
    const antes = num(p.precioAntes);
    if (antes && prod.precio && antes > prod.precio) prod.precioAntes = antes;
    if (p.categoria === "palas") {
      if (NIVELES.includes(p.nivel)) prod.nivel = p.nivel;
      if (JUEGOS.includes(p.juego)) prod.juego = p.juego;
    }
    const img = urlImagen(p.imagen);
    if (img) prod.imagen = img;
    // Datos del proveedor (privados)
    const costo = num(p.costoEur);
    if (costo) {
      prod.costoEur = costo; delete prod.precio; delete prod.precioAntes;
      const d = Math.round(Number(p.descuento) || 0);
      if (d > 0 && d <= 90) prod.descuento = d;
    }
    for (const k of ["urlProveedor", "imagenOrigen", "fotoDe"]) { const u = urlHttps(p[k]); if (u) prod[k] = u; }
    if (p.agotadoProveedor === true) prod.agotadoProveedor = true;
    const cr = num(p.costoReal?.unitario);
    if (cr) prod.costoReal = { unitario: cr, fecha: texto(p.costoReal.fecha || "", 10), compra: texto(p.costoReal.compra || "", 20) };
    const resumen = texto(p.resumen || "", 400);
    if (resumen) prod.resumen = resumen;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.nuevoDesde || "")) prod.nuevoDesde = p.nuevoDesde;
    // Último cambio de costo en el proveedor (para filtrar «bajaron / subieron de precio» en el panel)
    const cc = p.cambioCosto, de = num(cc?.de), a = num(cc?.a);
    if (de && a && de !== a && /^\d{4}-\d{2}-\d{2}$/.test(cc.fecha || "")) prod.cambioCosto = { de, a, fecha: cc.fecha };   // llegó del proveedor ese día (Novedades)
    return prod;
  });
}

// ---------- Códigos de descuento ----------
const hoyMX = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date()); // AAAA-MM-DD
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
function validarCupones(lista) {
  if (!Array.isArray(lista)) throw new Error("Formato inválido.");
  if (lista.length > 200) throw new Error("Máximo 200 códigos.");
  const vistos = new Set();
  return lista.map((c, n) => {
    const codigo = texto(c.codigo, 30).toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(codigo)) throw new Error(`Código ${n + 1}: usa de 3 a 30 letras, números o guiones, sin espacios.`);
    if (vistos.has(codigo)) throw new Error(`El código ${codigo} está repetido.`);
    vistos.add(codigo);
    const tipo = c.tipo === "monto" ? "monto" : "porcentaje";
    const valor = Number(c.valor);
    if (!isFinite(valor) || valor <= 0 || (tipo === "porcentaje" && valor > 90)) throw new Error(`${codigo}: el valor debe ser mayor a 0${tipo === "porcentaje" ? " y como máximo 90 %" : ""}.`);
    const minimo = Number(c.minimo) > 0 ? Math.round(Number(c.minimo) * 100) / 100 : 0;
    const desde = FECHA.test(c.desde || "") ? c.desde : null, hasta = FECHA.test(c.hasta || "") ? c.hasta : null;
    if (desde && hasta && desde > hasta) throw new Error(`${codigo}: la fecha "desde" es posterior a "hasta".`);
    return {
      codigo, tipo, valor: Math.round(valor * 100) / 100, minimo, desde, hasta,
      categorias: (Array.isArray(c.categorias) ? c.categorias : []).filter(x => CATEGORIAS.includes(x)),
      acumulable: c.acumulable === true, activo: c.activo !== false, nota: texto(c.nota || "", 100),
    };
  });
}
async function leerCupones(env) { return (await leerDoc(env, "cupones"))?.valor || []; }

async function canjearCupon(request, env) {
  if (!env.DB) return json({ error: "No disponible." }, 503);
  const k = "cupon:" + ipDe(request);
  if (await excedido(env, k, 20)) return json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
  let codigo = "";
  try { codigo = String((await request.json()).codigo || "").trim().toUpperCase().slice(0, 30); } catch {}
  const premio = await leerPremio(env, codigo);
  if (premio && !premio.error) return json({ ok: true, cupon: { codigo, tipo: "premio", valor: premio.porcentaje, tope: premio.tope, unaPieza: true, hasta: premio.vence } });
  if (premio?.error) { await sumarIntento(env, k, 600); return json({ error: premio.error }, 404); }
  const c = (await leerCupones(env)).find(x => x.codigo === codigo && x.activo);
  const hoy = hoyMX();
  const motivo = !c ? "Código no válido." : c.desde && hoy < c.desde ? "Este código aún no está vigente." : c.hasta && hoy > c.hasta ? "Este código ya expiró." : null;
  if (motivo) {
    await sumarIntento(env, k, 600);
    return json({ error: motivo }, 404);
  }
  const { nota, activo, desde, ...publico } = c;
  return json({ ok: true, cupon: publico });
}

// ---------- Pedidos y pagos (Mercado Pago Checkout Pro) ----------
const ENVIO = { gratisDesde: {{tienda.envio.gratisDesde}}, costo: {{tienda.envio.costo}} };          // igual que TIENDA en index.html
const ZONA = "America/Mexico_City";
const ESTADOS_MX = ["Aguascalientes","Baja California","Baja California Sur","Campeche","Chiapas","Chihuahua","Ciudad de México","Coahuila","Colima","Durango","Estado de México","Guanajuato","Guerrero","Hidalgo","Jalisco","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca","Puebla","Querétaro","Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco","Tamaulipas","Tlaxcala","Veracruz","Yucatán","Zacatecas"];
const ESTADO_PEDIDO = { pendiente_pago: "Pendiente de pago", pago_pendiente: "Pago en proceso", pagado: "Pagado", rechazado: "Pago rechazado", cancelado: "Cancelado", enviado: "Enviado", entregado: "Entregado", reembolsado: "Reembolsado" };
const aleatorio = (n, abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789") => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map(x => abc[x % abc.length]).join(""); };
const redondear2 = x => Math.round(x * 100) / 100;
const existenciaDe = (p, talla) => talla ? p.variantes?.find(v => v.talla === talla)?.stock : p.stock;

// Recalcula TODO en el servidor: precio dinámico, descuento, cupón y envío (nunca se confía en el navegador)
async function cotizar(env, items, codigo) {
  const [{ productos }, config, tc] = await Promise.all([leerCatalogo(env), leerConfig(env), tipoCambio(env)]);
  const tcEf = config.tcManual || tc?.valor || null;
  const mapa = new Map(productos.map(p => [p.id, p]));
  if (!Array.isArray(items) || !items.length || items.length > 30) throw new Error("Tu carrito está vacío.");
  const lineas = items.map(it => {
    const p = mapa.get(String(it.id || ""));
    const cantidad = Math.floor(Number(it.cantidad));
    if (!p || !visible(p)) throw new Error("Un producto de tu carrito ya no está disponible. Revisa tu carrito.");
    if (!(cantidad >= 1 && cantidad <= 20)) throw new Error("Cantidad inválida.");
    const talla = it.talla ? String(it.talla).slice(0, 20) : null;
    if (p.variantes?.length) { const v = p.variantes.find(x => x.talla === talla); if (!v || v.disponible === false) throw new Error(`Elige una talla disponible de ${p.nombre}.`); }
    else if (talla) throw new Error("Talla inválida.");
    const { precio, precioAntes } = precioDe(p, tcEf, config);
    if (!precio) throw new Error(`${p.nombre} aún no tiene precio.`);
    const st = existenciaDe(p, talla);
    const tipo = p.entrega === "pedido" || (st != null && cantidad > st) ? "pedido" : "inmediata";
    return { id: p.id, nombre: p.nombre, talla, cantidad, precio, precioAntes: precioAntes || null, categoria: p.categoria, tipo,
      // datos internos para el panel (nunca se muestran al cliente)
      costoEur: p.costoEur ?? null, urlProveedor: p.urlProveedor || null, enAlmacen: st == null ? null : Math.min(st, cantidad) };
  });
  const subtotal = redondear2(lineas.reduce((t, l) => t + l.precio * l.cantidad, 0));
  let descuento = 0, cupon = null;
  const premio = codigo ? await leerPremio(env, String(codigo).trim().toUpperCase()) : null;
  if (premio && !premio.error) { descuento = descuentoPremio(premio, lineas); cupon = { codigo: premio.codigo, tipo: "premio", valor: premio.porcentaje, tope: premio.tope }; }
  else if (codigo) {
    const c = (await leerCupones(env)).find(x => x.codigo === String(codigo).trim().toUpperCase() && x.activo);
    const hoy = hoyMX();
    if (c && !(c.desde && hoy < c.desde) && !(c.hasta && hoy > c.hasta) && !(c.minimo && subtotal < c.minimo)) {
      const aplica = lineas.filter(l => (!c.categorias.length || c.categorias.includes(l.categoria)) && (c.acumulable || !l.precioAntes)).reduce((t, l) => t + l.precio * l.cantidad, 0);
      descuento = redondear2(c.tipo === "porcentaje" ? Math.round(aplica * c.valor) / 100 : Math.min(c.valor, aplica));
      if (descuento > 0) cupon = { codigo: c.codigo, tipo: c.tipo, valor: c.valor };
    }
  }
  const neto = redondear2(subtotal - descuento);
  const envio = neto >= ENVIO.gratisDesde ? 0 : ENVIO.costo;
  return { lineas, subtotal, descuento, cupon, envio, total: redondear2(neto + envio), tc: tcEf };
}

function validarCliente(c = {}) {
  const t = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const cli = { nombre: t(c.nombre, 80), email: t(c.email, 120).toLowerCase(), tel: t(c.tel, 20).replace(/[^\d+]/g, ""), calle: t(c.calle, 120), colonia: t(c.colonia, 80),
    cp: t(c.cp, 5), ciudad: t(c.ciudad, 60), estado: t(c.estado, 40), referencias: t(c.referencias, 200), promos: c.promos === true };
  if (cli.nombre.length < 3) throw new Error("Escribe tu nombre completo.");
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(cli.email)) throw new Error("Revisa tu correo electrónico.");
  if (cli.tel.replace(/\D/g, "").length < 10) throw new Error("Escribe un teléfono de 10 dígitos.");
  if (cli.calle.length < 4 || cli.colonia.length < 2 || cli.ciudad.length < 2) throw new Error("Completa tu dirección de envío.");
  if (!/^\d{5}$/.test(cli.cp)) throw new Error("El código postal debe tener 5 dígitos.");
  if (!ESTADOS_MX.includes(cli.estado)) throw new Error("Elige tu estado.");
  if (c.privacidad !== true) throw new Error("Debes aceptar el aviso de privacidad.");
  return cli;
}

// Pedidos en una tabla propia: cada cambio es condicionado a su versión (dos avisos simultáneos no se pisan)
async function insertarPedido(env, p) {
  await env.DB.prepare(`INSERT INTO pedidos (id, creado, estado, total, nombre, email, piezas, con_pedido, alerta, version, datos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(p.id, p.creado, p.estado, p.total, p.cliente.nombre, p.cliente.email, p.lineas.reduce((t, l) => t + l.cantidad, 0), p.lineas.some(l => l.tipo === "pedido") ? 1 : 0, p.alerta ? 1 : 0, JSON.stringify(p)).run();
}
async function leerPedidoV(env, id) {
  if (!/^{{tienda.prefijo}}-[A-Z0-9-]{4,30}$/.test(id || "")) return null;
  const r = await env.DB.prepare("SELECT datos, version FROM pedidos WHERE id = ?").bind(id).first();
  return r ? { pedido: JSON.parse(r.datos), version: r.version } : null;
}
async function leerPedido(env, id) { return (await leerPedidoV(env, id))?.pedido || null; }
// Aplica fn(pedido) con escritura condicionada; reintenta si cambió en medio. fn devuelve false para no guardar.
async function modificarPedido(env, id, fn) {
  for (let i = 0; i < 8; i++) {
    const d = await leerPedidoV(env, id); if (!d) return null;
    const p = d.pedido;
    if ((await fn(p)) === false) return p;
    const r = await env.DB.prepare(`UPDATE pedidos SET estado = ?, total = ?, con_pedido = ?, alerta = ?, datos = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING version`)
      .bind(p.estado, p.total, p.lineas.some(l => l.tipo === "pedido") ? 1 : 0, p.alerta ? 1 : 0, JSON.stringify(p), id, d.version).first();
    if (r) return p;
  }
  throw new Error("Conflicto al actualizar el pedido.");
}

async function crearPedido(request, env, url) {
  if (!env.DB) return json({ error: "No disponible." }, 503);
  if (!env.MP_ACCESS_TOKEN) return json({ error: "Los pagos en línea aún no están activos.", sinPagos: true }, 503);
  const k = "pedido:" + ipDe(request);
  if (await excedido(env, k, 15)) return json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
  await sumarIntento(env, k, 600);
  let body; try { body = await request.json(); } catch { return json({ error: "Datos inválidos." }, 400); }
  let cliente, cot;
  try { cliente = validarCliente(body.cliente); cot = await cotizar(env, body.items, body.cupon); }
  catch (e) { return json({ error: e.message }, 400); }
  if (cot.cupon?.tipo === "premio") {
    const pr = await env.DB.prepare("SELECT email, tel FROM premios WHERE codigo = ?").bind(cot.cupon.codigo).first();
    if (pr && pr.email !== cliente.email && pr.email !== correoCanonico(cliente.email) && pr.tel !== cliente.tel.replace(/\D/g, "").slice(-10))
      return json({ error: "Tu código de premio es personal: usa el mismo correo o teléfono con el que te registraste en el juego." }, 400);
  }
  // Si hay productos bajo pedido, el cliente debe haber aceptado la fecha estimada (evita cancelaciones)
  const conPedido = cot.lineas.some(l => l.tipo === "pedido");
  if (conPedido && body.aceptaPedido?.acepta !== true) return json({ error: "Confirma la fecha máxima de entrega de los productos sin existencias.", requiereAceptarPedido: true }, 400);
  const ahora = new Date();
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "2-digit", month: "2-digit", day: "2-digit" }).format(ahora).replace(/-/g, "");
  const pedido = { id: `{{tienda.prefijo}}-${fecha}-${aleatorio(5)}`, token: aleatorio(24, "abcdefghijkmnpqrstuvwxyz23456789"), creado: ahora.toISOString(), estado: "pendiente_pago",
    cliente, ...cot, historial: [{ fecha: ahora.toISOString(), estado: "pendiente_pago", nota: "Pedido creado" }] };
  if (conPedido) pedido.aceptaBajoPedido = { fecha: ahora.toISOString(), estimado: texto(String(body.aceptaPedido.estimado || ""), 80) };
  const origen = url.origin;
  pedido.origen = origen;
  const vuelta = `${origen}/?pedido=${pedido.id}&t=${pedido.token}`;
  const nombres = cot.lineas.map(l => `${l.cantidad}× ${l.nombre}${l.talla ? " (" + l.talla + ")" : ""}`).join(", ");
  const [nombre, ...apellidos] = cliente.nombre.split(" ");
  const pref = {
    items: [{ id: pedido.id, title: `{{tienda.nombre}} · Pedido ${pedido.id}`, description: nombres.slice(0, 250), quantity: 1, unit_price: cot.total, currency_id: "MXN", category_id: "{{tienda.textos.categoriaMP}}" }],
    // En el sitio de pruebas NO se manda el correo: si es de una cuenta real de Mercado Pago, MP rechaza el pago
    // ("una de las partes es de prueba"). En producción sí se manda para prellenar el checkout.
    payer: { name: nombre, surname: apellidos.join(" "), ...(modoPruebaMP(env, url) ? {} : { email: cliente.email }), phone: { number: cliente.tel },
      address: { zip_code: cliente.cp, street_name: cliente.calle } },
    back_urls: { success: vuelta, pending: vuelta, failure: vuelta }, auto_return: "approved",
    notification_url: `${origen}/api/mp/webhook`, external_reference: pedido.id, statement_descriptor: "{{tienda.descriptorTarjeta}}",
    expires: true, expiration_date_to: new Date(Date.now() + 72 * 3600e3).toISOString(),
    metadata: { pedido: pedido.id },
  };
  try {
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "content-type": "application/json", "x-idempotency-key": pedido.id }, body: JSON.stringify(pref) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.init_point) throw new Error(d.message || `Mercado Pago respondió ${r.status}`);
    pedido.mp = { preferencia: d.id };
    await insertarPedido(env, pedido);
    return json({ ok: true, id: pedido.id, url: d.init_point, total: cot.total });
  } catch (e) {
    console.error("Mercado Pago (preferencia):", String(e.message || e).slice(0, 300));   // queda en los registros de Cloudflare
    return json({ error: "No pudimos conectar con Mercado Pago. Intenta de nuevo en un momento." }, 502);
  }
}

// Mercado Pago avisa del pago → se confirma consultando su API (fuente de verdad) y se actualiza el pedido
async function firmaValida(request, env, url, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true;
  const sig = request.headers.get("x-signature") || "", reqId = request.headers.get("x-request-id") || "";
  const ts = (sig.match(/ts=([^,]+)/) || [])[1], v1 = (sig.match(/v1=([0-9a-f]+)/) || [])[1];
  if (!ts || !v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${ts};`;
  const k = await crypto.subtle.importKey("raw", enc.encode(env.MP_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return igual(hex(await crypto.subtle.sign("HMAC", k, enc.encode(manifest))), v1);
}
// ---------- Correos de la tienda (Resend) ----------
// Secreto RESEND_API_KEY (llave "solo envío"). Sin la llave la tienda funciona igual, solo no manda correos.
const REMITENTE = "{{tienda.nombre}} <{{tienda.correo.remitente}}>", RESPONDER_A = "{{tienda.correo.contacto}}", AVISOS_A = "{{tienda.correo.contacto}}";
const escHtml = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pesos = n => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function enviarCorreo(env, { para, asunto, html, texto: txt, clave }) {
  if (!env.RESEND_API_KEY) return { omitido: "sin RESEND_API_KEY" };
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", ...(clave ? { "idempotency-key": clave } : {}) },
      body: JSON.stringify({ from: REMITENTE, to: [para], reply_to: RESPONDER_A, subject: asunto, html, text: txt }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("Resend:", r.status, JSON.stringify(d).slice(0, 300)); return { error: d.message || `Resend respondió ${r.status}` }; }
    return { id: d.id };
  } catch (e) { console.error("Resend:", String(e.message || e)); return { error: "No se pudo conectar con el servicio de correo." }; }
}
const sitioDe = p => (p.origen && /^https:\/\/[a-z0-9.-]+$/i.test(p.origen) ? p.origen : "{{tienda.sitio}}");
// Plantilla sencilla con estilos en línea (los programas de correo ignoran las hojas de estilo)
function plantillaCorreo(titulo, cuerpo, sitio) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(titulo)}</title></head>
<body style="margin:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b0f1a;padding:18px 24px"><a href="${sitio}" style="text-decoration:none;font-size:26px;font-weight:900;font-style:italic;color:#fff">{{html:tienda.logoCorreo}}</a></td></tr>
<tr><td style="padding:24px">${cuerpo}</td></tr>
<tr><td style="padding:16px 24px;background:#f7f8fa;font-size:12px;color:#667085;line-height:1.5">{{tienda.nombre}} · {{tienda.direccion.completa}}<br>¿Dudas? Responde a este correo, escríbenos a <a href="mailto:{{tienda.correo.contacto}}" style="color:{{tienda.colores.primario}}">{{tienda.correo.contacto}}</a> o por <a href="https://wa.me/{{tienda.whatsapp}}" style="color:{{tienda.colores.primario}}">WhatsApp {{tienda.telefono}}</a>.</td></tr>
</table></td></tr></table></body></html>`;
}
function tablaPedido(p) {
  const filas = p.lineas.map(l => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${escHtml(l.nombre)}${l.talla ? ` · talla ${escHtml(l.talla)}` : ""}${l.cantidad > 1 ? ` × ${l.cantidad}` : ""}${l.tipo === "pedido" ? `<br><span style="font-size:12px;color:{{tienda.colores.primario}}">📦 Entrega en hasta 10 días hábiles</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #eee;white-space:nowrap">${pesos(l.precio * l.cantidad)}</td></tr>`).join("");
  const fila = (a, b, fuerte) => `<tr><td style="padding:4px 0;${fuerte ? "font-weight:700;font-size:16px" : "color:#475467"}">${a}</td><td align="right" style="padding:4px 0;${fuerte ? "font-weight:700;font-size:16px" : "color:#475467"}">${b}</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;margin:12px 0">${filas}
    ${fila("Subtotal", pesos(p.subtotal))}${p.descuento ? fila(`Código ${escHtml(p.cupon?.codigo || "")}`, "−" + pesos(p.descuento)) : ""}${fila("Envío", p.envio ? pesos(p.envio) : "Gratis")}${fila("Total", pesos(p.total), true)}</table>`;
}
const direccionDe = c => `${escHtml(c.calle)}, col. ${escHtml(c.colonia)}<br>${escHtml(c.cp)} ${escHtml(c.ciudad)}, ${escHtml(c.estado)}${c.referencias ? `<br><span style="color:#667085">Ref: ${escHtml(c.referencias)}</span>` : ""}`;
function textoEntrega(p) {
  const pedido = p.lineas.some(l => l.tipo === "pedido");
  // Pedidos anteriores guardaron un rango ("X y el Y"); los nuevos, una sola fecha máxima
  const est = p.aceptaBajoPedido?.estimado ? escHtml(p.aceptaBajoPedido.estimado) : "";
  return pedido ? `Tu pedido incluye productos con entrega en máximo 10 días hábiles${est ? `: llega a más tardar ${est.includes(" y el ") ? "entre el" : "el"} <b>${est}</b>` : ""}, y muchas veces antes. Enviamos todo junto.`
    : `Enviamos el mismo día hábil si tu pago se acreditó antes de las 2:00 p.m. (lunes a viernes); si no, el siguiente día hábil. Llega en 48–72 horas hábiles.`;
}
async function correoConfirmacion(env, p, reenvio = false) {
  const sitio = sitioDe(p), enlace = `${sitio}/?pedido=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.token)}`, nombre = escHtml(p.cliente.nombre.split(" ")[0]);
  const html = plantillaCorreo(`Pedido ${p.id} confirmado`, `<h1 style="margin:0 0 8px;font-size:22px">¡Gracias por tu compra, ${nombre}! {{tienda.emoji}}</h1>
    <p style="margin:0 0 16px;color:#475467">Recibimos tu pago y tu pedido está confirmado.</p>
    <p style="margin:0 0 4px;font-size:13px;color:#667085">Folio de tu pedido</p><p style="margin:0 0 16px;font-size:20px;font-weight:700;letter-spacing:.04em">${escHtml(p.id)}</p>
    ${tablaPedido(p)}
    <p style="margin:16px 0 4px;font-weight:700">Entrega</p><p style="margin:0 0 8px;color:#475467;font-size:14px;line-height:1.5">${textoEntrega(p)}</p>
    <p style="margin:12px 0 4px;font-weight:700">Dirección de envío</p><p style="margin:0 0 16px;color:#475467;font-size:14px;line-height:1.5">${escHtml(p.cliente.nombre)}<br>${direccionDe(p.cliente)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#475467">Te avisaremos por correo cuando tu pedido salga, con el número de guía.</p>
    <p style="margin:20px 0 0"><a href="${enlace}" style="display:inline-block;background:{{tienda.colores.primario}};color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Ver mi pedido</a></p>`, sitio);
  const txt = `¡Gracias por tu compra! Tu pedido ${p.id} está confirmado.\nTotal: ${pesos(p.total)}\n${p.lineas.map(l => `- ${l.nombre}${l.talla ? " (talla " + l.talla + ")" : ""} x${l.cantidad}: ${pesos(l.precio * l.cantidad)}`).join("\n")}\nEnvío: ${p.envio ? pesos(p.envio) : "gratis"}\nVer tu pedido: ${enlace}\nDudas: {{tienda.correo.contacto}} · WhatsApp {{tienda.telefono}}`;
  return enviarCorreo(env, { para: p.cliente.email, asunto: `Pedido ${p.id} confirmado · {{tienda.nombre}}`, html, texto: txt, clave: reenvio ? `confirmacion-${p.id}-${Date.now()}` : `confirmacion-${p.id}` });
}
async function correoEnviado(env, p, reenvio = false) {
  const sitio = sitioDe(p), enlace = `${sitio}/?pedido=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.token)}`;
  const html = plantillaCorreo(`Tu pedido ${p.id} va en camino`, `<h1 style="margin:0 0 8px;font-size:22px">¡Tu pedido va en camino! 📦</h1>
    <p style="margin:0 0 16px;color:#475467">Pedido <b>${escHtml(p.id)}</b></p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="background:#f7f8fa;border-radius:10px;width:100%"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.6">
      <b>Paquetería:</b> ${escHtml(p.paqueteria || "—")}<br><b>Número de guía:</b> <span style="font-size:16px;font-weight:700;letter-spacing:.03em">${escHtml(p.guia || "—")}</span></td></tr></table>
    <p style="margin:16px 0 4px;font-weight:700">Se entrega en</p><p style="margin:0 0 16px;color:#475467;font-size:14px;line-height:1.5">${direccionDe(p.cliente)}</p>
    <p style="margin:0;font-size:14px;color:#475467">La paquetería entrega en días hábiles. Puedes ver dónde va tu paquete en «Ver mi pedido» o con el número de guía en el sitio de la paquetería.</p>
    <p style="margin:20px 0 0"><a href="${enlace}" style="display:inline-block;background:{{tienda.colores.primario}};color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Ver mi pedido</a></p>`, sitio);
  return enviarCorreo(env, { para: p.cliente.email, asunto: `Tu pedido ${p.id} va en camino · {{tienda.nombre}}`, html, texto: `Tu pedido ${p.id} va en camino.\nPaquetería: ${p.paqueteria || "—"}\nGuía: ${p.guia || "—"}\nVer tu pedido: ${enlace}`, clave: reenvio ? `enviado-${p.id}-${Date.now()}` : `enviado-${p.id}-${p.guia || ""}` });
}
async function correoAvisoVenta(env, p) {
  const pedido = p.lineas.some(l => l.tipo === "pedido");
  const html = plantillaCorreo(`Venta ${p.id}`, `<h1 style="margin:0 0 8px;font-size:20px">💰 Nueva venta: ${pesos(p.total)}</h1>
    <p style="margin:0 0 12px;color:#475467">Pedido <b>${escHtml(p.id)}</b> · ${escHtml(p.cliente.nombre)} · ${escHtml(p.cliente.email)} · ${escHtml(p.cliente.tel)}</p>
    ${pedido ? `<p style="margin:0 0 12px;padding:10px;background:#eef3ff;border-radius:8px;color:{{tienda.colores.primario}};font-size:14px">📦 Incluye productos <b>sin existencias</b>: pídelos hoy al proveedor (entrega máxima 10 días hábiles).</p>` : `<p style="margin:0 0 12px;padding:10px;background:#f1ffe0;border-radius:8px;font-size:14px">⚡ Todo es de entrega inmediata.</p>`}
    ${tablaPedido(p)}<p style="margin:12px 0 4px;font-weight:700">Enviar a</p><p style="margin:0;color:#475467;font-size:14px;line-height:1.5">${direccionDe(p.cliente)}</p>
    <p style="margin:20px 0 0"><a href="{{tienda.sitio}}/admin" style="display:inline-block;background:#0b0f1a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Abrir el panel</a></p>`, "{{tienda.sitio}}");
  return enviarCorreo(env, { para: AVISOS_A, asunto: `💰 Venta ${p.id} · ${pesos(p.total)}${pedido ? " · 📦 pedir al proveedor" : ""}`, html, texto: `Nueva venta ${p.id}: ${pesos(p.total)} — ${p.cliente.nombre}`, clave: `aviso-${p.id}` });
}
// Envía la confirmación y el aviso UNA sola vez por pedido (queda registrado en el historial)
async function correosDePago(env, id) {
  const p = await leerPedido(env, id);
  if (!p || p.correos?.confirmacion) return;
  const [c, a] = await Promise.all([correoConfirmacion(env, p), correoAvisoVenta(env, p)]);
  await modificarPedido(env, id, q => {
    q.correos = { ...(q.correos || {}), confirmacion: c.id ? new Date().toISOString() : null, aviso: !!a.id };
    q.historial.push({ fecha: new Date().toISOString(), estado: q.estado, nota: c.id ? `✉️ Correo de confirmación enviado a ${q.cliente.email}` : `⚠️ No se envió el correo de confirmación (${c.error || c.omitido})` });
  });
}

// Credenciales de prueba: TEST-… (formato viejo) o cualquier llave usada desde el sitio de pruebas (*.{{tienda.proyecto}}.pages.dev)
const modoPruebaMP = (env, url) => String(env.MP_ACCESS_TOKEN || "").startsWith("TEST-") || url.hostname.endsWith(".{{tienda.proyecto}}.pages.dev") || url.hostname === "localhost";
async function webhookMP(request, env, url) {
  if (!env.DB || !env.MP_ACCESS_TOKEN) return new Response("ok");
  let body = {}; try { body = await request.json(); } catch {}
  const tipo = body.type || body.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  const dataId = body.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id");
  if (!/^(payment|merchant_order)$/.test(tipo || "") || !dataId) return new Response("ok");
  if (tipo !== "payment") return new Response("ok");                    // órdenes comerciales: el pago llega en su propio aviso
  if (!/^\d{1,20}$/.test(String(dataId))) return new Response("ok");
  if (request.headers.get("x-signature")) {
    // Webhook (formato actual): trae firma y se verifica
    if (!(await firmaValida(request, env, url, dataId))) { await sumarIntento(env, "firma-invalida:" + hoyMX(), 172800); return new Response("firma inválida", { status: 401 }); }
  } else {
    // IPN (formato anterior, sin firma): NO se confía en el aviso; solo provoca una consulta del pago a Mercado Pago,
    // que es la fuente de verdad. Con límite por conexión para que no se use para saturar la API.
    const k = "ipn:" + ipDe(request);
    if (await excedido(env, k, 120)) return new Response("demasiados avisos", { status: 429 });
    await sumarIntento(env, k, 600);
  }
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, { headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return new Response("ok");                    // el pago no existe: nada que hacer
  if (!r.ok) return new Response("reintentar", { status: 500 });     // Mercado Pago reintenta
  const pago = await r.json();
  await aplicarPago(env, pago);
  return new Response("ok");
}
const ESTADO_MP = { approved: "pagado", authorized: "pago_pendiente", pending: "pago_pendiente", in_process: "pago_pendiente", in_mediation: "pagado",
  rejected: "rechazado", cancelled: "cancelado", refunded: "reembolsado", charged_back: "reembolsado" };
async function aplicarPago(env, pago) {
  const nuevo = ESTADO_MP[pago.status];
  if (!nuevo || !(await leerPedidoV(env, pago.external_reference))) return;
  const ahora = () => new Date().toISOString();
  let descontar = false;
  // 1) Cambia el estado del pedido (condicionado: si llegan dos avisos a la vez, solo uno "gana" el descuento de existencias)
  await modificarPedido(env, pago.external_reference, pedido => {
    descontar = false;
    if (nuevo === "pagado" && Math.abs(Number(pago.transaction_amount) - pedido.total) > 1) {
      if (pedido.alerta && pedido.mp?.pago === pago.id) return false;
      pedido.alerta = true;
      pedido.historial.push({ fecha: ahora(), estado: pedido.estado, nota: `⚠️ Monto pagado (${pago.transaction_amount}) distinto al total; revisar en Mercado Pago` });
      pedido.mp = { ...pedido.mp, pago: pago.id };
      return;
    }
    const yaPagado = ["pagado", "enviado", "entregado"].includes(pedido.estado);
    if (yaPagado && nuevo !== "reembolsado") return false;                 // idempotente
    if (pedido.estado === nuevo && pedido.mp?.pago === pago.id) return false;
    pedido.estado = nuevo;
    pedido.mp = { ...pedido.mp, pago: pago.id, metodo: pago.payment_method_id, tipoPago: pago.payment_type_id, cuotas: pago.installments, estadoMP: pago.status, detalle: pago.status_detail };
    pedido.historial.push({ fecha: ahora(), estado: nuevo, nota: `Mercado Pago: ${pago.status}${pago.status_detail ? " · " + pago.status_detail : ""}` });
    if (nuevo === "pagado" && !pedido.existenciasDescontadas) { pedido.existenciasDescontadas = "en_proceso"; descontar = true; }
  });
  if (nuevo === "reembolsado" || nuevo === "cancelado") await devolverExistencias(env, pago.external_reference);
  if (!descontar) return;
  // 2) Descuenta existencias del almacén de forma atómica y detecta sobreventa
  const faltantes = {};
  const pedido = await leerPedido(env, pago.external_reference);
  const lineasAlm = pedido.lineas.map((l, n) => ({ n, l })).filter(x => x.l.enAlmacen > 0);
  const mov = await moverExistencias(env, lineasAlm.map(({ l }) => ({ id: l.id, talla: l.talla || "", delta: -l.enAlmacen })));
  lineasAlm.forEach(({ n }, i) => { if (mov.faltan[i]) faltantes[n] = mov.faltan[i]; });   // alguien compró la última pieza antes
  // 3) Registra el resultado; si faltó mercancía, la línea pasa a "pedir al proveedor" con alerta
  await modificarPedido(env, pago.external_reference, p => {
    p.existenciasDescontadas = true;
    for (const [n, falta] of Object.entries(faltantes)) {
      const l = p.lineas[n];
      l.enAlmacen -= falta; l.tipo = "pedido"; l.faltante = falta;
      p.alerta = true;
      p.historial.push({ fecha: ahora(), estado: p.estado, nota: `⚠️ Sobreventa: al confirmarse el pago ya no había ${falta} pieza(s) de ${l.nombre}${l.talla ? " (" + l.talla + ")" : ""} en almacén. Pídela al proveedor y avisa al cliente de la nueva fecha.` });
    }
  });
  if (pedido.cupon?.tipo === "premio") {
    const usado = await env.DB.prepare("UPDATE premios SET usado = ? WHERE codigo = ? AND usado IS NULL RETURNING codigo").bind(pedido.id, pedido.cupon.codigo).first();
    if (!usado) await modificarPedido(env, pedido.id, p => { p.alerta = true; p.historial.push({ fecha: new Date().toISOString(), estado: p.estado, nota: `⚠️ El código de premio ${pedido.cupon.codigo} ya se había usado en otro pedido; este pedido se pagó con ese descuento. Revisa antes de enviar.` }); });
  } else if (pedido.cupon) await modificarDoc(env, "cupones-usos", () => ({}), u => ({ ...u, [pedido.cupon.codigo]: (u[pedido.cupon.codigo] || 0) + 1 }));
  await correosDePago(env, pedido.id);
  if (pedido.cliente.promos) await modificarDoc(env, "clientes", () => ({}), c => ({ ...c, [pedido.cliente.email]: { nombre: pedido.cliente.nombre, tel: pedido.cliente.tel, estado: pedido.cliente.estado, promos: true, alta: c[pedido.cliente.email]?.alta || pedido.creado, ultimaCompra: pedido.creado } }));
}

// Al cancelar o reembolsar un pedido que ya había descontado existencias, las regresa al almacén (una sola vez)
async function devolverExistencias(env, id) {
  let lineas = null;
  await modificarPedido(env, id, p => {
    if (p.existenciasDescontadas !== true) return false;
    p.existenciasDescontadas = "devueltas"; lineas = p.lineas;
  });
  if (!lineas) return;
  const devueltas = [];
  const conAlm = lineas.filter(l => l.enAlmacen > 0);
  const mov = await moverExistencias(env, conAlm.map(l => ({ id: l.id, talla: l.talla || "", delta: l.enAlmacen })));
  conAlm.forEach((l, i) => { if (mov.hechos[i] > 0) devueltas.push(`${l.enAlmacen} × ${l.nombre}${l.talla ? " (" + l.talla + ")" : ""}`); });
  const pedido = await leerPedido(env, id);
  if (pedido?.cupon?.tipo === "premio") await env.DB.prepare("UPDATE premios SET usado = NULL WHERE codigo = ? AND usado = ?").bind(pedido.cupon.codigo, id).run();
  await modificarPedido(env, id, p => { p.historial.push({ fecha: new Date().toISOString(), estado: p.estado, nota: devueltas.length ? `↩️ Existencias devueltas al almacén: ${devueltas.join(", ")}` : "↩️ Sin existencias que devolver (productos sin control de existencias o bajo pedido)" }); });
}
// Reembolso total en Mercado Pago (el aviso "refunded" de MP termina de marcar el pedido como reembolsado)
async function reembolsarMP(env, p) {
  if (!p.mp?.pago) return { error: "Este pedido no tiene un pago de Mercado Pago." };
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(p.mp.pago)}/refunds`, { method: "POST", signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "content-type": "application/json", "x-idempotency-key": `reembolso-${p.id}` }, body: "{}" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("Reembolso MP:", r.status, JSON.stringify(d).slice(0, 300)); return { error: d.message ? `Mercado Pago: ${d.message}` : `Mercado Pago respondió ${r.status}` }; }
  return { id: d.id, monto: d.amount };
}

// Consulta directa a Mercado Pago: por número de pago o buscando por folio del pedido
async function consultarPagoMP(env, pedidoId, pagoId) {
  const h = { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` }, sig = AbortSignal.timeout(8000);
  if (pagoId && /^\d{1,20}$/.test(pagoId)) {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, { headers: h, signal: sig });
    if (r.ok) { const p = await r.json(); if (p.external_reference === pedidoId) return p; }
  }
  const r = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(pedidoId)}&sort=date_created&criteria=desc&limit=5`, { headers: h, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const lista = (await r.json()).results || [];
  return lista.find(p => p.status === "approved") || lista[0] || null;
}

async function estadoPublico(env, url) {
  let p = await leerPedido(env, url.searchParams.get("id"));
  if (!p || !igual(p.token, String(url.searchParams.get("t") || ""))) return json({ error: "Pedido no encontrado." }, 404);
  // Rastreo de Envíosperros (se consulta como mucho cada 2 horas por pedido)
  if (p.estado === "enviado" && p.etiqueta?.guia && !p.etiqueta.cancelada && env.ENVIOSPERROS_TOKEN) { try { p = (await rastrearPedido(env, url.hostname, p.id)) || p; } catch {} }
  if (["pendiente_pago", "pago_pendiente"].includes(p.estado) && env.MP_ACCESS_TOKEN) {
    try { const pago = await consultarPagoMP(env, p.id, url.searchParams.get("pago")); if (pago) { await aplicarPago(env, pago); p = await leerPedido(env, p.id); } } catch {}
  }
  return json({ id: p.id, estado: p.estado, estadoTxt: ESTADO_PEDIDO[p.estado], total: p.total, metodo: p.mp?.tipoPago || null, guia: p.guia || null, paqueteria: p.paqueteria || null,
    rastreo: p.etiqueta?.rastreo?.codigo && !p.etiqueta.cancelada ? { texto: p.etiqueta.rastreo.texto, descripcion: p.etiqueta.rastreo.descripcion, estimada: p.etiqueta.rastreo.estimada, ciudad: p.etiqueta.rastreo.ciudad,
      eventos: (p.etiqueta.rastreo.eventos || []).slice(-6).reverse() } : null,
    lineas: p.lineas.map(l => ({ nombre: l.nombre, talla: l.talla, cantidad: l.cantidad, precio: l.precio, tipo: l.tipo })), envio: p.envio, descuento: p.descuento });
}

// ---------- Minijuego "¿Te atreves a enfrentar a El Rey o a El Mozart?" ----------
const JUEGO_INICIAL = { activo: true, porcentaje: 15, consuelo: 5, tope: null, maxDia: 3, maxConsueloDia: 20, vigenciaDias: 7 };
async function leerJuego(env) { const { esperaDias, ...g } = { ...JUEGO_INICIAL, ...((await leerDoc(env, "juego-config"))?.valor || {}) }; if (!MODULOS.juego) g.activo = false; return g; }
const inicioDiaMX = () => Date.parse(hoyMX() + "T00:00:00-06:00");
const limpiarTexto = (v, m) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, m);
// Correo "canónico" para los límites: en Gmail los puntos y lo que va después de "+" no cambian el buzón
function correoCanonico(e) {
  let [u, d] = String(e || "").toLowerCase().trim().split("@");
  if (!d) return String(e || "").toLowerCase().trim();
  u = u.split("+")[0];
  if (d === "googlemail.com") d = "gmail.com";
  if (d === "gmail.com") u = u.replace(/\./g, "");
  return `${u}@${d}`;
}
const DESECHABLES = new Set(["mailinator.com","yopmail.com","guerrillamail.com","guerrillamail.net","sharklasers.com","10minutemail.com","tempmail.com","temp-mail.org","temp-mail.io","trashmail.com","getnada.com","nada.email","dispostable.com","maildrop.cc","mailnesia.com","mintemail.com","emailondeck.com","fakeinbox.com","throwawaymail.com","moakt.com","tempail.com","mohmal.com","burnermail.io","mailpoof.com","tempr.email","discard.email","spamgourmet.com","mytemp.email","inboxkitten.com","1secmail.com","emailfake.com","tmail.ws","grr.la","mail.tm","tmpmail.org"]);
const MAX_CORREOS_VERIFICACION_DIA = 60;   // deja margen en el plan gratis de Resend (100/día) para los correos de pedidos
async function enviarCodigoJuego(env, jug, request) {
  const dia = "verif-dia:" + hoyMX();
  if (await excedido(env, dia, MAX_CORREOS_VERIFICACION_DIA)) return { error: "Hoy ya se enviaron muchos códigos. Intenta mañana, ¡perdón!" };
  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0");
  await env.DB.prepare("UPDATE jugadores SET codigo_hash = ?, codigo_expira = ?, codigo_intentos = 0 WHERE token = ?")
    .bind(await hashTexto("juego:" + jug.token + ":" + codigo), Date.now() + 15 * 60e3, jug.token).run();
  const html = plantillaCorreo("Tu código para jugar", `<h1 style="margin:0 0 8px;font-size:22px">¡Ya casi, ${escHtml(String(jug.nombre).split(" ")[0])}! 🎾</h1>
    <p style="margin:0 0 16px;color:#475467">Escribe este código en el juego para confirmar tu correo:</p>
    <p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:.3em;text-align:center;background:#f7f8fa;border-radius:12px;padding:14px">${codigo}</p>
    <p style="margin:0;font-size:13px;color:#667085">Vence en 15 minutos. Si tú no te registraste en {{tienda.dominio}}, ignora este correo.</p>`, "{{tienda.sitio}}");
  const r = await enviarCorreo(env, { para: jug.email_envio || jug.email, asunto: `${codigo} es tu código para jugar · {{tienda.nombre}}`, html, texto: `Tu código para jugar en {{tienda.nombre}}: ${codigo} (vence en 15 minutos).`, clave: `verif-${jug.token}-${Date.now()}` });
  if (r.id) await sumarIntento(env, dia, 86400);
  return r.id ? { ok: true } : { error: "No pudimos enviarte el código. Revisa tu correo e intenta de nuevo." };
}
// Registro obligatorio para jugar: nombre, correo (verificado con un código) y teléfono. Devuelve un token que el navegador guarda.
// ---------- Visitas: contador propio, anónimo y sin cookies ----------
// El visitante se identifica con una huella (IP + navegador + día + secreto) que cambia cada día y no se puede revertir.
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|facebookexternalhit|whatsapp|curl|wget|python|node-fetch|axios|go-http/i;
function origenVisita(ref, utm, host) {
  utm = String(utm || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
  if (utm) return utm;
  let h = ""; try { h = new URL(String(ref || "")).hostname.replace(/^www\./, ""); } catch {}
  if (!h || h === host || h.endsWith("{{tienda.dominio}}") || h.endsWith("{{tienda.proyecto}}.pages.dev")) return "directo";
  const conocidos = [["google", /(^|\.)google\./], ["bing", /(^|\.)bing\.com$/], ["facebook", /(^|\.)(facebook\.com|fb\.com|fb\.me)$/], ["instagram", /(^|\.)instagram\.com$/],
    ["whatsapp", /whatsapp/], ["tiktok", /tiktok\.com$/], ["youtube", /(youtube\.com|youtu\.be)$/], ["mercadopago", /mercadopago|mercadolibre/], ["chatgpt", /chatgpt\.com|openai\.com/], ["yahoo", /yahoo\./], ["duckduckgo", /duckduckgo\.com$/]];
  return (conocidos.find(([, re]) => re.test(h)) || [h.slice(0, 40)])[0];
}
async function registrarVisita(request, env) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOTS.test(ua)) return new Response(null, { status: 204 });
  let b = {}; try { b = await request.json(); } catch {}
  let ruta = String(b.ruta || "/").split(/[?#]/)[0].toLowerCase().slice(0, 90);
  if (!/^\/[a-z0-9\/_.-]*$/.test(ruta) || ruta.startsWith("/admin") || ruta.startsWith("/api")) ruta = "/otra";
  const dia = hoyMX(), host = new URL(request.url).hostname;
  const visitante = (await hashTexto(`visita:${dia}:${ipDe(request)}:${ua}:${env.ADMIN_PASSWORD || ""}`)).slice(0, 20);
  const disp = /ipad|tablet/i.test(ua) ? "tableta" : /mobi|android|iphone/i.test(ua) ? "móvil" : "computadora";
  try {
    const r = await env.DB.prepare(`INSERT INTO visitas (dia, visitante, paginas, origen, disp) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(dia, visitante) DO UPDATE SET paginas = paginas + 1 WHERE paginas < 300 RETURNING paginas`)
      .bind(dia, visitante, origenVisita(b.ref, b.utm, host), disp).first();
    if (r) await env.DB.prepare("INSERT INTO visitas_paginas (dia, ruta, n) VALUES (?, ?, 1) ON CONFLICT(dia, ruta) DO UPDATE SET n = n + 1").bind(dia, ruta).run();
  } catch (e) { console.error("Visita", String(e.message || e)); }
  return new Response(null, { status: 204 });
}
async function resumenVisitas(env, dias) {
  const desde = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(Date.now() - (dias - 1) * 864e5));
  const [porDia, origenes, dispositivos, paginas] = await Promise.all([
    env.DB.prepare("SELECT dia, COUNT(*) AS visitantes, SUM(paginas) AS paginas FROM visitas WHERE dia >= ? GROUP BY dia ORDER BY dia").bind(desde).all(),
    env.DB.prepare("SELECT COALESCE(origen, 'directo') AS nombre, COUNT(*) AS n FROM visitas WHERE dia >= ? GROUP BY 1 ORDER BY n DESC LIMIT 10").bind(desde).all(),
    env.DB.prepare("SELECT COALESCE(disp, '—') AS nombre, COUNT(*) AS n FROM visitas WHERE dia >= ? GROUP BY 1 ORDER BY n DESC").bind(desde).all(),
    env.DB.prepare("SELECT ruta, SUM(n) AS n FROM visitas_paginas WHERE dia >= ? GROUP BY ruta ORDER BY n DESC LIMIT 15").bind(desde).all(),
  ]);
  // Limpieza: se guardan 13 meses
  const viejo = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(Date.now() - 400 * 864e5));
  await env.DB.prepare("DELETE FROM visitas WHERE dia < ?").bind(viejo).run();
  await env.DB.prepare("DELETE FROM visitas_paginas WHERE dia < ?").bind(viejo).run();
  return { desde, hoy: hoyMX(), dias, porDia: porDia.results, origenes: origenes.results, dispositivos: dispositivos.results, paginas: paginas.results };
}
async function juegoRegistro(request, env) {
  let b = {}; try { b = await request.json(); } catch {}
  const nombre = limpiarTexto(b.nombre, 80), emailEnvio = limpiarTexto(b.email, 120).toLowerCase(), tel = limpiarTexto(b.tel, 20).replace(/\D/g, "").slice(-10);
  if (nombre.length < 3) return json({ error: "Escribe tu nombre." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(emailEnvio)) return json({ error: "Revisa tu correo electrónico." }, 400);
  if (DESECHABLES.has(emailEnvio.split("@")[1])) return json({ error: "Usa tu correo personal (no se aceptan correos temporales)." }, 400);
  if (tel.length !== 10) return json({ error: "Escribe un teléfono de 10 dígitos." }, 400);
  if (b.bases !== true) return json({ error: "Debes aceptar las bases de la promoción y el aviso de privacidad." }, 400);
  if (b.promos !== true) return json({ error: "Para participar es necesario aceptar recibir promociones y novedades de {{tienda.nombre}}." }, 400);
  const k = "registro:" + ipDe(request);
  if (await excedido(env, k, 10)) return json({ error: "Demasiados registros desde esta conexión. Intenta más tarde." }, 429);
  await sumarIntento(env, k, 3600);
  const email = correoCanonico(emailEnvio);
  const token = aleatorio(24, "abcdefghijkmnpqrstuvwxyz23456789"), ahora = new Date().toISOString();
  // Si ese correo ya se verificó antes con el mismo teléfono, no hace falta otro código
  const previo = await env.DB.prepare("SELECT 1 FROM jugadores WHERE email = ? AND tel = ? AND verificado = 1 LIMIT 1").bind(email, tel).first();
  await env.DB.prepare("INSERT INTO jugadores (token, nombre, email, email_envio, tel, creado, promos, verificado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(token, nombre, email, emailEnvio, tel, ahora, 1, previo ? 1 : 0).run();
  if (!previo) {
    const r = await enviarCodigoJuego(env, { token, nombre, email, email_envio: emailEnvio }, request);
    if (r.error) { await env.DB.prepare("DELETE FROM jugadores WHERE token = ?").bind(token).run(); return json({ error: r.error }, 503); }
  }
  await modificarDoc(env, "clientes", () => ({}), c => ({ ...c, [emailEnvio]: { ...(c[emailEnvio] || {}), nombre, tel, promos: true, alta: c[emailEnvio]?.alta || ahora, origen: c[emailEnvio]?.origen || "juego" } }));
  return json({ token, nombre, email: emailEnvio, tel, verificado: !!previo });
}
async function juegoVerificar(request, env) {
  let b = {}; try { b = await request.json(); } catch {}
  const jug = await env.DB.prepare("SELECT * FROM jugadores WHERE token = ?").bind(String(b.token || "")).first();
  if (!jug) return json({ error: "Regístrate para jugar.", registro: true }, 401);
  if (jug.verificado) return json({ ok: true });
  if (!jug.codigo_hash || jug.codigo_expira < Date.now()) return json({ error: "El código venció. Pide uno nuevo.", vencido: true }, 400);
  if ((jug.codigo_intentos || 0) >= 5) return json({ error: "Demasiados intentos. Pide un código nuevo.", vencido: true }, 429);
  const codigo = String(b.codigo || "").replace(/\D/g, "");
  if (!igual(await hashTexto("juego:" + jug.token + ":" + codigo), jug.codigo_hash)) {
    await env.DB.prepare("UPDATE jugadores SET codigo_intentos = COALESCE(codigo_intentos, 0) + 1 WHERE token = ?").bind(jug.token).run();
    return json({ error: "El código no coincide. Revisa el correo más reciente." }, 400);
  }
  await env.DB.prepare("UPDATE jugadores SET verificado = 1, codigo_hash = NULL WHERE token = ?").bind(jug.token).run();
  return json({ ok: true });
}
async function juegoReenviar(request, env) {
  let b = {}; try { b = await request.json(); } catch {}
  const jug = await env.DB.prepare("SELECT * FROM jugadores WHERE token = ?").bind(String(b.token || "")).first();
  if (!jug) return json({ error: "Regístrate para jugar.", registro: true }, 401);
  if (jug.verificado) return json({ ok: true, verificado: true });
  const k = "reenvio:" + jug.token, ki = "reenvio-ip:" + ipDe(request);
  if (await excedido(env, k, 3) || await excedido(env, ki, 10)) return json({ error: "Ya te enviamos varios códigos. Espera unos minutos y revisa también spam o promociones." }, 429);
  await sumarIntento(env, k, 900); await sumarIntento(env, ki, 3600);
  const r = await enviarCodigoJuego(env, jug, request);
  return r.error ? json({ error: r.error }, 503) : json({ ok: true });
}
async function juegoInicio(request, env) {
  const cfg = await leerJuego(env);
  if (!cfg.activo) return json({ error: "El juego no está disponible por ahora." }, 404);
  let b = {}; try { b = await request.json(); } catch {}
  const rival = b.rival === "mozart" ? "mozart" : "rey";
  const jug = await env.DB.prepare("SELECT * FROM jugadores WHERE token = ?").bind(String(b.token || "")).first();
  if (!jug) return json({ error: "Regístrate para jugar.", registro: true }, 401);
  if (!jug.verificado) return json({ error: "Confirma tu correo con el código que te enviamos. Recarga la página para escribirlo.", verificar: true }, 403);
  const k = "juego:" + ipDe(request);
  if (await excedido(env, k, 12)) return json({ error: "Se han jugado muchas partidas desde esta conexión hoy. Vuelve mañana." }, 429);
  // Un intento por persona (correo o teléfono) por día. INSERT condicional: dos pestañas a la vez no logran dos partidas.
  const id = "P" + aleatorio(14), semilla = crypto.getRandomValues(new Uint32Array(1))[0], dia = inicioDiaMX();
  const r = await env.DB.prepare(`INSERT INTO partidas (id, semilla, rival, creado, ip, jugador, email, tel)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE (email = ? OR tel = ?) AND creado >= ?) RETURNING id`)
    .bind(id, semilla, rival, Date.now(), ipDe(request), jug.token, jug.email, jug.tel, jug.email, jug.tel, dia).first();
  if (!r) return json({ error: "Ya jugaste hoy. Tienes un intento por día: vuelve mañana por la revancha.", yaJugo: true }, 429);
  await sumarIntento(env, k, 86400);
  return json({ partida: id, semilla, rival });
}
async function crearPremio(env, p, tipo, porcentaje, cfg) {
  const jug = await env.DB.prepare("SELECT nombre FROM jugadores WHERE token = ?").bind(p.jugador).first();
  const codigo = "{{tienda.prefijo}}-" + aleatorio(6), ahora = new Date();
  const vence = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(ahora.getTime() + cfg.vigenciaDias * 864e5));
  await env.DB.prepare("INSERT INTO premios (codigo, partida, rival, nombre, email, tel, porcentaje, tope, creado, vence, tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(codigo, p.id, p.rival, jug?.nombre || "", p.email, p.tel, porcentaje, cfg.tope, ahora.toISOString(), vence, tipo).run();
  return { codigo, tipo, porcentaje, tope: cfg.tope, vence };
}
async function juegoFin(request, env) {
  let b = {}; try { b = await request.json(); } catch {}
  const p = await env.DB.prepare("SELECT * FROM partidas WHERE id = ?").bind(String(b.partida || "")).first();
  if (!p) return json({ error: "Partida no encontrada." }, 404);
  if (p.resultado) return json({ error: "Esta partida ya terminó." }, 409);
  if (!Array.isArray(b.entradas) || b.entradas.length > 200000) return json({ error: "Datos de la partida inválidos." }, 400);
  const rep = MOTOR.repetir(p.semilla, p.rival, b.entradas);
  if (rep.error || !rep.fin) return json({ error: "No pudimos verificar tu partida." }, 400);
  // No se puede terminar más rápido de lo que dura realmente la partida
  const segundosReales = (Date.now() - p.creado) / 1000;
  // Ninguna partida (ganada o perdida) puede terminar antes de lo que dura en tiempo real: evita mandar partidas simuladas
  const masRapida = rep.pasos / MOTOR.HZ > segundosReales + 3;
  const sospechosa = masRapida || (rep.fin === "ganaste" && (rep.muestras < 5 || rep.reaccionMediana < 6));
  const resultado = sospechosa ? "revision" : rep.fin === "perdiste" ? "perdida" : "ganada";
  const marcador = `${rep.gj}-${rep.gc}`;   // juegos
  const r = await env.DB.prepare("UPDATE partidas SET resultado = ?, marcador = ? WHERE id = ? AND resultado IS NULL RETURNING id").bind(resultado, marcador, p.id).first();
  if (!r) return json({ error: "Esta partida ya terminó." }, 409);
  const cfg = await leerJuego(env);
  let premio = null, aviso = null;
  if (cfg.activo && p.email) {
    if (resultado === "ganada") {
      const hoy = (await env.DB.prepare("SELECT COUNT(*) AS n FROM premios WHERE tipo = 'ganador' AND creado >= ?").bind(new Date(inicioDiaMX()).toISOString()).first()).n;
      if (hoy < cfg.maxDia) premio = await crearPremio(env, p, "ganador", cfg.porcentaje, cfg);
      else aviso = "¡Ganaste! Pero hoy ya se entregaron todos los premios del día. Vuelve mañana por el tuyo.";
    } else if (resultado === "perdida" && cfg.consuelo > 0) {
      // Premio de consolación: solo la primera vez que la persona pierde (por correo o teléfono)
      const ya = await env.DB.prepare("SELECT 1 FROM premios WHERE tipo = 'consuelo' AND (email = ? OR tel = ?) LIMIT 1").bind(p.email, p.tel).first();
      // Topes: consolaciones por día en toda la tienda y por conexión (frena registros con datos inventados)
      const desde = new Date(inicioDiaMX()).toISOString();
      const { total, mismaIp } = await env.DB.prepare(`SELECT COUNT(*) AS total, SUM(pa.ip = ?) AS mismaIp FROM premios pr JOIN partidas pa ON pa.id = pr.partida
        WHERE pr.tipo = 'consuelo' AND pr.creado >= ?`).bind(p.ip, desde).first();
      if (!ya && total < cfg.maxConsueloDia && (mismaIp || 0) < 2) premio = await crearPremio(env, p, "consuelo", cfg.consuelo, cfg);
    }
  }
  return json({ resultado, marcador, premio, aviso });
}
// Premio del juego: descuento sobre UNA pieza (la de mayor precio del carrito), con tope opcional
async function leerPremio(env, codigo) {
  if (!/^{{tienda.prefijo}}-[A-Z0-9]{6}$/.test(codigo || "")) return null;
  const p = await env.DB.prepare("SELECT * FROM premios WHERE codigo = ?").bind(codigo).first();
  if (!p) return null;
  if (p.usado) return { error: "Este código de premio ya se usó." };
  if (hoyMX() > p.vence) return { error: "Este código de premio ya venció." };
  return p;
}
const descuentoPremio = (premio, lineas) => {
  const mayor = Math.max(0, ...lineas.map(l => l.precio));
  const d = Math.round(mayor * premio.porcentaje) / 100;
  return redondear2(premio.tope ? Math.min(premio.tope, d) : d);
};

// ---------- Sesión de administrador ----------
const enc = new TextEncoder();
async function clave(env) {
  return crypto.subtle.importKey("raw", enc.encode("{{tienda.clave}}-sesion:" + env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
async function firmar(env, datos) { return hex(await crypto.subtle.sign("HMAC", await clave(env), enc.encode(datos))); }
function igual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// La sesión tiene dos niveles: "c" = completa; "a" = solo para dar de alta la verificación en 2 pasos (30 min)
async function sesionValida(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)qp_admin=(\d+)\.([ca])\.([0-9a-f]{64})/);
  if (!m || Number(m[1]) < Date.now()) return false;
  return igual(m[3], await firmar(env, `sesion:${m[1]}:${m[2]}`)) ? m[2] : false;
}
async function cookieSesion(env, nivel) {
  const seg = nivel === "c" ? SESION_HORAS * 3600 : 30 * 60, exp = Date.now() + seg * 1000;
  return `qp_admin=${exp}.${nivel}.${await firmar(env, `sesion:${exp}:${nivel}`)}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${seg}`;
}
function mismoOrigen(request, url) {
  const o = request.headers.get("origin");
  return o === url.origin;
}

// ---------- Verificación en 2 pasos (TOTP, RFC 6238: código de 6 dígitos que cambia cada 30 s) ----------
// Se guarda en D1 (documento "admin-2fa"). Si pierdes el celular y los códigos de recuperación, borra esa fila
// desde Cloudflare (D1 → {{tienda.proyecto}}-db → datos → clave = admin-2fa) y vuelve a darla de alta.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function aBase32(bytes) { let bits = 0, val = 0, out = ""; for (const b of bytes) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function deBase32(t) { let bits = 0, val = 0; const out = []; for (const c of t.replace(/=+$/, "")) { const n = B32.indexOf(c); if (n < 0) continue; val = ((val << 5) | n) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
async function codigoTotp(secreto, paso) {
  const k = await crypto.subtle.importKey("raw", deBase32(secreto), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const m = new Uint8Array(8); let x = paso; for (let i = 7; i >= 0; i--) { m[i] = x & 255; x = Math.floor(x / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", k, m)), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const pasoActual = () => Math.floor(Date.now() / 30000);
// Devuelve el paso que coincidió (acepta ±30 s de desfase del reloj del celular) o null
async function pasoValido(secreto, codigo, minimo = -1) {
  if (!/^\d{6}$/.test(codigo)) return null;
  const t = pasoActual();
  for (const p of [t, t - 1, t + 1]) if (p > minimo && igual(await codigoTotp(secreto, p), codigo)) return p;
  return null;
}
const hashTexto = async t => hex(await crypto.subtle.digest("SHA-256", enc.encode("{{tienda.clave}}-rec:" + t)));
const limpiarCodigo = c => String(c || "").toUpperCase().replace(/[\s-]/g, "");
async function nuevosCodigosRecuperacion() {
  const codigos = Array.from({ length: 8 }, () => { const a = aleatorio(8); return a.slice(0, 4) + "-" + a.slice(4); });
  return { codigos, hashes: await Promise.all(codigos.map(c => hashTexto(limpiarCodigo(c)))) };
}
// Verifica un código de la app (una sola vez cada uno: no se puede reutilizar) o un código de recuperación (se consume)
async function verificarSegundoPaso(env, codigo) {
  const c = limpiarCodigo(codigo); let ok = false;
  await modificarDoc(env, "admin-2fa", () => null, async d => {
    ok = false;
    if (!d?.activo) return undefined;
    const p = await pasoValido(d.secreto, c, d.ultimoPaso ?? -1);
    if (p != null) { ok = true; return { ...d, ultimoPaso: p }; }
    if (/^[A-Z0-9]{8}$/.test(c)) {
      const h = await hashTexto(c);
      if (d.recuperacion?.includes(h)) { ok = true; return { ...d, recuperacion: d.recuperacion.filter(x => x !== h) }; }
    }
    return undefined;
  });
  return ok;
}

async function login(request, env, ctx) {
  if (!env.ADMIN_PASSWORD) return json({ error: "Falta configurar la contraseña ADMIN_PASSWORD en Cloudflare." }, 503);
  const k = "login:" + ipDe(request);
  if (await excedido(env, k, 8)) return json({ error: "Demasiados intentos. Espera 15 minutos." }, 429);
  let b = {}; try { b = await request.json(); } catch {}
  const pwd = String(b.password || "");
  const ok = igual(await firmar(env, "pwd:" + pwd), await firmar(env, "pwd:" + env.ADMIN_PASSWORD));
  const fallo = async () => { await sumarIntento(env, k, 900); await sumarIntento(env, "panel-fallidos:" + new Date().toISOString().slice(0, 13), 7200); };
  if (!ok) {
    await fallo();
    return json({ error: "Contraseña incorrecta." }, 401);
  }
  const dosPasos = (await leerDoc(env, "admin-2fa"))?.valor;
  if (dosPasos?.activo) {
    if (!b.codigo) return json({ requiere2fa: true });                       // contraseña correcta: ahora pide el código
    if (!(await verificarSegundoPaso(env, b.codigo))) {
      await fallo();
      return json({ error: "Código incorrecto o ya usado. Espera al siguiente código de tu app.", requiere2fa: true }, 401);
    }
  }
  await env.DB.prepare("DELETE FROM intentos WHERE clave = ?").bind(k).run(); MEMORIA_INTENTOS.delete(k);
  // Correo de aviso en cada acceso (sin retrasar la respuesta)
  const aviso = avisoAccesoPanel(env, request, dosPasos?.activo ? "acceso" : "alta").catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(aviso); else await aviso;
  // Sin verificación en 2 pasos todavía: sesión limitada que solo permite darla de alta
  return json({ ok: true, alta2fa: !dosPasos?.activo }, 200, { "set-cookie": await cookieSesion(env, dosPasos?.activo ? "c" : "a") });
}
// Alta / cambio de celular / códigos de recuperación
async function rutas2fa(request, env, ruta, nivel) {
  let b = {}; if (request.method === "POST") { try { b = await request.json(); } catch {} }
  const doc = (await leerDoc(env, "admin-2fa"))?.valor || null;
  if (ruta === "/2fa/estado" && request.method === "GET")
    return json({ activo: !!doc?.activo, desde: doc?.desde || null, recuperacionRestantes: doc?.recuperacion?.length ?? 0 });
  if (ruta === "/2fa/iniciar" && request.method === "POST") {
    // Cambiar de celular estando activa: exige un código actual (o de recuperación)
    if (doc?.activo && !(await verificarSegundoPaso(env, b.codigo))) return json({ error: "Para cambiar de celular escribe un código actual de tu app (o uno de recuperación)." }, 401);
    const secreto = aBase32(crypto.getRandomValues(new Uint8Array(20)));
    await modificarDoc(env, "admin-2fa", () => ({}), d => ({ ...(d || {}), pendiente: secreto, pendienteHasta: Date.now() + 15 * 60e3 }));
    const etiqueta = encodeURIComponent("{{tienda.clave}}:admin");
    return json({ secreto, uri: `otpauth://totp/${etiqueta}?secret=${secreto}&issuer={{tienda.nombre}}&algorithm=SHA1&digits=6&period=30` });
  }
  if (ruta === "/2fa/confirmar" && request.method === "POST") {
    if (!doc?.pendiente || doc.pendienteHasta < Date.now()) return json({ error: "El alta expiró. Vuelve a generar el código QR." }, 400);
    const p = await pasoValido(doc.pendiente, limpiarCodigo(b.codigo));
    if (p == null) return json({ error: "El código no coincide. Revisa que la hora de tu celular sea automática y escribe el código que aparece ahora." }, 400);
    const { codigos, hashes } = await nuevosCodigosRecuperacion();
    await modificarDoc(env, "admin-2fa", () => ({}), d => ({ activo: true, secreto: d.pendiente, ultimoPaso: p, recuperacion: hashes, desde: new Date().toISOString() }));
    return json({ ok: true, recuperacion: codigos }, 200, { "set-cookie": await cookieSesion(env, "c") });
  }
  if (ruta === "/2fa/recuperacion" && request.method === "POST") {
    if (nivel !== "c" || !doc?.activo) return json({ error: "No disponible." }, 403);
    if (!(await verificarSegundoPaso(env, b.codigo))) return json({ error: "Código incorrecto o ya usado." }, 401);
    const { codigos, hashes } = await nuevosCodigosRecuperacion();
    await modificarDoc(env, "admin-2fa", () => ({}), d => ({ ...d, recuperacion: hashes }));
    return json({ ok: true, recuperacion: codigos });
  }
  return json({ error: "No encontrado." }, 404);
}

async function descargarFotos(env, ids) {
  const cat = await leerCatalogo(env);
  const mapa = new Map(cat.productos.map(p => [p.id, p]));
  const resultados = [];
  for (const id of ids.slice(0, 8)) {        // plan gratuito: máx. 50 subpeticiones por invocación
    const p = mapa.get(id);
    if (!p?.imagenOrigen) { resultados.push({ id, error: "sin URL de foto" }); continue; }
    try {
      const r = await fetch(p.imagenOrigen, { redirect: "follow", signal: AbortSignal.timeout(10000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; {{tienda.clave}}-catalogo/1.0)", accept: "image/avif,image/webp,image/png,image/jpeg,image/*" } });
      if (!r.ok) throw new Error(`el servidor de la foto respondió ${r.status}`);
      const tipo = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!TIPOS_IMAGEN_PROVEEDOR.test(tipo)) throw new Error(`no es una imagen (${tipo || "sin tipo"})`);
      const datos = await r.arrayBuffer();
      if (datos.byteLength > MAX_IMAGEN_PROVEEDOR) throw new Error("la foto pesa más de 4 MB");
      await env.CATALOGO.put("img:" + id, datos, { metadata: { tipo } });
      resultados.push({ id, ok: true, kb: Math.round(datos.byteLength / 1024), imagen: `/media/${id}?v=${Date.now()}`, origen: p.imagenOrigen });
    } catch (e) {
      resultados.push({ id, error: e.name === "TimeoutError" ? "tardó demasiado en responder" : String(e.message || e).slice(0, 160) });
    }
  }
  const listas = resultados.filter(x => x.ok);
  if (listas.length) await modificarDoc(env, "catalogo", () => ({ productos: CATALOGO_INICIAL }), c => {
    for (const x of listas) { const p = c.productos.find(q => q.id === x.id); if (p && p.imagenOrigen === x.origen) { p.imagen = x.imagen; p.fotoDe = x.origen; } }
    return c;
  });
  return resultados.map(({ imagen, origen, ...x }) => x);
}

async function api(request, env, url, ctx) {
  const ruta = url.pathname.replace(/^\/admin\/api/, "");
  if (!env.DB || !env.CATALOGO) return json({ error: "Falta vincular la base de datos (DB) o el almacenamiento de fotos (CATALOGO)." }, 503);
  if (request.method !== "GET" && !mismoOrigen(request, url)) return json({ error: "Origen no permitido." }, 403);

  if (ruta === "/login" && request.method === "POST") return login(request, env, ctx);
  if (ruta === "/sesion" && request.method === "GET") {
    const nivel = await sesionValida(request, env);
    return json({ sesion: nivel === "c", alta2fa: nivel === "a", configurado: !!env.ADMIN_PASSWORD });
  }
  if (ruta === "/logout" && request.method === "POST")
    return json({ ok: true }, 200, { "set-cookie": "qp_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

  const nivel = await sesionValida(request, env);
  if (!nivel) return json({ error: "Sesión expirada. Vuelve a entrar." }, 401);
  if (ruta.startsWith("/2fa/")) return rutas2fa(request, env, ruta, nivel);
  if (nivel !== "c") return json({ error: "Activa la verificación en 2 pasos para usar el panel.", alta2fa: true }, 403);

  if (ruta === "/catalogo" && request.method === "GET") {
    const cat = await leerCatalogo(env);
    const lista = await env.CATALOGO.list({ prefix: "img:" });
    return json({
      ...cat,
      imagenes: lista.keys.map(k => k.name.slice(4)),
      estaticas: Object.keys(ESTATICOS).filter(k => k.startsWith("/img/productos/")).map(k => k.slice(1)),
    });
  }
  if (ruta === "/catalogo" && request.method === "PUT") {
    let cuerpo;
    try { cuerpo = await request.json(); } catch { return json({ error: "JSON inválido." }, 400); }
    let productos;
    try { productos = validarProductos(cuerpo.productos); } catch (e) { return json({ error: e.message }, 400); }
    if (!Number.isInteger(cuerpo.version)) return json({ error: "Falta la versión del catálogo; recarga el panel." }, 400);
    const actual = await leerCatalogoBase(env);
    productos = productos.map(({ costoReal, ...p }) => p);   // el costo real vive en el almacén
    const nuevo = { productos, actualizado: new Date().toISOString() };
    const v = await escribirDoc(env, "catalogo", nuevo, cuerpo.version);
    // Otro cambio (p. ej. una venta que descontó existencias) entró después de que abriste el panel
    if (v == null) return json({ error: "El catálogo cambió mientras editabas (por ejemplo, entró una venta). Lo recargamos con los datos al día: revisa y vuelve a guardar.", conflicto: true }, 409);
    if (actual.version) await escribirDoc(env, "catalogo:anterior", { productos: actual.productos, actualizado: actual.actualizado });
    // Existencias que editaste a mano (o «actualizar existencias con este CSV»): solo esas cambian en el almacén
    const conflictos = Array.isArray(cuerpo.existencias) && cuerpo.existencias.length ? await fijarExistencias(env, cuerpo.existencias.slice(0, 5000), productos) : [];
    return json({ ok: true, existenciasConflicto: conflictos, total: productos.length, visibles: productos.filter(visible).length, actualizado: nuevo.actualizado, version: v });
  }
  if (ruta === "/catalogo/deshacer" && request.method === "POST") {
    let cuerpo = {}; try { cuerpo = await request.json(); } catch {}
    const anterior = await leerDoc(env, "catalogo:anterior");
    if (!anterior) return json({ error: "No hay una versión anterior guardada." }, 404);
    const actual = await leerCatalogoBase(env);
    if (Number.isInteger(cuerpo.version) && cuerpo.version !== actual.version) return json({ error: "El catálogo cambió (por ejemplo, entró una venta). Recarga antes de deshacer.", conflicto: true }, 409);
    if ((await escribirDoc(env, "catalogo", { ...anterior.valor, actualizado: new Date().toISOString() }, actual.version)) == null) return json({ error: "El catálogo cambió en este momento; intenta de nuevo.", conflicto: true }, 409);
    await escribirDoc(env, "catalogo:anterior", { productos: actual.productos, actualizado: actual.actualizado });
    return json({ ok: true });
  }
  if (ruta === "/fotos" && request.method === "POST") {
    let ids = [];
    try { ids = (await request.json()).ids; } catch {}
    if (!Array.isArray(ids) || !ids.every(x => typeof x === "string")) return json({ error: "Formato inválido." }, 400);
    return json({ resultados: await descargarFotos(env, ids) });
  }
  // Sincronización con el proveedor (también corre sola a la 1 p. m.)
  // Módulos apagados: sus apartados del panel no existen
  const apagado = [["/proveedor", "proveedor"], ["/ficha/buscar", "fichas"], ["/ficha/ia", "fichas"], ["/envios/", "envios"], ["/resenas", "resenas"], ["/compras", "compras"]]
    .find(([r, m]) => ruta.startsWith(r) && !MODULOS[m]);
  if (apagado || (ruta === "/juego" && request.method !== "GET" && !MODULOS.juego)) return json({ error: "Este apartado no está activo en tu tienda." }, 404);
  if (ruta === "/proveedor" && request.method === "GET") return json({ estado: (await leerDoc(env, "proveedor-estado"))?.valor || null, horas: PROVEEDOR.horas, proveedor: PROVEEDOR.base });
  if (ruta === "/proveedor/sincronizar" && request.method === "POST") return json(await sincronizarProveedor(env, { motivo: "manual" }));
  if (ruta === "/proveedor/revisar" && request.method === "POST") {
    let b = {}; try { b = await request.json(); } catch {}
    if (!Array.isArray(b.ids) || !b.ids.every(x => typeof x === "string")) return json({ error: "Formato inválido." }, 400);
    return json({ ok: true, n: await aplicarRevisionProveedor(env, b.ids.slice(0, 500), b.aplicar === true) });
  }
  if (ruta === "/descripciones" && request.method === "PUT") {
    let nuevas;
    try { nuevas = (await request.json()).descripciones; } catch {}
    if (!nuevas || typeof nuevas !== "object") return json({ error: "Formato inválido." }, 400);
    const todas = await modificarDoc(env, "descripciones", () => ({}), d => {
      for (const [id, t] of Object.entries(nuevas)) if (/^[a-z0-9-]{1,80}$/.test(id)) { const v = texto(t, 6000); if (v) d[id] = v; else delete d[id]; }
      return d;
    });
    return json({ ok: true, total: Object.keys(todas).length });
  }
  if (ruta === "/precios" && request.method === "GET") return json({ config: await leerConfig(env), tc: await tipoCambio(env), banxico: !!env.BANXICO_TOKEN });
  if (ruta === "/precios/actualizar" && request.method === "POST") return json({ tc: await tipoCambio(env, true), banxico: !!env.BANXICO_TOKEN });
  if (ruta === "/config" && request.method === "PUT") {
    let c = {};
    try { c = await request.json(); } catch {}
    const factor = Number(c.factor), iva = Number(c.iva), tcManual = c.tcManual == null || c.tcManual === "" ? null : Number(c.tcManual);
    if (!(factor >= 1 && factor <= 5)) return json({ error: "El factor debe estar entre 1 y 5." }, 400);
    if (!(iva >= 0 && iva <= 30)) return json({ error: "El IVA debe estar entre 0 y 30 %." }, 400);
    if (tcManual !== null && !(tcManual > 5 && tcManual < 100)) return json({ error: "El tipo de cambio manual debe estar entre 5 y 100." }, 400);
    const config = { factor: Math.round(factor * 1000) / 1000, iva: Math.round(iva * 100) / 100, tcManual, modo: c.modo === "costo" ? "costo" : "factor" };
    if (c.costo && typeof c.costo === "object") {
      const n = (v, min, max) => { const x = Number(v); if (!(x >= min && x <= max)) throw new Error(`Valor fuera de rango (${min}–${max}).`); return Math.round(x * 100) / 100; };
      const porCat = (o, min, max) => Object.fromEntries(CATEGORIAS.map(k => [k, n(o?.[k] ?? PRECIO_COSTO_INICIAL.envProv[k], min, max)]));
      try {
        config.costo = { envProv: porCat(c.costo.envProv, 0, 500), envMx: porCat(c.costo.envMx, 0, 5000), envMtyGdl: porCat(c.costo.envMtyGdl, 0, 3000), envCliente: porCat(c.costo.envCliente, 0, 3000),
          cruce: n(c.costo.cruce, 0, 60), aduana: n(c.costo.aduana, 0, 60), aduanaDesdeUsd: n(c.costo.aduanaDesdeUsd, 0, 100000), usdPorEur: n(c.costo.usdPorEur, .5, 2),
          comisionMP: n(c.costo.comisionMP, 0, 15), margen: n(c.costo.margen, 0, 300), margenMin: n(c.costo.margenMin, 0, 20000), margenMinCaro: n(c.costo.margenMinCaro, 0, 50000),
          umbralCaro: n(c.costo.umbralCaro, 0, 200000), envioGratisDesde: n(c.costo.envioGratisDesde, 0, 100000), envioCliente: n(c.costo.envioCliente, 0, 5000),
          cajaImport: { largo: n(c.costo.cajaImport?.largo ?? 61, 1, 300), ancho: n(c.costo.cajaImport?.ancho ?? 31, 1, 300), alto: n(c.costo.cajaImport?.alto ?? 39, 1, 300), peso: n(c.costo.cajaImport?.peso ?? 3, .1, 70) } };
      } catch (e) { return json({ error: e.message }, 400); }
    } else if (c.modo === "costo") config.costo = (await leerConfig(env)).costo || PRECIO_COSTO_INICIAL;
    await escribirDoc(env, "config", config);
    return json({ ok: true, config });
  }
  if (ruta.startsWith("/envios/")) return apiEnvios(request, env, url, ruta, ctx);
  if (ruta === "/resenas" || ruta.startsWith("/resenas/")) return apiResenas(request, env, ruta);
  if (ruta.startsWith("/ficha/")) return apiFicha(request, env, ruta, url);
  if (ruta === "/compras" || ruta.startsWith("/compras/")) { try { return await apiCompras(request, env, ruta, url); } catch (e) { return json({ error: String(e.message || e).slice(0, 200) }, 400); } }
  if (ruta === "/pedidos" && request.method === "GET") {
    // Actualiza el rastreo de los pedidos enviados en segundo plano (como mucho cada 30 min)
    if (env.ENVIOSPERROS_TOKEN && ctx?.waitUntil) ctx.waitUntil((async () => {
      const k = "envios-sync";
      if (await excedido(env, k, 1)) return; await sumarIntento(env, k, 1800);
      await sincronizarEnvios(env, url.hostname, 10);
    })().catch(e => console.error("Sincronizar envíos", String(e.message || e))));
    const { results } = await env.DB.prepare("SELECT id, creado, estado, total, nombre, email, piezas, con_pedido AS conPedido, alerta FROM pedidos ORDER BY creado DESC LIMIT 1000").all();
    return json({ pedidos: results.map(x => ({ ...x, conPedido: !!x.conPedido, alerta: !!x.alerta })), pagos: !!env.MP_ACCESS_TOKEN, prueba: modoPruebaMP(env, url) });
  }
  if (ruta === "/pedido" && request.method === "GET") { const p = await leerPedido(env, url.searchParams.get("id")); return p ? json({ pedido: p }) : json({ error: "No encontrado." }, 404); }
  if (ruta === "/pedido" && request.method === "PATCH") {
    let b = {}; try { b = await request.json(); } catch {}
    const permitidos = { enviado: ["pagado"], entregado: ["enviado"], cancelado: ["pendiente_pago", "pago_pendiente", "rechazado", "pagado"] };
    let error = null;
    const p = await modificarPedido(env, b.id, p => {
      if (!permitidos[b.estado]?.includes(p.estado)) { error = `No se puede pasar de "${ESTADO_PEDIDO[p.estado]}" a "${ESTADO_PEDIDO[b.estado] || b.estado}".`; return false; }
      if (b.estado === "enviado") { p.guia = texto(b.guia || "", 60); p.paqueteria = texto(b.paqueteria || "", 40); }
      p.estado = b.estado;
      if (b.estado !== "cancelado") p.alerta = false;
      p.historial.push({ fecha: new Date().toISOString(), estado: b.estado, nota: texto(b.nota || (b.estado === "enviado" ? `Guía ${p.paqueteria} ${p.guia}` : "Cambio manual"), 200) });
    });
    if (!p) return json({ error: "No encontrado." }, 404);
    if (error) return json({ error }, 400);
    if (b.estado === "cancelado") await devolverExistencias(env, p.id);
    let correo = null;
    if (b.estado === "enviado") {
      const r = await correoEnviado(env, p);
      correo = r.id ? "enviado" : (r.error || r.omitido);
      await modificarPedido(env, p.id, q => { q.historial.push({ fecha: new Date().toISOString(), estado: q.estado, nota: r.id ? `✉️ Correo de envío (guía) enviado a ${q.cliente.email}` : `⚠️ No se envió el correo de envío (${correo})` }); });
    }
    return json({ ok: true, pedido: p, correo });
  }
  if (ruta === "/visitas" && request.method === "GET") {
    const dias = Math.min(Math.max(Number(url.searchParams.get("dias")) || 30, 7), 365);
    try { return json(await resumenVisitas(env, dias)); }
    catch (e) { return json({ error: "No se pudieron leer las visitas: " + String(e.message || e).slice(0, 160) }, 500); }
  }
  if (ruta === "/respaldos" && request.method === "GET") {
    const lista = await env.CATALOGO.list({ prefix: "respaldo:" });
    const tareas = (await leerDoc(env, "tareas-estado"))?.valor || {};
    return json({ respaldos: lista.keys.map(k => ({ fecha: k.name.slice(9), ...(k.metadata || {}) })).sort((a, b) => b.fecha.localeCompare(a.fecha)), ultimaEjecucion: tareas.ultimaEjecucion || null, reloj: !!env.TAREAS_TOKEN });
  }
  if (ruta === "/respaldo" && request.method === "GET") {
    const fecha = url.searchParams.get("fecha") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: "Fecha inválida." }, 400);
    const r = await env.CATALOGO.get("respaldo:" + fecha);
    if (!r) return json({ error: "No existe ese respaldo." }, 404);
    return new Response(r, { headers: { ...SEGURIDAD, "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="{{tienda.clave}}-respaldo-${fecha}.json"`, "cache-control": "no-store" } });
  }
  if (ruta === "/respaldo/ahora" && request.method === "POST") {
    try { const r = await hacerRespaldo(env); await modificarDoc(env, "tareas-estado", () => ({}), d => ({ ...d, respaldo: { ...r, creado: new Date().toISOString() } })); return json({ ok: true, ...r }); }
    catch (e) { return json({ error: "No se pudo hacer el respaldo: " + String(e.message || e).slice(0, 200) }, 500); }
  }
  if (ruta === "/pedido/reembolso" && request.method === "POST") {
    let b = {}; try { b = await request.json(); } catch {}
    const p = await leerPedido(env, b.id);
    if (!p) return json({ error: "No encontrado." }, 404);
    if (!["pagado", "enviado", "entregado", "cancelado"].includes(p.estado) || p.mp?.estadoMP === "refunded") return json({ error: "Este pedido no tiene un pago aprobado para reembolsar." }, 400);
    const r = await reembolsarMP(env, p);
    if (r.error) {
      await modificarPedido(env, p.id, q => { q.historial.push({ fecha: new Date().toISOString(), estado: q.estado, nota: `⚠️ No se pudo reembolsar: ${r.error}` }); });
      return json({ error: r.error }, 502);
    }
    await modificarPedido(env, p.id, q => {
      q.estado = "reembolsado"; q.alerta = false; q.mp = { ...q.mp, estadoMP: "refunded" };
      q.historial.push({ fecha: new Date().toISOString(), estado: "reembolsado", nota: `💸 Reembolso total solicitado desde el panel (${pesos(r.monto ?? p.total)}, reembolso MP ${r.id})` });
    });
    await devolverExistencias(env, p.id);
    return json({ ok: true, pedido: await leerPedido(env, p.id) });
  }
  if (ruta === "/pedido/correo" && request.method === "POST") {
    let b = {}; try { b = await request.json(); } catch {}
    const p = await leerPedido(env, b.id);
    if (!p) return json({ error: "No encontrado." }, 404);
    if (!["pagado", "enviado", "entregado"].includes(p.estado)) return json({ error: "Solo se reenvía la confirmación de pedidos pagados." }, 400);
    const r = b.tipo === "enviado" && p.guia ? await correoEnviado(env, p, true) : await correoConfirmacion(env, p, true);
    if (!r.id) return json({ error: r.error || "Falta configurar RESEND_API_KEY en Cloudflare." }, 502);
    await modificarPedido(env, p.id, q => { q.historial.push({ fecha: new Date().toISOString(), estado: q.estado, nota: `✉️ Correo ${b.tipo === "enviado" ? "de envío" : "de confirmación"} reenviado a ${q.cliente.email}` }); });
    return json({ ok: true });
  }
  if (ruta === "/juego" && request.method === "GET") {
    const inicioDia = Date.parse(hoyMX() + "T00:00:00-06:00");
    const est = await env.DB.prepare("SELECT COUNT(*) AS jugadas, SUM(resultado IN ('ganada','reclamada')) AS ganadas, SUM(resultado = 'revision') AS revision FROM partidas WHERE creado >= ?").bind(inicioDia - 6 * 864e5).first();
    const { results } = await env.DB.prepare("SELECT codigo, rival, nombre, email, tel, porcentaje, tope, creado, vence, usado, tipo FROM premios ORDER BY creado DESC LIMIT 200").all();
    return json({ config: await leerJuego(env), semana: est, premios: results });
  }
  if (ruta === "/juego" && request.method === "PUT") {
    let c = {}; try { c = await request.json(); } catch {}
    const n = (v, a, b) => { const x = Number(v); return Number.isFinite(x) && x >= a && x <= b ? x : null; };
    const cfg = { activo: c.activo === true, porcentaje: n(c.porcentaje, 1, 90), tope: c.tope === null || c.tope === "" ? null : n(c.tope, 1, 100000),
      consuelo: n(c.consuelo, 0, 90), maxDia: n(c.maxDia, 0, 100), maxConsueloDia: n(c.maxConsueloDia, 0, 500), vigenciaDias: n(c.vigenciaDias, 1, 60) };
    if (Object.entries(cfg).some(([k, v]) => v === null && k !== "tope") || (c.tope !== null && c.tope !== "" && cfg.tope === null)) return json({ error: "Revisa los valores: premio 1–90 %, consolación 0–90 %, tope en pesos, premios por día 0–100, consolaciones por día 0–500, vigencia 1–60 días." }, 400);
    await escribirDoc(env, "juego-config", cfg);
    return json({ ok: true, config: cfg });
  }
  if (ruta === "/clientes" && request.method === "GET") return json({ clientes: (await leerDoc(env, "clientes"))?.valor || {} });
  if (ruta === "/cupones" && request.method === "GET") return json({ cupones: await leerCupones(env) });
  if (ruta === "/cupones" && request.method === "PUT") {
    let cupones;
    try { cupones = validarCupones((await request.json()).cupones); } catch (e) { return json({ error: e.message }, 400); }
    await escribirDoc(env, "cupones", cupones);
    return json({ ok: true, cupones });
  }
  if (ruta === "/imagen" && request.method === "POST") {
    const id = (url.searchParams.get("id") || "").toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(id)) return json({ error: "id inválido." }, 400);
    const tipo = (request.headers.get("content-type") || "").split(";")[0];
    if (!TIPOS_IMAGEN.includes(tipo)) return json({ error: "Formato no permitido (usa JPG, PNG o WEBP)." }, 415);
    const datos = await request.arrayBuffer();
    if (datos.byteLength > MAX_IMAGEN) return json({ error: "La imagen pesa más de 2 MB." }, 413);
    await env.CATALOGO.put("img:" + id, datos, { metadata: { tipo } });
    return json({ ok: true, url: `/media/${id}?v=${Date.now()}` });
  }
  return json({ error: "No encontrado." }, 404);
}

__SEO__
__TAREAS__
__ENVIOS__
__RESENAS__
__FICHA__
__COMPRAS__
__PROVEEDOR__

let PAGINA = { clave: null, html: "", productos: [], agotados: [], actualizado: null };
let DESCRIPCIONES_MEMO = { version: null, valor: {} };
// Página base (con el catálogo) en memoria: solo se regenera si cambió el catálogo, la configuración o el tipo de cambio
// (ahorra CPU: el plan gratuito de Cloudflare da 10 ms por visita).
// Mismo texto que pinta la tienda (textoPremio en index.html), para que el banner llegue completo y no mueva la página
const textoPremioJuego = j => `Gánale un partido a 4 juegos y llévate <b>${j.porcentaje}&nbsp;% de descuento</b> en el artículo que quieras${j.tope ? ` (hasta ${pesos(j.tope)})` : ""}.${j.consuelo ? ` Si pierdes tu primera partida, te llevas <b>${j.consuelo}&nbsp;%</b> de consolación.` : ""} Gratis, con registro y un intento al día.`;
async function paginaBase(env, ctx) {
  const [version, config, tc, juego] = await Promise.all([versionCatalogo(env), leerConfig(env), tipoCambio(env, false, ctx), leerJuego(env)]);
  const tcEf = config.tcManual || tc?.valor || null;
  const juegoPublico = JSON.stringify({ activo: juego.activo, porcentaje: juego.porcentaje, consuelo: juego.consuelo, tope: juego.tope });
  const clave = `${version}|${config.factor}|${config.iva}|${tcEf}|${config.modo}|${config.modo === "costo" ? JSON.stringify(config.costo) : ""}|${juegoPublico}`;
  if (PAGINA.clave !== clave) {
    const cat = await leerCatalogo(env);
    const tienda = cat.productos.filter(visible).map(p => paraTienda(p, tcEf, config));
    let h = paginaPublica(cat.productos, tcEf, config, tienda).replace("/*JUEGO_CONFIG*/", "const JUEGO = " + juegoPublico + ";");
    if (juego.activo) h = h.replace('<section class="contenedor reto" id="reto" hidden>', '<section class="contenedor reto" id="reto">').replace('<p id="reto-premio"></p>', `<p id="reto-premio">${textoPremioJuego(juego)}</p>`);
    // Agotadas en el proveedor (sin piezas tuyas): su página sigue publicada como «Agotada por ahora» para no perder su lugar en Google
    const agotados = cat.productos.filter(p => p.agotadoProveedor && p.disponible !== false && !visible(p)).map(p => paraTienda(p, tcEf, config));
    PAGINA = { clave, html: h, productos: tienda, agotados, actualizado: cat.actualizado };
  }
  return PAGINA;
}
async function descripcionesMemo(env) {
  const d = await leerDoc(env, "descripciones");
  if (!d) return {};
  if (DESCRIPCIONES_MEMO.version !== d.version) DESCRIPCIONES_MEMO = { version: d.version, valor: d.valor || {} };
  return DESCRIPCIONES_MEMO.valor;
}

const tienda = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p.startsWith("/admin/api/")) return api(request, env, url, ctx);
    if (p === "/api/interno/tareas" && request.method === "POST" && env.DB) return tareasProgramadas(request, env);
    if (p === "/api/pedido" && request.method === "POST") {
      if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido." }, 403);
      return crearPedido(request, env, url);
    }
    if (p === "/api/pedido" && request.method === "GET" && env.DB) return estadoPublico(env, url);
    if (p === "/api/mp/webhook" && request.method === "POST") return webhookMP(request, env, url);
    if (p === "/api/visita" && request.method === "POST") {
      if (!env.DB || !mismoOrigen(request, url)) return new Response(null, { status: 204 });
      return registrarVisita(request, env);
    }
    if (p.startsWith("/api/juego/") && request.method === "POST") {
      if (!env.DB) return json({ error: "No disponible." }, 503);
      if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido." }, 403);
      if (p === "/api/juego/inicio") return juegoInicio(request, env);
      if (p === "/api/juego/fin") return juegoFin(request, env);
      if (p === "/api/juego/registro") return juegoRegistro(request, env);
      if (p === "/api/juego/verificar") return juegoVerificar(request, env);
      if (p === "/api/juego/reenviar") return juegoReenviar(request, env);
    }
    const legal = p.replace(/^\/|\/$/g, "");
    if (Object.hasOwn(HTML_LEGALES, legal)) return html(HTML_LEGALES[legal], { "cache-control": "public, max-age=3600" });
    if (p === "/api/cupon" && request.method === "POST") {
      if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido." }, 403);
      return canjearCupon(request, env);
    }
    if (p === "/admin" || p === "/admin/") return html(HTML_ADMIN, { "x-robots-tag": "noindex", "cache-control": "no-store" });

    const est = ESTATICOS[p];
    if (est) return new Response(bin(est[1]), { headers: { ...SEGURIDAD, "content-type": est[0], "cache-control": p.startsWith("/img/fuentes/") ? "public, max-age=31536000, immutable" : "public, max-age=3600" } });

    if (p.startsWith("/media/") && env.CATALOGO) {
      const cache = typeof caches !== "undefined" ? caches.default : null;
      if (cache) { try { const c = await cache.match(request); if (c) return c; } catch {} }
      const id = p.slice(7);
      const { value, metadata } = await env.CATALOGO.getWithMetadata("img:" + id, "arrayBuffer");
      if (!value) return new Response("No encontrado", { status: 404 });
      // Las URL llevan ?v=…: si la foto cambia, cambia la URL; se puede guardar en caché mucho tiempo.
      const res = new Response(value, { headers: { ...SEGURIDAD, "content-type": metadata?.tipo || "image/webp", "cache-control": "public, max-age=2592000, immutable" } });
      if (cache && ctx?.waitUntil) { try { ctx.waitUntil(cache.put(request, res.clone())); } catch {} }
      return res;
    }

    if (p === "/api/descripcion" && env.DB) {
      const id = url.searchParams.get("id") || "";
      const todas = (await leerDoc(env, "descripciones"))?.valor || {};
      return json({ descripcion: todas[id] || "" }, 200, { "cache-control": "public, max-age=600" });
    }

    if (p === "/robots.txt") return new Response(robotsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (p === "/index.html") return Response.redirect(new URL("/" + url.search, url).toString(), 301);
    if (p === "/resena" && request.method === "POST" && env.DB) return guardarResena(request, env, url, await paginaBase(env, ctx), ctx);
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "No encontrado." }, 404);
    if (!env.DB) return html(paginaPublica(CATALOGO_INICIAL, null, CONFIG_INICIAL).replace("/*JUEGO_CONFIG*/", "const JUEGO = { activo: false };"));
    const base = await paginaBase(env, ctx);
    if (p === "/sitemap.xml") return new Response(sitemapXml([...base.productos, ...(base.agotados || [])], base.actualizado), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (p === "/feed/google.xml") return new Response(feedGoogle(base.productos, await descripcionesMemo(env)), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=1800" } });
    if (p === "/resena") return paginaResena(request, env, url, base);
    const esProducto = p.startsWith("/productos/");
    const ruta = rutaSeo(url, base.html, base.productos, esProducto ? await descripcionesMemo(env) : {}, esProducto ? await resenasMemo(env) : {}, base.agotados);
    if (ruta) return html(ruta.html, {}, base.html);
    return html(pagina404(base.html, base.productos), {}, base.html, 404);
  },
};

// ---------- Dominio principal y sitio de pruebas privado ----------
// {{tienda.dominio}} es la única dirección pública. www y {{tienda.proyecto}}.pages.dev redirigen (301) a ella.
// Las direcciones *.{{tienda.proyecto}}.pages.dev (pruebas y versiones anteriores) no se indexan y, si existe el secreto
// PRUEBAS_PASSWORD, piden usuario y contraseña. Los avisos de Mercado Pago siempre pasan.
const DOMINIO = "{{tienda.dominio}}";
const REDIRIGIR = new Set(["www.{{tienda.dominio}}", "{{tienda.proyecto}}.pages.dev"].filter(h => h !== DOMINIO));   // una demo puede vivir en <proyecto>.pages.dev
const esPrivado = host => host.endsWith(".{{tienda.proyecto}}.pages.dev") || host === "localhost";
function pideClave(request, env) {
  if (!env.PRUEBAS_PASSWORD) return false;
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return true;
  let clave = ""; try { clave = atob(h.slice(6)).split(":").slice(1).join(":"); } catch { return true; }
  return !igual(clave, env.PRUEBAS_PASSWORD);
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), host = url.hostname;
    if (REDIRIGIR.has(host) && (request.method === "GET" || request.method === "HEAD"))
      return new Response(null, { status: 301, headers: { location: `https://${DOMINIO}${url.pathname}${url.search}`, "cache-control": "public, max-age=3600" } });
    if (!esPrivado(host)) return tienda.fetch(request, env, ctx);
    // Sitio de pruebas: nunca indexable
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" } });
    if (url.pathname !== "/api/mp/webhook" && pideClave(request, env))
      return new Response("Sitio de pruebas privado de {{tienda.nombre}}.", { status: 401, headers: { "www-authenticate": 'Basic realm="{{tienda.nombre}} pruebas", charset="UTF-8"', "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" } });
    const r = await tienda.fetch(request, env, ctx);
    const res = new Response(r.body, r);
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  },
};
