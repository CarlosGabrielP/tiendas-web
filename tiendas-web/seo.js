// ---------- Páginas para buscadores (SEO) ----------
// build.py inserta este archivo en el servidor. Cada producto, categoría y marca tiene su propia dirección,
// con título, descripción, canonical, datos estructurados (schema.org) y contenido en el HTML (sin depender de JavaScript).
const SITIO = "{{tienda.sitio}}";
const GUIAS = __GUIAS__;   // guías de compra (carpeta guias/, las inserta build.py)
const POR_PAGINA_SEO = 24;
// Categorías: vienen de tienda.json (CATS está en worker.js)
const CAT_SLUG = Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.slug]));
const SLUG_CAT = Object.fromEntries(Object.entries(CAT_SLUG).map(([k, v]) => [v, k]));
const CAT_INFO = CATS;
const TEXTOS_SEO = {{json:tienda.textos}};
// "{temp}" = la temporada más nueva (o nada); "{temp|otro}" = la temporada o «otro»
const conTemp = (t, temp) => t.replace(/\{temp(?:\|([^}]*))?\}/g, (_, otro) => temp || otro || "").replace(/ {2,}/g, " ");
const escSeo = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugMarca = m => String(m || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const marcaDeSeo = p => p.specs?.Marca || "";
const rutaImgSeo = i => !i ? "" : /^(https?:|\/)/.test(i) ? i : "/" + i;
const imgAbs = p => p.imagen ? (/^https?:/.test(p.imagen) ? p.imagen : SITIO + rutaImgSeo(p.imagen).replace(/\?v=\d+$/, "")) : `${SITIO}/img/logo.png`;
const pesosSeo = n => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esPedidoSeo = p => p.entrega === "pedido" || (p.variantes?.length ? !p.variantes.some(v => v.disponible !== false && (v.stock == null || v.stock > 0)) : p.stock === 0);
const recortar = (t, n) => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

// Descripción con formato sencillo: bloques separados por línea en blanco; "## Título" = subtítulo; líneas "• …" = lista
function descripcionHtml(t) {
  return String(t).replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => {
    const lineas = b.split("\n").map(l => l.trim()).filter(Boolean);
    if (lineas.length === 1 && lineas[0].startsWith("## ")) return `<h3>${escSeo(lineas[0].slice(3))}</h3>`;
    if (lineas[0].startsWith("## ")) return `<h3>${escSeo(lineas[0].slice(3))}</h3>` + descripcionHtml(lineas.slice(1).join("\n"));
    if (lineas.every(l => /^[•\-*] /.test(l))) return `<ul>${lineas.map(l => `<li>${escSeo(l.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${lineas.map(escSeo).join("<br>")}</p>`;
  }).join("");
}
// Tarjeta para el HTML del servidor (el navegador la vuelve a dibujar con la misma estructura y más funciones)
function tarjetaSeo(p) {
  const img = p.imagen ? `<img src="${escSeo(rutaImgSeo(p.imagen))}" alt="${escSeo(p.nombre)}" loading="lazy">` : "";
  const precio = typeof p.precio === "number" ? `<b>${pesosSeo(p.precio)}</b>${p.precioAntes ? `<s>${pesosSeo(p.precioAntes)}</s>` : ""}` : `<span>Precio próximamente</span>`;
  return `<article class="producto"><div class="media-caja" style="position:relative"><a class="media" href="/productos/${p.id}" aria-label="${escSeo(p.nombre)}">${img}</a></div>
    <div class="info"><span class="cat">${CAT_INFO[p.categoria]?.nombre || ""}</span><h3><a href="/productos/${p.id}">${escSeo(p.nombre)}</a></h3>
    <span class="mini">${escSeo(Object.entries(p.specs || {}).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · "))}</span>
    <span class="etq-entrega">${esPedidoSeo(p) ? "📦 Hasta 10 días hábiles" : "⚡ Entrega inmediata"}</span>
    <div class="precio">${precio}</div><a class="btn" href="/productos/${p.id}">Ver producto</a></div></article>`;
}
function paginacionSeo(base, pagina, total) {
  const n = Math.ceil(total / POR_PAGINA_SEO);
  if (n <= 1) return "";
  return `<nav class="paginas" aria-label="Páginas del catálogo">${Array.from({ length: n }, (_, i) => i + 1 === pagina ? `<span aria-current="page">${i + 1}</span>` : `<a href="${base}${i ? "?pagina=" + (i + 1) : ""}">${i + 1}</a>`).join("")}</nav>`;
}
// Novedades: lo que llegó del proveedor en los últimos 45 días y los modelos de la temporada más nueva (misma regla en index.html)
const DIAS_NOVEDAD = 45;
function novedadesDe(productos) {
  const max = Math.max(0, ...productos.filter(p => p.categoria === CATEGORIA_PRINCIPAL).map(p => +p.specs?.Temporada || 0)), ahora = Date.now();
  const reciente = p => p.nuevoDesde && ahora - Date.parse(p.nuevoDesde + "T12:00:00Z") <= DIAS_NOVEDAD * 864e5;
  return productos.filter(p => reciente(p) || (max && +p.specs?.Temporada === max))
    .sort((a, b) => (reciente(b) ? b.nuevoDesde : "").localeCompare(reciente(a) ? a.nuevoDesde : "") || (+b.specs?.Temporada || 0) - (+a.specs?.Temporada || 0));
}
function chipsSeo(productos, actual) {
  return [["todas", "Todo", "/#catalogo"], ...(novedadesDe(productos).length ? [["novedades", "✨ Novedades", "/novedades"]] : []), ...Object.keys(CAT_INFO).filter(c => productos.some(p => p.categoria === c)).map(c => [c, CAT_INFO[c].nombre, "/" + CAT_SLUG[c]])]
    .map(([k, v, h]) => `<a class="chip" href="${h}" data-cat="${k}"${k === actual ? ' aria-current="page"' : ""}>${v}</a>`).join("");
}
const migasLd = items => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([nombre, url], i) => ({ "@type": "ListItem", position: i + 1, name: nombre, item: SITIO + url })) });
const migasHtml = items => `<nav class="migas" aria-label="Ruta de navegación">${items.map(([n, u], i) => i === items.length - 1 ? `<span>${escSeo(n)}</span>` : `<a href="${u}">${escSeo(n)}</a>`).join(" › ")}</nav>`;
const ORGANIZACION = { "@context": "https://schema.org", "@type": "OnlineStore", name: "{{tienda.nombre}}", url: SITIO, logo: `${SITIO}/img/logo.png`,
  email: "{{tienda.correo.contacto}}", telephone: "{{tienda.telefonoIntl}}", areaServed: "MX", sameAs: [],
  address: { "@type": "PostalAddress", streetAddress: "{{tienda.direccion.calleCompleta}}", postalCode: "{{tienda.direccion.cp}}", addressLocality: "{{tienda.direccion.ciudad}}", addressRegion: "{{tienda.direccion.estado}}", addressCountry: "MX" } };
// Datos del producto para Google (deben coincidir con lo que ve el comprador)
function productoLd(p, descripcion, rs = null, agotado = false) {
  const ld = { "@context": "https://schema.org", "@type": "Product", name: p.nombre, sku: p.id, image: [imgAbs(p)], url: `${SITIO}/productos/${p.id}`,
    description: recortar(descripcion || p.resumen || `${p.nombre}. ${CAT_INFO[p.categoria]?.h1 || ""} con envío a todo México.`, 4900),
    category: CAT_INFO[p.categoria]?.h1 };
  if (marcaDeSeo(p)) ld.brand = { "@type": "Brand", name: marcaDeSeo(p) };
  if (typeof p.precio === "number") {
    const pedido = esPedidoSeo(p), gratis = p.precio >= ENVIO.gratisDesde;
    ld.offers = { "@type": "Offer", url: ld.url, priceCurrency: "MXN", price: p.precio.toFixed(2), itemCondition: "https://schema.org/NewCondition",
      availability: agotado ? "https://schema.org/OutOfStock" : pedido ? "https://schema.org/BackOrder" : "https://schema.org/InStock", seller: { "@type": "Organization", name: "{{tienda.nombre}}" },
      shippingDetails: { "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount", value: gratis ? "0" : String(ENVIO.costo), currency: "MXN" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "MX" },
        deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: pedido ? 8 : 1, unitCode: "DAY" },
          transitTime: { "@type": "QuantitativeValue", minValue: 2, maxValue: 3, unitCode: "DAY" } } },
      hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", applicableCountry: "MX", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 5, returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/ReturnShippingFees",
        merchantReturnLink: `${SITIO}/devoluciones` } };
  }
  // Calificaciones de compradores verificados (permite que Google muestre estrellas en los resultados)
  if (rs?.n) {
    ld.aggregateRating = { "@type": "AggregateRating", ratingValue: (rs.suma / rs.n).toFixed(1), reviewCount: rs.n, bestRating: 5, worstRating: 1 };
    ld.review = rs.ultimas.slice(0, 5).map(r => ({ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: r.e, bestRating: 5 }, author: { "@type": "Person", name: r.a },
      datePublished: r.f, ...(r.t ? { reviewBody: r.t } : {}) }));
  }
  return ld;
}
// Cabecera común: título, descripción, canonical, Open Graph (vista previa en WhatsApp/Facebook) y datos estructurados
function cabeceraSeo({ titulo, desc, url, imagen, tipo = "website", extra = "", ld = [], noindex = false }) {
  return `${noindex ? `<meta name="robots" content="noindex, follow">` : `<link rel="canonical" href="${SITIO}${url}">`}
<meta property="og:site_name" content="{{tienda.nombre}}"><meta property="og:locale" content="es_MX"><meta property="og:type" content="${tipo}">
<meta property="og:title" content="${escSeo(titulo)}"><meta property="og:description" content="${escSeo(desc)}"><meta property="og:url" content="${SITIO}${url}">
<meta property="og:image" content="${escSeo(imagen || SITIO + "/img/logo.png")}"><meta name="twitter:card" content="summary_large_image">${extra}
${ld.map(jsonLd).join("\n")}`;
}
function aplicarSeo(base, { titulo, desc, head, ruta, cat = "", marca = "", producto = "", hero = true, h1 = null, intro = "", chips = "", grid = "", mas = "", ssr = "" }) {
  let h = base.replace(/<title>[^<]*<\/title>/, `<title>${escSeo(titulo)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escSeo(desc)}">`)
    .replace("<!--SEO_HEAD-->", head)
    .replace('<body data-ruta="inicio">', `<body data-ruta="${ruta}"${cat ? ` data-cat="${cat}"` : ""}${marca ? ` data-marca="${escSeo(marca)}"` : ""}${producto ? ` data-producto="${producto}"` : ""}>`)
    .replace("<!--SSR_PRODUCTO-->", ssr)
    .replace('<div class="filtros" role="group" aria-label="Filtrar por categoría" id="filtros"></div>', `<div class="filtros" role="group" aria-label="Filtrar por categoría" id="filtros">${chips}</div>`)
    .replace('<div class="grid" id="grid" aria-live="polite"></div>', `<div class="grid" id="grid" aria-live="polite">${grid}</div>`)
    .replace('<div class="mas" id="mas"></div>', `<div class="mas" id="mas">${mas}</div>`);
  if (!hero) h = h.replace(/<!--HERO-->[\s\S]*?<!--\/HERO-->/, "");
  if (h1) h = h.replace('<h2 id="catalogo-titulo">Catálogo</h2><!--CAT_INTRO-->', `<h1 id="catalogo-titulo">${escSeo(h1)}</h1>${intro ? `<p class="cat-intro">${escSeo(intro)}</p>` : ""}<h2 class="sr-only">Productos</h2>`);
  else if (intro) h = h.replace('<!--CAT_INTRO-->', `<p class="cat-intro">${escSeo(intro)}</p>`);
  return h;
}
const paginaDe = url => { const n = parseInt(url.searchParams.get("pagina"), 10); return n > 1 ? n : 1; };

// Devuelve { html, status } para una ruta pública, o null si no es una página de la tienda
function rutaSeo(url, base, productos, descripciones, resenas = {}, agotados = []) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const pagina = paginaDe(url);
  const listado = (lista, rutaBase) => {
    const total = lista.length, desde = (pagina - 1) * POR_PAGINA_SEO;
    if (desde >= total && pagina > 1) return null;
    return { grid: lista.slice(desde, desde + POR_PAGINA_SEO).map(tarjetaSeo).join(""), mas: paginacionSeo(rutaBase, pagina, total), sufijo: pagina > 1 ? ` (página ${pagina})` : "", canon: rutaBase + (pagina > 1 ? `?pagina=${pagina}` : "") };
  };
  // Portada
  if (p === "/") {
    const l = listado(productos, "/");
    if (!l) return null;
    const titulo = "{{tienda.textos.titulo}} | {{tienda.nombre}}" + l.sufijo;
    const desc = "{{tienda.textos.descripcion}}";
    return { html: aplicarSeo(base, { titulo, desc, ruta: "inicio", chips: chipsSeo(productos, "todas"), grid: l.grid, mas: l.mas,
      head: cabeceraSeo({ titulo, desc, url: l.canon, ld: [ORGANIZACION, { "@context": "https://schema.org", "@type": "WebSite", name: "{{tienda.nombre}}", url: SITIO + "/" }] }) }) };
  }
  // Categorías: /palas, /paleteros…
  const cat = SLUG_CAT[p.slice(1)];
  if (cat) {
    const lista = productos.filter(x => x.categoria === cat), info = CAT_INFO[cat];
    if (!lista.length) return null;
    const l = listado(lista, p); if (!l) return null;
    const marcas = [...new Set(lista.map(marcaDeSeo).filter(Boolean))].slice(0, 6).join(", ");
    const titulo = `${info.titulo}${l.sufijo} | {{tienda.nombre}}`;
    return { html: aplicarSeo(base, { titulo, desc: info.desc, ruta: "categoria", cat, hero: false, h1: info.h1 + l.sufijo, intro: info.intro + (marcas ? ` Marcas disponibles: ${marcas}.` : ""),
      chips: chipsSeo(productos, cat), grid: l.grid, mas: l.mas, ssr: `<div class="contenedor">${migasHtml([["Inicio", "/"], [info.nombre, p]])}</div>`,
      head: cabeceraSeo({ titulo, desc: info.desc, url: l.canon, ld: [migasLd([["Inicio", "/"], [info.nombre, p]])] }) }) };
  }
  // Novedades: /novedades
  if (p === "/novedades") {
    const lista = novedadesDe(productos);
    if (!lista.length) return null;
    const l = listado(lista, p); if (!l) return null;
    const temp = Math.max(0, ...lista.map(x => +x.specs?.Temporada || 0));
    const titulo = `${conTemp(TEXTOS_SEO.novedades.titulo, temp)}${l.sufijo} | {{tienda.nombre}}`;
    const desc = conTemp(TEXTOS_SEO.novedades.desc, temp);
    return { html: aplicarSeo(base, { titulo, desc, ruta: "categoria", cat: "novedades", hero: false, h1: "Novedades" + l.sufijo,
      intro: conTemp(TEXTOS_SEO.novedades.intro, temp),
      chips: chipsSeo(productos, "novedades"), grid: l.grid, mas: l.mas, ssr: `<div class="contenedor">${migasHtml([["Inicio", "/"], ["Novedades", p]])}</div>`,
      head: cabeceraSeo({ titulo, desc, url: l.canon, ld: [migasLd([["Inicio", "/"], ["Novedades", p]])] }) }) };
  }
  // Marcas: /marcas/bullpadel
  const mm = p.match(/^\/marcas\/([a-z0-9-]+)$/);
  if (mm) {
    const lista = productos.filter(x => slugMarca(marcaDeSeo(x)) === mm[1]);
    if (!lista.length) return null;
    const marca = marcaDeSeo(lista[0]), l = listado(lista, p); if (!l) return null;
    const cats = [...new Set(lista.map(x => CAT_INFO[x.categoria]?.nombre.toLowerCase()).filter(Boolean))].join(", ");
    const titulo = `${marca}: ${TEXTOS_SEO.marcas.tituloMarca}${l.sufijo} | {{tienda.nombre}}`;
    const desc = `Productos ${marca} originales en {{tienda.nombre}}: ${cats}. Precio en pesos, IVA incluido y envío a todo México.`;
    return { html: aplicarSeo(base, { titulo, desc, ruta: "marca", marca, hero: false, h1: `${marca} en México${l.sufijo}`, intro: desc,
      chips: chipsSeo(productos, "todas"), grid: l.grid, mas: l.mas, ssr: `<div class="contenedor">${migasHtml([["Inicio", "/"], ["Marcas", "/marcas"], [marca, p]])}</div>`,
      head: cabeceraSeo({ titulo, desc, url: l.canon, ld: [migasLd([["Inicio", "/"], ["Marcas", "/marcas"], [marca, p]])] }) }) };
  }
  if ((p === "/guias" || p.startsWith("/guias/")) && Object.keys(GUIAS).length) { const h = rutaGuias(p, base, productos); return h ? { html: h } : null; }
  if (p === "/marcas") {
    const marcas = [...new Map(productos.filter(x => marcaDeSeo(x)).map(x => [slugMarca(marcaDeSeo(x)), marcaDeSeo(x)])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
    const titulo = `${TEXTOS_SEO.marcas.titulo} | {{tienda.nombre}}`, desc = TEXTOS_SEO.marcas.desc;
    const lista = `<div class="contenedor"><ul class="lista-marcas">${marcas.map(([s, m]) => `<li><a href="/marcas/${s}">${escSeo(m)}</a> <span class="suave-txt">(${productos.filter(x => slugMarca(marcaDeSeo(x)) === s).length})</span></li>`).join("")}</ul></div>`;
    return { html: aplicarSeo(base, { titulo, desc, ruta: "marcas", hero: false, h1: TEXTOS_SEO.marcas.h1, intro: desc, chips: chipsSeo(productos, "todas"),
      grid: productos.slice(0, POR_PAGINA_SEO).map(tarjetaSeo).join(""), ssr: `<div class="contenedor">${migasHtml([["Inicio", "/"], ["Marcas", "/marcas"]])}</div>${lista}`,
      head: cabeceraSeo({ titulo, desc, url: "/marcas", ld: [migasLd([["Inicio", "/"], ["Marcas", "/marcas"]])] }) }) };
  }
  // Producto: /productos/bullpadel-vertex-05-2026
  const mp = p.match(/^\/productos\/([a-z0-9-]+)$/);
  if (mp) {
    let x = productos.find(q => q.id === mp[1]), agotado = false;
    if (!x && (x = agotados.find(q => q.id === mp[1]))) agotado = true;   // agotada en el proveedor: la página sigue, sin botón de compra
    if (!x) return null;
    const info = CAT_INFO[x.categoria] || { nombre: "Productos", h1: "Productos" }, catUrl = "/" + (CAT_SLUG[x.categoria] || "");
    const descripcion = descripciones[x.id] || "";
    const rs = resenas[x.id]?.n ? resenas[x.id] : null, prom = rs ? Math.round(rs.suma / rs.n * 10) / 10 : 0;
    const pedido = esPedidoSeo(x), marca = marcaDeSeo(x);
    const precioTxt = typeof x.precio === "number" ? pesosSeo(x.precio) : null;
    const titulo = recortar(`${x.nombre}${precioTxt ? " · " + precioTxt : ""}`, 58) + " | {{tienda.nombre}}";
    const desc = recortar(`${x.nombre}${marca && !x.nombre.includes(marca) ? " de " + marca : ""}${x.nivel ? `, pala de nivel ${x.nivel.replace("iniciacion", "iniciación")} para juego de ${x.juego}` : ""}. ${precioTxt ? `Precio: ${precioTxt} con IVA. ` : ""}${agotado ? "Agotada por ahora; mira modelos parecidos disponibles" : pedido ? "Entrega en hasta 10 días hábiles" : "Entrega inmediata"} y envío a todo México${typeof x.precio === "number" && x.precio >= ENVIO.gratisDesde ? " gratis" : ""}.`, 158);
    const specs = Object.entries(x.specs || {});
    const migas = [["Inicio", "/"], [info.nombre, catUrl], [x.nombre, p]];
    // Si está agotada, primero las de su misma marca y precio parecido
    const relacionados = productos.filter(q => q.categoria === x.categoria && q.id !== x.id);
    if (agotado) relacionados.sort((a, b) => (marcaDeSeo(b) === marca) - (marcaDeSeo(a) === marca) || Math.abs((a.precio || 0) - (x.precio || 0)) - Math.abs((b.precio || 0) - (x.precio || 0)));
    const avisame = `https://wa.me/{{tienda.whatsapp}}?text=${encodeURIComponent(`Hola, me avisan cuando vuelva la ${x.nombre}?`)}`;
    const boton = agotado ? `<button class="btn btn-comprar" disabled>Agotada por ahora</button>` : typeof x.precio !== "number" ? `<button class="btn btn-comprar" disabled>Próximamente</button>`
      : x.variantes?.length ? `<button class="btn btn-comprar" data-ver="${x.id}">Elegir talla</button>` : `<button class="btn btn-comprar" data-add="${x.id}">Agregar al carrito</button>`;
    const ssr = `<section class="contenedor pagina-producto">${migasHtml(migas)}
      <div class="ficha">
        <div class="media">${x.imagen ? `<img src="${escSeo(rutaImgSeo(x.imagen))}" alt="${escSeo(x.nombre)}" fetchpriority="high">` : ""}</div>
        <div class="ficha-compra">
          <span class="cat" style="color:var(--suave);text-transform:uppercase;font-size:.8rem">${escSeo(info.nombre)}${marca ? " · " + escSeo(marca) : ""}</span>
          <h1>${escSeo(x.nombre)}</h1>
          ${rs ? `<a class="calificacion" href="#opiniones" aria-label="Calificación ${prom} de 5, ${rs.n} ${rs.n === 1 ? "opinión" : "opiniones"}"><span class="estrellas-v" style="--p:${prom / 5 * 100}%" aria-hidden="true">★★★★★</span> <b>${prom.toFixed(1)}</b> <span class="suave-txt">(${rs.n} ${rs.n === 1 ? "opinión" : "opiniones"})</span></a>` : ""}
          <div class="precio">${precioTxt ? `<b>${precioTxt}</b>${x.precioAntes ? `<s>${pesosSeo(x.precioAntes)}</s>` : ""}` : "<span>Precio próximamente</span>"}</div>
          ${precioTxt ? `<small class="suave-txt">IVA incluido · ${x.precio >= ENVIO.gratisDesde ? "envío gratis" : `envío ${pesosSeo(ENVIO.costo)} (gratis desde ${pesosSeo(ENVIO.gratisDesde)})`}</small>` : ""}
          ${x.nivel ? `<p style="margin:.5em 0 0">Nivel <b>${escSeo(x.nivel.replace("iniciacion", "iniciación"))}</b> · Juego de <b>${escSeo(x.juego || "")}</b></p>` : ""}
          ${x.variantes?.length ? `<p class="suave-txt">Tallas: ${x.variantes.filter(v => v.disponible !== false).map(v => escSeo(v.talla)).join(" · ")}</p>` : ""}
          ${boton}
          <div id="pagina-entrega">${agotado ? `<p class="aviso-entrega agotado">⛔ <b>Agotada por ahora.</b> Nuestro proveedor se quedó sin piezas de este modelo; suele volver pronto. <a href="${escSeo(avisame)}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a> y te avisamos cuando regrese. Mientras, abajo tienes modelos parecidos disponibles.</p>` : `<p class="aviso-entrega ${pedido ? "pedido" : "inmediata"}">${pedido ? "📦 <b>Entrega en máximo 10 días hábiles:</b> lo pedimos a nuestro proveedor el mismo día hábil de tu compra. Al pagar te mostramos la fecha máxima de entrega." : "⚡ <b>Entrega inmediata:</b> enviamos el mismo día hábil si pagas antes de las 2:00 p.m.; llega en 48–72 horas hábiles."}</p>`}</div>
          ${x.resumen ? `<p class="ficha-resumen">${escSeo(x.resumen)}</p>` : ""}
        </div>
        ${specs.length ? `<div class="ficha-tecnica"><h2 style="font-size:1.05rem">Ficha técnica</h2><table class="specs">${specs.map(([k, v]) => `<tr><td>${escSeo(k)}</td><td>${escSeo(v)}</td></tr>`).join("")}</table></div>` : ""}
      </div>
      ${descripcion ? `<div class="descripcion-pagina"><h2>Descripción</h2>${descripcionHtml(descripcion)}</div>` : ""}
      ${rs ? `<div class="opiniones" id="opiniones"><h2>Opiniones de clientes <span class="suave-txt">· ${prom.toFixed(1)} de 5 (${rs.n})</span></h2>
        ${rs.ultimas.map(r => `<div class="opinion"><span class="estrellas-v" style="--p:${r.e * 20}%" aria-label="${r.e} de 5 estrellas">★★★★★</span>
          ${r.t ? `<p>${escSeo(r.t)}</p>` : ""}<small class="suave-txt">${escSeo(r.a)}${r.c ? ` · ${escSeo(r.c)}` : ""} · compra verificada · ${escSeo(new Date(r.f + "T12:00:00Z").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }))}</small></div>`).join("")}</div>` : ""}
    </section>`;
    return { html: aplicarSeo(base, { titulo, desc, ruta: "producto", cat: x.categoria, producto: x.id, hero: false, ssr,
      chips: chipsSeo(productos, x.categoria), grid: relacionados.slice(0, 8).map(tarjetaSeo).join(""),
      head: cabeceraSeo({ titulo, desc, url: p, imagen: imgAbs(x), tipo: "product",
        extra: precioTxt ? `<meta property="product:price:amount" content="${x.precio.toFixed(2)}"><meta property="product:price:currency" content="MXN">` : "",
        ld: [productoLd(x, descripcion, rs, agotado), migasLd(migas)] }) }).replace('<h2 id="catalogo-titulo">Catálogo</h2>', `<h2 id="catalogo-titulo">${agotado ? "Modelos parecidos disponibles" : `Más ${escSeo(info.nombre.toLowerCase())}`}</h2>`) };
  }
  return null;
}
// Guías de compra: /guias y /guias/<slug>. "<!--PRODUCTOS:id1,id2-->" se vuelve una fila de tarjetas con precio al día.
function rutaGuias(p, base, productos) {
  const migasBase = [["Inicio", "/"], ["Guías", "/guias"]];
  if (p === "/guias") {
    const titulo = `${TEXTOS_SEO.guias.titulo} | {{tienda.nombre}}`, desc = TEXTOS_SEO.guias.desc;
    const lista = Object.entries(GUIAS).sort((a, b) => b[1].publicada.localeCompare(a[1].publicada));
    const ssr = `<section class="contenedor guia">${migasHtml(migasBase)}<h1>Guías de pádel</h1><div class="lista-guias">${lista.map(([slug, g]) =>
      `<a class="guia-tarjeta" href="/guias/${slug}"><b>${escSeo(g.h1)}</b><span>${escSeo(g.resumen || g.desc)}</span></a>`).join("")}</div></section>`;
    return aplicarSeo(base, { titulo, desc, ruta: "guias", hero: false, ssr, chips: chipsSeo(productos, "todas"),
      head: cabeceraSeo({ titulo, desc, url: "/guias", ld: [migasLd(migasBase)] }) });
  }
  const m = p.match(/^\/guias\/([a-z0-9-]+)$/), g = m && GUIAS[m[1]];
  if (!g) return null;
  const mapa = new Map(productos.map(x => [x.id, x]));
  const cuerpo = g.html.replace(/<!--PRODUCTOS:([a-z0-9,-]+)-->/g, (_, ids) => {
    const lista = ids.split(",").map(i => mapa.get(i)).filter(Boolean);
    return lista.length ? `<div class="grid grid-guia">${lista.map(tarjetaSeo).join("")}</div>` : "";
  });
  const url = `/guias/${m[1]}`, migas = [...migasBase, [g.h1, url]];
  const articulo = { "@context": "https://schema.org", "@type": "Article", headline: g.h1, description: g.desc, datePublished: g.publicada, dateModified: g.actualizada || g.publicada,
    inLanguage: "es-MX", mainEntityOfPage: SITIO + url, image: [`${SITIO}/img/logo.png`],
    author: { "@type": "Organization", name: "{{tienda.nombre}}", url: SITIO }, publisher: { "@type": "Organization", name: "{{tienda.nombre}}", logo: { "@type": "ImageObject", url: `${SITIO}/img/logo.png` } } };
  const ssr = `<article class="contenedor guia">${migasHtml(migas)}<h1>${escSeo(g.h1)}</h1>
    <p class="guia-fecha">Actualizada el ${new Date(g.actualizada || g.publicada).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} · Equipo {{tienda.nombre}}</p>${cuerpo}</article>`;
  return aplicarSeo(base, { titulo: `${g.titulo} | {{tienda.nombre}}`, desc: g.desc, ruta: "guia", cat: CATEGORIA_PRINCIPAL, hero: false, ssr, chips: chipsSeo(productos, CATEGORIA_PRINCIPAL),
    grid: productos.filter(x => x.categoria === CATEGORIA_PRINCIPAL).slice(0, POR_PAGINA_SEO).map(tarjetaSeo).join(""),
    head: cabeceraSeo({ titulo: g.titulo, desc: g.desc, url, tipo: "article", ld: [articulo, migasLd(migas)] }) })
    .replace('<h2 id="catalogo-titulo">Catálogo</h2>', `<h2 id="catalogo-titulo">${escSeo(TEXTOS_SEO.guias.catalogo)}</h2>`);
}
function pagina404(base, productos) {
  const titulo = "Página no encontrada | {{tienda.nombre}}", desc = "La página que buscas no existe o el producto ya no está disponible.";
  return aplicarSeo(base, { titulo, desc, ruta: "404", hero: false, h1: "No encontramos esta página", intro: "Puede que el producto ya no esté disponible. Mira nuestro catálogo:",
    chips: chipsSeo(productos, "todas"), grid: productos.slice(0, POR_PAGINA_SEO).map(tarjetaSeo).join(""), head: cabeceraSeo({ titulo, desc, url: "/404", noindex: true }) });
}
function robotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /*?pedido=\nDisallow: /*?q=\n\nSitemap: ${SITIO}/sitemap.xml\n`;
}
function sitemapXml(productos, actualizado) {
  const fecha = (actualizado || new Date().toISOString()).slice(0, 10);
  const urls = [["/", "daily", "1.0"],
    ...Object.keys(CAT_INFO).filter(c => productos.some(p => p.categoria === c)).map(c => ["/" + CAT_SLUG[c], "daily", "0.9"]),
    ...(novedadesDe(productos).length ? [["/novedades", "daily", "0.9"]] : []),
    ["/marcas", "weekly", "0.6"],
    ...[...new Set(productos.map(p => slugMarca(marcaDeSeo(p))).filter(Boolean))].map(s => [`/marcas/${s}`, "weekly", "0.7"]),
    ...productos.map(p => [`/productos/${p.id}`, "weekly", "0.8"]),
    ...(Object.keys(GUIAS).length ? [["/guias", "weekly", "0.6"], ...Object.keys(GUIAS).map(s => [`/guias/${s}`, "monthly", "0.7"])] : []),
    ...["devoluciones", "facturacion", "terminos", "privacidad", "bases-juego"].filter(l => Object.hasOwn(HTML_LEGALES, l)).map(l => ["/" + l, "monthly", "0.3"])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, f, pr]) => `<url><loc>${SITIO}${u}</loc><lastmod>${fecha}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join("\n")}\n</urlset>\n`;
}

// ---------- Feed para Google Merchant Center (Google Shopping) ----------
// RSS 2.0 con el espacio de nombres de Google. Merchant Center lo descarga solo (una vez al día).
// Cada talla es un artículo propio (agrupado con item_group_id). Bajo pedido = "backorder" con fecha estimada.
// Google acepta ids de máximo 50 caracteres: los largos se acortan siempre igual (inicio + huella de 8 caracteres)
function idFeed(id) {
  if (id.length <= 50) return id;
  let h = 0x811c9dc5;                                   // FNV-1a de 32 bits
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return id.slice(0, 41).replace(/-+$/, "") + "-" + h.toString(16).padStart(8, "0");
}
function feedGoogle(productos, descripciones) {
  const x = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const fechaPedido = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10) + "T12:00-0600";
  const items = [];
  for (const p of productos) {
    if (typeof p.precio !== "number" || !(p.precio > 0)) continue;                    // sin precio no se anuncia
    const marca = marcaDeSeo(p), cat = CAT_INFO[p.categoria];
    // Texto plano para Google: los títulos "## …" de la página se vuelven frases normales
    const plano = t => t && String(t).replace(/^#{1,6}\s*(.+?)\s*$/gm, (_, h) => /[.?!:]$/.test(h) ? h : h + ":").replace(/^•\s*/gm, "- ");
    const desc = recortar(plano(descripciones[p.id]) || p.resumen || `${p.nombre}${marca ? " de " + marca : ""}. ${cat?.h1 || "Producto de pádel"} original con envío a todo México.`, 4900);
    const precio = p.precioAntes && p.precioAntes > p.precio ? { normal: p.precioAntes, oferta: p.precio } : { normal: p.precio };
    const variantes = p.variantes?.length ? p.variantes.filter(v => v.disponible !== false) : [null];
    for (const v of variantes) {
      const pedido = p.entrega === "pedido" || (v ? v.stock === 0 : esPedidoSeo(p));
      items.push(`<item>
<g:id>${x(idFeed(v ? `${p.id}-${v.talla}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-") : p.id))}</g:id>
<title>${x(recortar(p.nombre + (v ? ` - Talla ${v.talla}` : ""), 150))}</title>
<description>${x(desc)}</description>
<link>${SITIO}/productos/${p.id}</link>
<g:image_link>${x(imgAbs(p))}</g:image_link>
<g:availability>${pedido ? "backorder" : "in_stock"}</g:availability>${pedido ? `\n<g:availability_date>${fechaPedido}</g:availability_date>` : ""}
<g:price>${precio.normal.toFixed(2)} MXN</g:price>${precio.oferta ? `\n<g:sale_price>${precio.oferta.toFixed(2)} MXN</g:sale_price>` : ""}
<g:condition>new</g:condition>${marca ? `\n<g:brand>${x(marca)}</g:brand>` : ""}
<g:identifier_exists>no</g:identifier_exists>
<g:product_type>${x(`${TEXTOS_SEO.tipoProducto} > ${cat?.nombre || "Productos"}${marca ? " > " + marca : ""}`)}</g:product_type>${v ? `\n<g:item_group_id>${x(p.id)}</g:item_group_id>\n<g:size>${x(v.talla)}</g:size>` : ""}${p.specs?.Color ? `\n<g:color>${x(p.specs.Color)}</g:color>` : ""}
<g:shipping><g:country>MX</g:country><g:service>Estándar</g:service><g:price>${p.precio >= ENVIO.gratisDesde ? "0.00" : ENVIO.costo.toFixed(2)} MXN</g:price></g:shipping>
</item>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>{{tienda.nombre}} - {{tienda.textos.rss}}</title><link>${SITIO}/</link><description>Catálogo de {{tienda.nombre}}</description>
${items.join("\n")}
</channel></rss>
`;
}
