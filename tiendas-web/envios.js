// ---------- Envíos con Envíosperros (API v3): cotizar, generar guía, etiqueta, cancelar y rastreo ----------
// Documentación: https://enviosperros.readme.io  ·  Token: secreto ENVIOSPERROS_TOKEN (Integraciones → "Conexión vía API REST").
// En pruebas (pages.dev / localhost) se usa el ambiente staging de Envíosperros, que tiene su propio token y saldo de prueba.
// ENVIOSPERROS_ENTORNO = "staging" | "produccion" fuerza uno de los dos.
const EP_URL = { produccion: "https://app.enviosperros.com/api", staging: "https://staging-app.enviosperros.com/api" };
const epEntorno = (env, host = "") => env.ENVIOSPERROS_ENTORNO === "staging" || env.ENVIOSPERROS_ENTORNO === "produccion" ? env.ENVIOSPERROS_ENTORNO
  : /\.pages\.dev$|^localhost$|^127\./.test(host) ? "staging" : "produccion";
const ENVIOS_INICIAL = {
  origen: { empresa: "{{tienda.nombre}}", nombre: "{{tienda.responsable}}", tel: "{{tienda.telefono10}}", email: "{{tienda.correo.contacto}}", calle: "{{tienda.direccion.calle}}", numExt: "{{tienda.direccion.numero}}", numInt: "", cp: "{{tienda.direccion.cp}}", colonia: "", referencias: "" },
  paquetes: {{json:tienda.envios.paquetes}},
  descripcion: "{{tienda.envios.descripcion}}", satProducto: "", satUnidad: "H87", etiqueta: "letter",
};
async function leerEnvios(env) { const g = (await leerDoc(env, "envios-config"))?.valor || {}; return { ...ENVIOS_INICIAL, ...g, origen: { ...ENVIOS_INICIAL.origen, ...(g.origen || {}) } }; }

class ErrorEP extends Error {}
// El token a veces se pega con espacios, saltos de línea, comillas o con "Bearer " delante: se limpia antes de usarlo
const tokenEP = env => String(env.ENVIOSPERROS_TOKEN || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^(authorization:\s*)?bearer\s+/i, "").trim();
async function llamarEP(env, host, metodo, ruta, cuerpo) {
  if (!tokenEP(env)) throw new ErrorEP("Falta conectar Envíosperros: guarda el token ENVIOSPERROS_TOKEN en Cloudflare.");
  const r = await fetch(EP_URL[epEntorno(env, host)] + ruta, {
    method: metodo, headers: { authorization: `Bearer ${tokenEP(env)}`, accept: "application/json", "user-agent": "{{tienda.proyecto}}/1.0", ...(cuerpo ? { "content-type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(25000),
  });
  let d = null; try { d = await r.json(); } catch {}
  if (r.ok) return d;
  if (r.status === 401) throw new ErrorEP("Envíosperros rechazó el token. Revisa ENVIOSPERROS_TOKEN (el de pruebas y el de producción son distintos).");
  const detalle = d?.errors && typeof d.errors === "object" ? Object.values(d.errors).flat().filter(x => typeof x === "string").slice(0, 4).join(" · ") : "";
  const e = new ErrorEP((d?.message ? String(d.message) : `Envíosperros respondió ${r.status}`) + (detalle ? `: ${detalle}` : ""));
  e.status = r.status; throw e;
}
const numero = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null; };
function paqueteValido(p = {}) {
  const q = { depth: numero(p.largo, 1, 300), width: numero(p.ancho, 1, 300), height: numero(p.alto, 1, 300), weight: numero(p.peso, 0.1, 70) };
  if (Object.values(q).some(v => v == null)) throw new ErrorEP("Revisa las medidas (cm) y el peso (kg) del paquete.");
  return { type: "Box", ...q };
}
const cp5 = v => String(v || "").replace(/\D/g, "").padStart(5, "0").slice(-5);
const tel10 = v => String(v || "").replace(/\D/g, "").slice(-10);
// "Av. Juárez 123 int 4" → calle, número exterior e interior (se pueden corregir en el panel antes de generar la guía)
function separarCalle(calle) {
  const s = String(calle || "").trim();
  const m = s.match(/^(.*?)[\s,]+(?:#|n[oú]m?\.?\s*|n°\s*)?(\d+[a-z]?(?:-\d+[a-z]?)?)(?:[\s,]+(?:int\.?|interior|depto?\.?|departamento|#)\s*([\w-]+))?\s*$/i);
  return m ? { calle: m[1].replace(/[\s,#]+$/, ""), numExt: m[2], numInt: m[3] || "" } : { calle: s, numExt: "", numInt: "" };
}
const quitarAcentos = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(col|colonia|fracc|fraccionamiento)\b\.?/g, "").replace(/\s+/g, " ").trim();
function mejorColonia(lista, escrita) {
  const e = quitarAcentos(escrita); if (!e) return "";
  const hit = lista.find(x => quitarAcentos(x.neighborhood) === e) || lista.find(x => quitarAcentos(x.neighborhood).includes(e) || e.includes(quitarAcentos(x.neighborhood)));
  return hit?.neighborhood || "";
}
const coloniasDe = (env, host, cp) => llamarEP(env, host, "GET", `/v3/locations?zipCode=${encodeURIComponent(cp5(cp))}`);

// Datos para el formulario de guía del panel: dirección del cliente ya separada y colonias de su código postal
async function prepararGuia(env, host, p) {
  const c = p.cliente, partes = separarCalle(c.calle);
  let colonias = [], errorColonias = null;
  try { colonias = await coloniasDe(env, host, c.cp); } catch (e) { errorColonias = e.message; }
  return { destino: { nombre: c.nombre, tel: tel10(c.tel), ...partes, cp: cp5(c.cp), colonia: mejorColonia(colonias, c.colonia), coloniaEscrita: c.colonia, ciudad: c.ciudad, estado: c.estado, referencias: c.referencias || "" },
    colonias: colonias.map(x => x.neighborhood), errorColonias };
}
async function cotizarEnvio(env, host, p, paquete) {
  const cfg = await leerEnvios(env);
  const r = await llamarEP(env, host, "POST", "/v3/rates", { package: paqueteValido(paquete), originZipCode: cp5(cfg.origen.cp), destinationZipCode: cp5(p.cliente.cp) });
  return (Array.isArray(r) ? r : []).map(o => ({ paqueteria: o.details?.courier || "", servicio: o.details?.service || "", total: o.details?.total ?? null, entrega: o.details?.deliveryCommitment || "",
    recoleccion: !!o.details?.pickup, ocurre: !!o.details?.deliveryAtOffice, disponible: o.available !== false, nota: o.comment || "", resumen: o.summary || "" }))
    .sort((a, b) => (b.disponible - a.disponible) || ((a.total ?? 1e9) - (b.total ?? 1e9)));
}
function direccionEP(d, destino) {
  const t = (v, m) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, m);
  const o = { company: t(d.empresa, 60) || "Particular", name: t(d.nombre, 60), phone: tel10(d.tel), street: t(d.calle, 80), exteriorNumber: t(d.numExt, 15), zipCode: cp5(d.cp), neighborhood: t(d.colonia, 80) };
  if (t(d.numInt, 15)) o.interiorNumber = t(d.numInt, 15);
  if (t(d.email, 120)) o.email = t(d.email, 120);
  if (destino || t(d.referencias, 120)) o.references = t(d.referencias, 120) || "Sin referencias";
  const falta = [["name", "nombre"], ["phone", "teléfono de 10 dígitos"], ["street", "calle"], ["exteriorNumber", "número exterior"], ["neighborhood", "colonia"]].filter(([k]) => !o[k] || (k === "phone" && o.phone.length !== 10)).map(([, n]) => n);
  if (falta.length) throw new ErrorEP(`${destino ? "Destino" : "Origen (Envíos → dirección de envío)"}: falta ${falta.join(", ")}.`);
  return o;
}
// Genera la guía (se cobra del saldo de Envíosperros), la guarda en el pedido, lo marca como enviado y avisa al cliente
async function generarGuia(env, host, id, b) {
  const cfg = await leerEnvios(env), ahora = Date.now();
  let error = null;
  // Candado: evita dos guías para el mismo pedido (doble clic o dos pestañas)
  const bloqueado = await modificarPedido(env, id, p => {
    if (p.estado !== "pagado") { error = `El pedido está «${ESTADO_PEDIDO[p.estado]}»: solo se generan guías de pedidos pagados.`; return false; }
    if (p.etiqueta?.guia && !p.etiqueta.cancelada) { error = `Este pedido ya tiene la guía ${p.etiqueta.guia}.`; return false; }
    if (p.etiqueta?.enProceso && ahora - p.etiqueta.enProceso < 120e3) { error = "Ya se está generando una guía para este pedido. Espera un momento."; return false; }
    p.etiqueta = { ...(p.etiqueta?.guia ? { anterior: p.etiqueta } : {}), enProceso: ahora };
  });
  if (!bloqueado) throw new ErrorEP("Pedido no encontrado.");
  if (error) throw new ErrorEP(error);
  const liberar = () => modificarPedido(env, id, p => { if (p.etiqueta?.enProceso === ahora) { const { anterior } = p.etiqueta; p.etiqueta = anterior || null; } else return false; });
  let r, cuerpo;
  try {
    const paquete = paqueteValido(b.paquete);
    cuerpo = { courier: String(b.paqueteria || "").slice(0, 40), service: String(b.servicio || "").slice(0, 40),
      origin: direccionEP(cfg.origen, false), destination: direccionEP({ ...b.destino, empresa: "Particular", cp: bloqueado.cliente.cp }, true),
      package: { ...paquete, description: String(cfg.descripcion || "Artículos deportivos").slice(0, 60), ...(cfg.satProducto ? { satProductCode: cfg.satProducto, satUnitCode: cfg.satUnidad || "H87" } : {}) } };
    if (!cuerpo.courier || !cuerpo.service) throw new ErrorEP("Elige una paquetería de la cotización.");
    r = await llamarEP(env, host, "POST", "/v3/labels", cuerpo);
    if (!r?.trackingNumber) throw new ErrorEP("Envíosperros no devolvió el número de guía. Revisa en su plataforma antes de reintentar.");
  } catch (e) { await liberar(); throw e; }
  const etiqueta = { proveedor: "enviosperros", entorno: epEntorno(env, host), guia: String(r.trackingNumber), paqueteria: cuerpo.courier, servicio: cuerpo.service, costo: r.shippingTotal ?? r.total ?? null,
    creado: new Date().toISOString(), paquete: { largo: cuerpo.package.depth, ancho: cuerpo.package.width, alto: cuerpo.package.height, peso: cuerpo.package.weight },
    destino: { calle: cuerpo.destination.street, numExt: cuerpo.destination.exteriorNumber, numInt: cuerpo.destination.interiorNumber || "", colonia: cuerpo.destination.neighborhood } };
  const p = await modificarPedido(env, id, q => {
    q.etiqueta = etiqueta; q.guia = etiqueta.guia; q.paqueteria = `${etiqueta.paqueteria} ${etiqueta.servicio}`.trim(); q.estado = "enviado"; q.alerta = false;
    q.historial.push({ fecha: etiqueta.creado, estado: "enviado", nota: `🏷️ Guía ${etiqueta.paqueteria} ${etiqueta.servicio} ${etiqueta.guia} generada en Envíosperros${etiqueta.costo != null ? ` (${pesos(etiqueta.costo)})` : ""}${etiqueta.entorno === "staging" ? " · PRUEBA" : ""}` });
  });
  const c = await correoEnviado(env, p);
  await modificarPedido(env, id, q => { q.historial.push({ fecha: new Date().toISOString(), estado: q.estado, nota: c.id ? `✉️ Correo de envío (guía) enviado a ${q.cliente.email}` : `⚠️ No se envió el correo de envío (${c.error || c.omitido})` }); });
  return { pedido: p, correo: c.id ? "enviado" : (c.error || c.omitido) };
}
async function cancelarGuia(env, host, id) {
  const p0 = await leerPedido(env, id);
  if (!p0?.etiqueta?.guia || p0.etiqueta.cancelada) throw new ErrorEP("Este pedido no tiene una guía activa de Envíosperros.");
  if (p0.estado === "entregado") throw new ErrorEP("El pedido ya se entregó: la guía no se puede cancelar.");
  const r = await llamarEP(env, host, "DELETE", "/v3/labels", { trackingNumbers: [p0.etiqueta.guia] });
  const c = (r?.cancelations || [])[0], err = r?.errors && Object.values(r.errors).flat().filter(x => typeof x === "string").join(" · ");
  if (!c) throw new ErrorEP(err || "Envíosperros no confirmó la cancelación. Revisa en su plataforma.");
  return modificarPedido(env, id, p => {
    p.etiqueta = { ...p.etiqueta, cancelada: new Date().toISOString(), cancelacion: { estado: c.status || "", dias: c.daysRemaining ?? null } };
    p.guia = ""; p.paqueteria = ""; if (p.estado === "enviado") p.estado = "pagado";
    p.historial.push({ fecha: new Date().toISOString(), estado: p.estado, nota: `🚫 Guía ${p0.etiqueta.guia} cancelada en Envíosperros (${c.status || "solicitada"}). El saldo se reembolsa${c.daysRemaining != null ? ` en ~${c.daysRemaining} días` : ""}.` });
  });
}
const RASTREO_TXT = { created: "Guía creada", documented: "Documentado", traveling: "En camino", drop_off: "Recibido en sucursal", delivering: "En reparto", delivered: "Entregado",
  return: "En devolución", canceled: "Cancelado", interrupted: "Interrumpido", attempted: "Intento de entrega", inaccessible: "Domicilio inaccesible", delayed: "Retrasado", confiscated: "Retenido", unknown: "Sin información" };
const RASTREO_ALERTA = new Set(["return", "canceled", "interrupted", "attempted", "inaccessible", "confiscated"]);
// Consulta el rastreo de un pedido enviado; si ya se entregó lo marca como entregado
async function rastrearPedido(env, host, id, forzar = false) {
  const p0 = await leerPedido(env, id), e0 = p0?.etiqueta;
  if (!e0?.guia || e0.cancelada || !["enviado", "entregado"].includes(p0.estado)) return p0;
  if (!forzar && e0.rastreo?.consultado && Date.now() - Date.parse(e0.rastreo.consultado) < 2 * 3600e3) return p0;
  let d;
  try { d = await llamarEP(env, host, "GET", `/v3/labels/${encodeURIComponent(e0.guia)}/tracking`); }
  catch (e) {
    if (e.status !== 404 && e.status !== 503) throw e;   // 404: la paquetería aún no registra movimientos
    return modificarPedido(env, id, p => { p.etiqueta = { ...p.etiqueta, rastreo: { ...(p.etiqueta.rastreo || {}), consultado: new Date().toISOString() } }; });
  }
  const st = d?.status || {}, codigo = String(st.code || "unknown");
  const rastreo = { codigo, texto: st.label || RASTREO_TXT[codigo] || codigo, descripcion: st.description || "", estimada: d.estimated_delivery_date || null, ciudad: d.current_location?.city || "",
    consultado: new Date().toISOString(),
    eventos: (d.events || []).slice(-12).map(ev => ({ fecha: ev.occurred_at || "", codigo: ev.status?.code || "", texto: ev.status?.label || RASTREO_TXT[ev.status?.code] || "", ciudad: ev.location?.city || "" })) };
  return modificarPedido(env, id, p => {
    const antes = p.etiqueta.rastreo?.codigo;
    p.etiqueta = { ...p.etiqueta, rastreo };
    if (codigo !== antes) {
      if (codigo === "delivered" && p.estado === "enviado") { p.estado = "entregado"; p.historial.push({ fecha: rastreo.consultado, estado: "entregado", nota: `📬 Entregado según ${p.etiqueta.paqueteria}${rastreo.ciudad ? ` (${rastreo.ciudad})` : ""}` }); }
      else if (RASTREO_ALERTA.has(codigo)) { p.alerta = true; p.historial.push({ fecha: rastreo.consultado, estado: p.estado, nota: `⚠️ Rastreo: ${rastreo.texto}${rastreo.descripcion ? ` — ${rastreo.descripcion}` : ""}` }); }
    }
  });
}
// Revisa los pedidos enviados (lo llaman el panel, la tarea programada y la página del pedido)
async function sincronizarEnvios(env, host, max = 15) {
  if (!env.ENVIOSPERROS_TOKEN) return { revisados: 0 };
  const { results } = await env.DB.prepare("SELECT id FROM pedidos WHERE estado = 'enviado' ORDER BY creado LIMIT 60").all();
  let revisados = 0, entregados = 0;
  for (const { id } of results) {
    if (revisados >= max) break;
    const p = await leerPedido(env, id);
    if (!p?.etiqueta?.guia || p.etiqueta.cancelada) continue;
    if (p.etiqueta.rastreo?.consultado && Date.now() - Date.parse(p.etiqueta.rastreo.consultado) < 2 * 3600e3) continue;
    revisados++;
    try { const q = await rastrearPedido(env, host, id, true); if (q?.estado === "entregado") entregados++; } catch (e) { console.error("Rastreo", id, String(e.message || e)); }
  }
  return { revisados, entregados };
}
// Rutas del panel: /admin/api/envios/…
async function apiEnvios(request, env, url, ruta, ctx) {
  const host = url.hostname;
  let b = {}; if (request.method !== "GET") { try { b = await request.json(); } catch {} }
  try {
    if (ruta === "/envios/config" && request.method === "GET") { const t = tokenEP(env); return json({ config: await leerEnvios(env), conectado: !!t, entorno: epEntorno(env, host), token: t ? { largo: t.length, final: t.slice(-4), limpiado: t !== String(env.ENVIOSPERROS_TOKEN) } : null }); }
    if (ruta === "/envios/config" && request.method === "PUT") {
      const t = (v, m) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, m), o = b.origen || {};
      const paquetes = (Array.isArray(b.paquetes) ? b.paquetes : []).slice(0, 8).map(q => ({ nombre: t(q.nombre, 40), largo: numero(q.largo, 1, 300), ancho: numero(q.ancho, 1, 300), alto: numero(q.alto, 1, 300), peso: numero(q.peso, 0.1, 70) }))
        .filter(q => q.nombre && q.largo && q.ancho && q.alto && q.peso);
      if (!paquetes.length) return json({ error: "Agrega al menos un paquete con medidas y peso." }, 400);
      const cfg = { origen: { empresa: t(o.empresa, 60), nombre: t(o.nombre, 60), tel: tel10(o.tel), email: t(o.email, 120), calle: t(o.calle, 80), numExt: t(o.numExt, 15), numInt: t(o.numInt, 15), cp: cp5(o.cp), colonia: t(o.colonia, 80), referencias: t(o.referencias, 120) },
        paquetes, descripcion: t(b.descripcion, 60) || "Artículos deportivos", satProducto: t(b.satProducto, 8).replace(/\D/g, ""), satUnidad: t(b.satUnidad, 4).toUpperCase() || "H87", etiqueta: b.etiqueta === "thermal" ? "thermal" : "letter" };
      await modificarDoc(env, "envios-config", () => ({}), () => cfg);
      return json({ ok: true, config: cfg });
    }
    // Costos de referencia para el precio: Monterrey → tu almacén y tu almacén → clientes (promedio CDMX, Monterrey y Mérida), por tipo de paquete
    if (ruta === "/envios/cotizar-ref" && request.method === "POST") {
      const cfg = await leerEnvios(env), origen = cp5(cfg.origen.cp || "{{tienda.direccion.cp}}");
      const caja = cfg.paquetes[0] || { largo: 50, ancho: 30, alto: 8, peso: 1.2 };
      const paquetes = Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.paquete || caja]));   // tienda.json → categorias.<cat>.paquete
      const masBarata = async (de, a, paq) => { const ops = await llamarEP(env, host, "POST", "/v3/rates", { package: paqueteValido(paq), originZipCode: de, destinationZipCode: a });
        const t = (ops || []).filter(o => o.available !== false && o.details?.total).map(o => o.details.total); return t.length ? Math.min(...t) : null; };
      const mtyGdl = {}, cliente = {};
      // Monterrey → Guadalajara: la caja de importación (llega así a Monterrey); Guadalajara → cliente: el paquete de cada categoría
      const ci = b.cajaImport || {}, cajaImp = { largo: Number(ci.largo) || 61, ancho: Number(ci.ancho) || 31, alto: Number(ci.alto) || 39, peso: Number(ci.peso) || 3 };
      const mty = Math.ceil((await masBarata("64000", origen, cajaImp)) || 0) || null;
      for (const [k, paq] of Object.entries(paquetes)) {
        mtyGdl[k] = mty;
        const dest = (await Promise.all(["06600", "64000", "97000"].map(d => masBarata(origen, d, paq).catch(() => null)))).filter(Boolean);
        cliente[k] = dest.length ? Math.ceil(dest.reduce((a, b) => a + b, 0) / dest.length) : null;
      }
      return json({ mtyGdl, cliente, nota: "Tarifas más baratas disponibles hoy en tu cuenta (cliente: promedio a CDMX, Monterrey y Mérida). Revísalas y ajusta si quieres." });
    }
    if (ruta === "/envios/saldo") return json(await llamarEP(env, host, "GET", "/v3/balance"));
    if (ruta === "/envios/colonias") { const l = await coloniasDe(env, host, url.searchParams.get("cp")); return json({ colonias: l.map(x => x.neighborhood), ciudad: l[0]?.city || "", estado: l[0]?.state || "" }); }
    if (ruta === "/envios/preparar") { const p = await leerPedido(env, url.searchParams.get("id")); if (!p) return json({ error: "No encontrado." }, 404); return json(await prepararGuia(env, host, p)); }
    if (ruta === "/envios/cotizar" && request.method === "POST") { const p = await leerPedido(env, b.id); if (!p) return json({ error: "No encontrado." }, 404); return json({ opciones: await cotizarEnvio(env, host, p, b.paquete) }); }
    if (ruta === "/envios/guia" && request.method === "POST") return json({ ok: true, ...(await generarGuia(env, host, String(b.id || ""), b)) });
    if (ruta === "/envios/cancelar" && request.method === "POST") return json({ ok: true, pedido: await cancelarGuia(env, host, String(b.id || "")) });
    if (ruta === "/envios/rastrear" && request.method === "POST") return json({ ok: true, pedido: await rastrearPedido(env, host, String(b.id || ""), true) });
    if (ruta === "/envios/etiqueta") {
      const p = await leerPedido(env, url.searchParams.get("id"));
      if (!p?.etiqueta?.guia) return json({ error: "Este pedido no tiene guía." }, 404);
      const tam = url.searchParams.get("tam") === "thermal" ? "thermal" : url.searchParams.get("tam") === "letter" ? "letter" : (await leerEnvios(env)).etiqueta;
      const d = await llamarEP(env, host, "GET", `/v3/labels/${encodeURIComponent(p.etiqueta.guia)}/download?documentSize=${tam}`);
      const pdf = Uint8Array.from(atob(String(d?.document || "")), ch => ch.charCodeAt(0));
      if (pdf.length < 100) return json({ error: "Envíosperros no devolvió la etiqueta. Intenta de nuevo en un momento." }, 502);
      return new Response(pdf, { headers: { ...SEGURIDAD, "content-type": "application/pdf", "content-disposition": `inline; filename="guia-${p.id}-${p.etiqueta.guia}.pdf"`, "cache-control": "no-store" } });
    }
    return json({ error: "No encontrado." }, 404);
  } catch (e) {
    if (e instanceof ErrorEP) return json({ error: e.message }, e.status === 401 || e.status === 403 ? 502 : 400);
    console.error("Envíos", ruta, String(e.message || e));
    return json({ error: "Error al hablar con Envíosperros: " + String(e.message || e).slice(0, 160) }, 502);
  }
}
