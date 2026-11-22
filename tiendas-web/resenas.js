// ---------- Reseñas: correo después de la entrega, página para opinar, moderación y publicación ----------
// Flujo: la tarea programada (cada hora) busca pedidos «Entregado» con más de N días y manda UN correo pidiendo opinión.
// El cliente elige estrellas en el correo → /resena (página de la tienda) → la reseña queda «pendiente» → se publica desde el panel
// (o sola, si así se configura) → aparece en la página del producto con su promedio y en los datos estructurados para Google.
const RESENAS_INICIAL = { activo: true, dias: 3, autoPublicar: false };
async function leerConfigResenas(env) { return { ...RESENAS_INICIAL, ...((await leerDoc(env, "resenas-config"))?.valor || {}) }; }
const autorResena = nombre => { const [n, a] = String(nombre || "").trim().split(/\s+/); return n ? `${n.slice(0, 20)}${a ? " " + a[0].toUpperCase() + "." : ""}` : "Cliente"; };
const estrellasTxt = n => "★".repeat(n) + "☆".repeat(5 - n);
const fechaEntrega = p => [...(p.historial || [])].reverse().find(h => h.estado === "entregado")?.fecha || null;

// Correo con un renglón de estrellas por producto (cada estrella es un enlace a la página de la reseña)
async function correoResena(env, p) {
  const sitio = sitioDe(p), productos = [...new Map(p.lineas.map(l => [l.id, l])).values()].slice(0, 4);
  const enlace = (l, e) => `${sitio}/resena?p=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.resena.token)}&prod=${encodeURIComponent(l.id)}&e=${e}`;
  const filas = productos.map(l => `<tr><td style="padding:14px 0;border-bottom:1px solid #eee">
      <p style="margin:0 0 8px;font-weight:700">${escHtml(l.nombre)}</p>
      <p style="margin:0;font-size:30px;letter-spacing:4px;line-height:1">${[1, 2, 3, 4, 5].map(e => `<a href="${enlace(l, e)}" title="${e} de 5" style="color:#f5b301;text-decoration:none">★</a>`).join("")}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#667085">Toca las estrellas: 1 = no me gustó · 5 = excelente</p></td></tr>`).join("");
  const nombre = String(p.cliente.nombre || "").split(" ")[0];
  const html = plantillaCorreo("¿Qué tal tu compra?", `<h1 style="margin:0 0 8px;font-size:22px">¿Qué tal tu compra, ${escHtml(nombre)}? {{tienda.emoji}}</h1>
    <p style="margin:0 0 6px;color:#475467">Tu pedido <b>${escHtml(p.id)}</b> ya llegó. Tu opinión ayuda a otros jugadores a elegir y a nosotros a mejorar. Te toma 30 segundos.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%">${filas}</table>
    <p style="margin:16px 0 0;font-size:13px;color:#667085">Si algo no salió bien, responde este correo y lo resolvemos. Solo te lo pedimos una vez.</p>`, sitio);
  const texto = `¿Qué tal tu compra? Califica tu pedido ${p.id}:\n` + productos.map(l => `${l.nombre}: ${enlace(l, 5)}`).join("\n");
  return enviarCorreo(env, { para: p.cliente.email, asunto: `¿Qué tal tu ${productos.length === 1 ? productos[0].nombre : "compra"}? · {{tienda.nombre}}`, html, texto, clave: `resena-${p.id}` });
}

// Llamada desde la tarea programada: pide reseña a los pedidos entregados hace más de N días (una sola vez por pedido)
async function solicitarResenas(env, max = 10) {
  const cfg = await leerConfigResenas(env);
  if (!cfg.activo || !env.RESEND_API_KEY) return { enviados: 0 };
  const { results } = await env.DB.prepare("SELECT id FROM pedidos WHERE estado = 'entregado' ORDER BY creado DESC LIMIT 60").all();
  let enviados = 0;
  for (const { id } of results) {
    if (enviados >= max) break;
    const p0 = await leerPedido(env, id);
    if (!p0 || p0.resena?.solicitada) continue;
    const ent = fechaEntrega(p0);
    if (!ent || Date.now() - Date.parse(ent) < cfg.dias * 864e5) continue;
    if (Date.now() - Date.parse(ent) > 60 * 864e5) { await modificarPedido(env, id, p => { p.resena = { omitida: "entregado hace más de 60 días" }; }); continue; }
    const p = await modificarPedido(env, id, q => { if (q.resena?.solicitada) return false; q.resena = { token: aleatorio(20, "abcdefghijkmnpqrstuvwxyz23456789"), solicitada: new Date().toISOString() }; });
    if (!p?.resena?.token) continue;
    const r = await correoResena(env, p);
    await modificarPedido(env, id, q => { q.historial.push({ fecha: new Date().toISOString(), estado: q.estado, nota: r.id ? "⭐ Se pidió su opinión por correo" : `⚠️ No se envió el correo de reseña (${r.error || r.omitido})` }); });
    if (r.id) enviados++;
  }
  return { enviados };
}

// Reseñas publicadas, agrupadas por producto (se guardan en un documento para no consultar la tabla en cada visita)
async function recalcularResenasPublicadas(env) {
  const { results } = await env.DB.prepare("SELECT producto, estrellas, texto, autor, ciudad, creado FROM resenas WHERE estado = 'publicada' ORDER BY creado DESC").all();
  const m = {};
  for (const r of results) {
    const x = m[r.producto] ||= { n: 0, suma: 0, ultimas: [] };
    x.n++; x.suma += r.estrellas;
    if (x.ultimas.length < 10) x.ultimas.push({ e: r.estrellas, t: r.texto || "", a: r.autor, c: r.ciudad || "", f: r.creado.slice(0, 10) });
  }
  await modificarDoc(env, "resenas-publicadas", () => ({}), () => m);
  return m;
}
let RESENAS_MEMO = { version: -1, valor: {} };
async function resenasMemo(env) {
  const d = await leerDoc(env, "resenas-publicadas");
  if (!d) return {};
  if (RESENAS_MEMO.version !== d.version) RESENAS_MEMO = { version: d.version, valor: d.valor || {} };
  return RESENAS_MEMO.valor;
}

// Página /resena (la que abre el enlace del correo) y su envío
async function validarEnlaceResena(env, pid, token, prod) {
  const p = await leerPedido(env, pid);
  if (!p?.resena?.token || !igual(p.resena.token, String(token || ""))) return { error: "Este enlace no es válido. Revisa el correo más reciente de {{tienda.nombre}}." };
  const linea = p.lineas.find(l => l.id === prod);
  if (!linea) return { error: "Ese producto no está en tu pedido." };
  return { p, linea };
}
function seccionResena(contenido) {
  return `<section class="contenedor resena-pagina">${contenido}</section>`;
}
async function paginaResena(request, env, url, base) {
  const pid = url.searchParams.get("p") || "", token = url.searchParams.get("t") || "", prod = url.searchParams.get("prod") || "";
  const ini = Math.min(5, Math.max(0, parseInt(url.searchParams.get("e"), 10) || 0));
  const v = await validarEnlaceResena(env, pid, token, prod);
  const previa = v.p ? await env.DB.prepare("SELECT estrellas, texto, autor, estado FROM resenas WHERE pedido = ? AND producto = ?").bind(pid, prod).first() : null;
  let cuerpo;
  if (v.error) cuerpo = `<h1>Opinión de tu compra</h1><p>${escHtml(v.error)}</p><p><a class="btn" href="/">Ir a la tienda</a></p>`;
  else if (previa && previa.estado !== "pendiente") cuerpo = `<h1>¡Gracias por tu opinión!</h1><p>Ya recibimos tu reseña de <b>${escHtml(v.linea.nombre)}</b>.</p><p><a class="btn" href="/productos/${encodeURIComponent(prod)}">Ver el producto</a></p>`;
  else {
    const e = previa?.estrellas || ini, otras = [...new Map(v.p.lineas.filter(l => l.id !== prod).map(l => [l.id, l])).values()];
    cuerpo = `<h1>¿Qué te pareció?</h1>
      <p class="resena-producto"><b>${escHtml(v.linea.nombre)}</b><br><span class="suave-txt">Pedido ${escHtml(pid)}</span></p>
      <form method="post" action="/resena" class="resena-form">
        <input type="hidden" name="p" value="${escHtml(pid)}"><input type="hidden" name="t" value="${escHtml(token)}"><input type="hidden" name="prod" value="${escHtml(prod)}">
        <fieldset class="estrellas"><legend>Tu calificación</legend>
          ${[5, 4, 3, 2, 1].map(n => `<input type="radio" id="e${n}" name="e" value="${n}" ${n === e ? "checked" : ""} required><label for="e${n}" title="${n} de 5"><span class="sr-only">${n} ${n === 1 ? "estrella" : "estrellas"}</span>★</label>`).join("")}
        </fieldset>
        <label>Cuéntanos más (opcional)<textarea name="texto" maxlength="1000" rows="4" placeholder="¿Cómo se siente en la pista? ¿Llegó bien y a tiempo?">${escHtml(previa?.texto || "")}</textarea></label>
        <label>Tu nombre como aparecerá<input name="autor" maxlength="30" value="${escHtml(previa?.autor || autorResena(v.p.cliente.nombre))}"></label>
        <p class="suave-txt">Publicamos tu nombre y la inicial de tu apellido, tu estado y tu opinión en la página del producto. Revisamos cada reseña antes de publicarla. <a href="/privacidad" target="_blank" rel="noopener">Aviso de privacidad</a></p>
        <button class="btn">Enviar mi opinión</button>
      </form>
      ${otras.length ? `<p class="suave-txt">También puedes calificar: ${otras.map(l => `<a href="/resena?p=${encodeURIComponent(pid)}&t=${encodeURIComponent(token)}&prod=${encodeURIComponent(l.id)}">${escHtml(l.nombre)}</a>`).join(" · ")}</p>` : ""}`;
  }
  return html(aplicarSeo(base.html, { titulo: "Tu opinión | {{tienda.nombre}}", desc: "Califica tu compra en {{tienda.nombre}}.", ruta: "resena", hero: false, ssr: seccionResena(cuerpo),
    chips: "", grid: "", head: cabeceraSeo({ titulo: "Tu opinión | {{tienda.nombre}}", desc: "Califica tu compra en {{tienda.nombre}}.", url: "/resena", noindex: true }) }), { "x-robots-tag": "noindex", "cache-control": "no-store" }, base.html);
}
async function guardarResena(request, env, url, base, ctx) {
  if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido." }, 403);
  const k = "resena:" + ipDe(request);
  if (await excedido(env, k, 20)) return json({ error: "Demasiados intentos. Intenta más tarde." }, 429);
  await sumarIntento(env, k, 3600);
  let f; try { f = await request.formData(); } catch { return json({ error: "Formulario inválido." }, 400); }
  const pid = String(f.get("p") || ""), token = String(f.get("t") || ""), prod = String(f.get("prod") || "");
  const v = await validarEnlaceResena(env, pid, token, prod);
  const volver = msg => html(aplicarSeo(base.html, { titulo: "Tu opinión | {{tienda.nombre}}", desc: "Califica tu compra en {{tienda.nombre}}.", ruta: "resena", hero: false, chips: "", grid: "",
    ssr: seccionResena(msg), head: cabeceraSeo({ titulo: "Tu opinión | {{tienda.nombre}}", desc: "Califica tu compra en {{tienda.nombre}}.", url: "/resena", noindex: true }) }), { "x-robots-tag": "noindex", "cache-control": "no-store" }, base.html);
  if (v.error) return volver(`<h1>Opinión de tu compra</h1><p>${escHtml(v.error)}</p>`);
  const estrellas = parseInt(f.get("e"), 10);
  if (!(estrellas >= 1 && estrellas <= 5)) return volver(`<h1>Falta tu calificación</h1><p>Elige de 1 a 5 estrellas.</p><p><a class="btn" href="/resena?p=${encodeURIComponent(pid)}&t=${encodeURIComponent(token)}&prod=${encodeURIComponent(prod)}">Volver</a></p>`);
  const texto = String(f.get("texto") || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const autor = String(f.get("autor") || "").replace(/\s+/g, " ").trim().slice(0, 30) || autorResena(v.p.cliente.nombre);
  const cfg = await leerConfigResenas(env), ahora = new Date().toISOString();
  const auto = cfg.autoPublicar && estrellas >= 4 && !/https?:|www\.|@/i.test(texto);
  const r = await env.DB.prepare(`INSERT INTO resenas (pedido, producto, nombre_producto, estrellas, texto, autor, ciudad, email, creado, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pedido, producto) DO UPDATE SET estrellas = excluded.estrellas, texto = excluded.texto, autor = excluded.autor, creado = excluded.creado, estado = excluded.estado WHERE resenas.estado = 'pendiente'`)
    .bind(pid, prod, v.linea.nombre, estrellas, texto, autor, v.p.cliente.estado || "", v.p.cliente.email, ahora, auto ? "publicada" : "pendiente").run();
  if (r.meta?.changes) {
    if (auto) await recalcularResenasPublicadas(env);
    ctx?.waitUntil?.(correoAlerta(env, `⭐ Nueva reseña (${estrellas}/5)${auto ? "" : " por revisar"}`, [`<b>${escHtml(v.linea.nombre)}</b> · ${estrellasTxt(estrellas)}`, texto ? `«${escHtml(texto)}»` : "<i>Sin comentario</i>",
      `${escHtml(autor)} · pedido ${escHtml(pid)}`, auto ? "Se publicó sola (4 o 5 estrellas)." : "Publícala u ocúltala en el panel → ⭐ Reseñas."]).catch(() => {}));
  }
  const otras = [...new Map(v.p.lineas.filter(l => l.id !== prod).map(l => [l.id, l])).values()];
  return volver(`<h1>¡Gracias por tu opinión! ⭐</h1><p>Recibimos tu reseña de <b>${escHtml(v.linea.nombre)}</b>${auto ? " y ya está publicada" : ". La publicamos en cuanto la revisemos"}.</p>
    ${estrellas <= 3 ? `<p>Lamentamos que no fuera perfecto. Si quieres, escríbenos a <a href="mailto:{{tienda.correo.contacto}}">{{tienda.correo.contacto}}</a> y lo resolvemos.</p>` : ""}
    ${otras.length ? `<p>¿Calificas también ${otras.map(l => `<a href="/resena?p=${encodeURIComponent(pid)}&t=${encodeURIComponent(token)}&prod=${encodeURIComponent(l.id)}">${escHtml(l.nombre)}</a>`).join(" · ")}?</p>` : ""}
    <p><a class="btn" href="/">Seguir viendo la tienda</a></p>`);
}

// Rutas del panel: /admin/api/resenas…
async function apiResenas(request, env, ruta) {
  if (ruta === "/resenas" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, pedido, producto, nombre_producto AS nombreProducto, estrellas, texto, autor, ciudad, creado, estado FROM resenas ORDER BY creado DESC LIMIT 300").all();
    const { results: sol } = await env.DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'entregado' AND json_extract(datos, '$.resena.solicitada') IS NOT NULL").all();
    return json({ resenas: results, config: await leerConfigResenas(env), solicitadas: sol[0]?.n || 0 });
  }
  if (ruta === "/resenas" && request.method === "PATCH") {
    let b = {}; try { b = await request.json(); } catch {}
    if (!["publicada", "oculta", "pendiente"].includes(b.estado)) return json({ error: "Estado inválido." }, 400);
    const r = await env.DB.prepare("UPDATE resenas SET estado = ? WHERE id = ?").bind(b.estado, Number(b.id) || 0).run();
    if (!r.meta?.changes) return json({ error: "No encontrada." }, 404);
    await recalcularResenasPublicadas(env);
    return json({ ok: true });
  }
  if (ruta === "/resenas/config" && request.method === "PUT") {
    let b = {}; try { b = await request.json(); } catch {}
    const cfg = { activo: b.activo === true, dias: Math.min(30, Math.max(1, Math.round(Number(b.dias) || 3))), autoPublicar: b.autoPublicar === true };
    await modificarDoc(env, "resenas-config", () => ({}), () => cfg);
    return json({ ok: true, config: cfg });
  }
  return json({ error: "No encontrado." }, 404);
}
