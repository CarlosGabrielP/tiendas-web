// ---------- Tareas programadas: respaldo diario, conciliación de pagos y alertas ----------
// Las ejecuta el Worker "{{tienda.proyecto}}-tareas" (cron) llamando a POST /api/interno/tareas con el secreto TAREAS_TOKEN
// en la cabecera x-{{tienda.clave}}-tareas.
// Todo se avisa a AVISOS_A ({{tienda.correo.contacto}}) por Resend. Cada alerta se manda una sola vez (estado en "tareas-estado").
const DIAS_RESPALDO = 30;
const horaMX = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONA, hour: "numeric", hourCycle: "h23" }).format(new Date()));
const fechaHoraMX = (d = new Date()) => new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, dateStyle: "medium", timeStyle: "short" }).format(d);

async function correoAlerta(env, asunto, lineas, boton = true) {
  const html = plantillaCorreo(asunto, `<h1 style="margin:0 0 12px;font-size:20px">${escHtml(asunto)}</h1>
    ${lineas.map(l => `<p style="margin:0 0 10px;color:#344054;font-size:14px;line-height:1.5">${l}</p>`).join("")}
    ${boton ? `<p style="margin:18px 0 0"><a href="{{tienda.sitio}}/admin" style="display:inline-block;background:#0b0f1a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Abrir el panel</a></p>` : ""}`, "{{tienda.sitio}}");
  return enviarCorreo(env, { para: AVISOS_A, asunto: `${asunto} · {{tienda.nombre}}`, html, texto: lineas.map(l => l.replace(/<[^>]+>/g, "")).join("\n"), clave: `alerta-${asunto}-${Date.now()}` });
}

// Aviso inmediato de cada acceso al panel (si no fuiste tú, cambia ADMIN_PASSWORD y revisa la verificación en 2 pasos)
async function avisoAccesoPanel(env, request, tipo) {
  const cf = request.cf || {};
  const lugar = [cf.city, cf.region, cf.country].filter(Boolean).join(", ") || "desconocido";
  const nav = (request.headers.get("user-agent") || "").slice(0, 160);
  return correoAlerta(env, tipo === "alta" ? "🔐 Alta de verificación en 2 pasos en el panel" : "🔐 Nuevo acceso al panel", [
    `Fecha: <b>${escHtml(fechaHoraMX())}</b>`,
    `Lugar aproximado: <b>${escHtml(lugar)}</b> · IP ${escHtml(ipDe(request))}`,
    `Navegador: ${escHtml(nav)}`,
    "Si no fuiste tú: cambia de inmediato la contraseña del panel (ADMIN_PASSWORD en Cloudflare). Al cambiarla se cierran todas las sesiones abiertas.",
  ]);
}

// Respaldo diario en KV (30 días): documentos, pedidos, premios y jugadores. Sin la clave secreta de la verificación en 2 pasos.
async function hacerRespaldo(env) {
  const fecha = hoyMX();
  const [datos, pedidos, premios, jugadores] = await Promise.all([
    env.DB.prepare("SELECT clave, valor, version, actualizado FROM datos WHERE clave NOT IN ('admin-2fa', 'catalogo:anterior')").all(),
    env.DB.prepare("SELECT id, creado, estado, datos FROM pedidos").all(),
    env.DB.prepare("SELECT * FROM premios").all(),
    env.DB.prepare("SELECT token, nombre, email, email_envio, tel, creado, promos, verificado FROM jugadores").all(),
  ]);
  // Los valores ya vienen como texto JSON: se concatenan sin volver a interpretarlos (ahorra CPU)
  const partes = [`{"tienda":"{{tienda.clave}}","fecha":${JSON.stringify(fecha)},"creado":${JSON.stringify(new Date().toISOString())},"datos":{`];
  partes.push(datos.results.map(r => `${JSON.stringify(r.clave)}:${r.valor}`).join(","));
  partes.push(`},"pedidos":[${pedidos.results.map(r => r.datos).join(",")}],"premios":${JSON.stringify(premios.results)},"jugadores":${JSON.stringify(jugadores.results)}}`);
  const contenido = partes.join("");
  await env.CATALOGO.put(`respaldo:${fecha}`, contenido, { expirationTtl: (DIAS_RESPALDO + 2) * 86400,
    metadata: { fecha, bytes: contenido.length, pedidos: pedidos.results.length, productos: (() => { const c = datos.results.find(r => r.clave === "catalogo"); try { return JSON.parse(c?.valor || "{}").productos?.length || 0; } catch { return 0; } })() } });
  return { fecha, bytes: contenido.length, pedidos: pedidos.results.length };
}

// Pagos que Mercado Pago aprobó pero cuyo aviso no llegó: se consultan los pedidos sin pagar de los últimos 3 días
async function conciliarPagos(env) {
  if (!env.MP_ACCESS_TOKEN) return [];
  const desde = new Date(Date.now() - 3 * 864e5).toISOString(), hasta = new Date(Date.now() - 10 * 60e3).toISOString();
  const { results } = await env.DB.prepare("SELECT id, estado FROM pedidos WHERE estado IN ('pendiente_pago', 'pago_pendiente') AND creado BETWEEN ? AND ? ORDER BY creado DESC LIMIT 12").bind(desde, hasta).all();
  const corregidos = [];
  for (const r of results) {
    try {
      const pago = await consultarPagoMP(env, r.id);
      if (!pago) continue;
      await aplicarPago(env, pago);
      const ahora = await leerPedido(env, r.id);
      if (ahora && ahora.estado !== r.estado) corregidos.push(`${r.id}: ${ESTADO_PEDIDO[r.estado]} → <b>${ESTADO_PEDIDO[ahora.estado]}</b>`);
    } catch (e) { console.error("Conciliación", r.id, String(e.message || e)); }
  }
  return corregidos;
}

async function tareasProgramadas(request, env) {
  // Cabecera propia (no "authorization", que en el sitio de pruebas ya usa la contraseña del sitio)
  const token = request.headers.get("x-{{tienda.clave}}-tareas") || "";
  if (!env.TAREAS_TOKEN || !igual(token, env.TAREAS_TOKEN)) return json({ error: "No encontrado." }, 404);
  let b = {}; try { b = await request.json(); } catch {}
  const hoy = hoyMX(), hora = horaMX(), hecho = {};
  const estado = (await leerDoc(env, "tareas-estado"))?.valor || {};
  const nuevo = { ...estado, avisos: { ...(estado.avisos || {}) } };
  const alertas = [];

  // 1) Respaldo: en la llamada de las 3 a. m. o si el último tiene más de 26 horas
  const venceRespaldo = !estado.respaldo || Date.now() - Date.parse(estado.respaldo.creado) > 26 * 3600e3;
  if (b.tarea === "respaldo" || venceRespaldo) {
    try { const r = await hacerRespaldo(env); nuevo.respaldo = { ...r, creado: new Date().toISOString() }; hecho.respaldo = r; }
    catch (e) {
      hecho.respaldo = { error: String(e.message || e) };
      if (nuevo.avisos.respaldo !== hoy) { nuevo.avisos.respaldo = hoy; alertas.push(["⚠️ Falló el respaldo diario", [`Error: ${escHtml(hecho.respaldo.error)}`, "La recuperación automática de Cloudflare (D1 Time Travel) sigue activa. Si se repite mañana, avísale a tu desarrollador."]]); }
    }
  }
  if (b.tarea !== "respaldo") {
    // 2) Pagos aprobados que no llegaron a la tienda
    const corregidos = await conciliarPagos(env);
    hecho.conciliados = corregidos.length;
    if (corregidos.length) alertas.push(["💳 Se corrigieron pagos que no habían llegado", ["Mercado Pago aprobó estos pagos, pero su aviso no llegó a la tienda. Ya quedaron registrados:", ...corregidos]]);

    // 3) Pedidos con alerta (sobreventa, monto distinto, código de premio repetido…) que aún no se avisaron
    const { results: conAlerta } = await env.DB.prepare("SELECT id, total, nombre FROM pedidos WHERE alerta = 1 ORDER BY creado DESC LIMIT 20").all();
    const avisadas = new Set(estado.alertasPedidos || []);
    const nuevas = conAlerta.filter(p => !avisadas.has(p.id));
    if (nuevas.length) alertas.push(["⚠️ Pedidos que requieren revisión", nuevas.map(p => `<b>${escHtml(p.id)}</b> · ${escHtml(p.nombre)} · ${pesos(p.total)}`).concat("Abre cada pedido en el panel para ver el detalle en su historial.")]);
    nuevo.alertasPedidos = conAlerta.map(p => p.id);

    // 4) Pedidos pagados sin atender por más de un día (un recordatorio diario, a las 9 a. m.)
    if (hora >= 9 && nuevo.avisos.porAtender !== hoy) {
      const { results: atrasados } = await env.DB.prepare("SELECT id, creado, total, nombre, con_pedido FROM pedidos WHERE estado = 'pagado' AND creado < ? ORDER BY creado LIMIT 30").bind(new Date(Date.now() - 864e5).toISOString()).all();
      nuevo.avisos.porAtender = hoy;
      if (atrasados.length) alertas.push([`📦 ${atrasados.length} pedido(s) pagado(s) por enviar`, atrasados.map(p => `<b>${escHtml(p.id)}</b> · ${escHtml(p.nombre)} · ${pesos(p.total)} · pagado el ${escHtml(fechaHoraMX(new Date(p.creado)))}${p.con_pedido ? " · 📦 bajo pedido" : ""}`)]);
    }

    // 5) Muchos intentos fallidos de entrar al panel (la hora anterior)
    const horaAnterior = new Date(Date.now() - 3600e3).toISOString().slice(0, 13);
    if (nuevo.avisos.login !== horaAnterior) {
      const r = await env.DB.prepare("SELECT n FROM intentos WHERE clave = ?").bind("panel-fallidos:" + horaAnterior).first();
      nuevo.avisos.login = horaAnterior;
      if ((r?.n || 0) >= 10) alertas.push(["🚨 Muchos intentos fallidos de entrar al panel", [`En la última hora hubo <b>${r.n}</b> intentos fallidos (contraseña o código equivocados).`, "Tu panel sigue protegido por el límite de intentos y la verificación en 2 pasos. Si no fuiste tú, considera cambiar la contraseña del panel."]]);
    }

    // 6) Avisos de pago con firma falsa (posible intento de fraude)
    const firmas = (await env.DB.prepare("SELECT n FROM intentos WHERE clave = ?").bind("firma-invalida:" + hoy).first())?.n || 0;
    const avisadoFirmas = estado.avisos?.firmas?.fecha === hoy ? estado.avisos.firmas.n : 0;
    if (firmas >= avisadoFirmas + 5) { nuevo.avisos.firmas = { fecha: hoy, n: firmas }; alertas.push(["🚨 Avisos de pago con firma inválida", [`Hoy llegaron <b>${firmas}</b> avisos de pago con firma inválida. La tienda los rechazó y ningún pedido cambió, pero puede ser un intento de fraude o un cambio en la firma secreta de Mercado Pago.`]]); }

    // 7) Inventario del proveedor: a la 1 p. m. (en esa vuelta no se hacen el rastreo ni las reseñas, para no pasar
    //    el límite de consultas por ejecución del plan gratuito; se hacen en la siguiente hora)
    const tocaProveedor = MODULOS.proveedor && (b.tarea === "proveedor" || (PROVEEDOR.horas.includes(hora) && (!estado.proveedor || Date.now() - Date.parse(estado.proveedor) > 12 * 3600e3)));
    if (tocaProveedor) {
      nuevo.proveedor = new Date().toISOString();
      try {
        const r = hecho.proveedor = await sincronizarProveedor(env);
        if (!r.ok) { if (nuevo.avisos.proveedor !== hoy) { nuevo.avisos.proveedor = hoy; alertas.push(["⚠️ No se pudo actualizar el inventario del proveedor", [`Motivo: ${escHtml(r.error)}.`, "No se cambió nada en tu catálogo. Se vuelve a intentar mañana a la 1:00 p. m., o puedes darle «Sincronizar ahora» en el panel → Proveedor."]]); } }
        else if (r.cambios.length || r.revisar) {
          const lineas = r.cambios.slice(0, 40).map(c => `${{ nueva: "🆕", "bajó": "⬇️", "subió": "⬆️", agotada: "⛔", "ya no está": "⛔", "otra vez disponible": "✅" }[c.tipo] || "•"} <b>${escHtml(c.nombre)}</b> · ${escHtml(c.tipo)}${c.de != null ? ` · €${c.de} → €${c.a}` : c.a != null ? ` · €${c.a}` : ""}`);
          if (r.cambios.length > 40) lineas.push(`…y ${r.cambios.length - 40} cambios más (ver el panel → Proveedor).`);
          if (r.revisar) lineas.push(`⚠️ <b>${r.revisar}</b> pala(s) cambiaron de costo más de 30 %: no se aplicó solo. Revísalas en el panel → Proveedor.`);
          alertas.push([`🏓 Proveedor: ${r.nuevas} nuevas · ${r.precios} precios · ${r.agotadas} agotadas · ${r.disponibles} de vuelta`, lineas]);
        }
      } catch (e) { hecho.proveedor = { error: String(e.message || e) }; }
    } else {
      // 8) Rastreo de pedidos enviados con Envíosperros (los entregados se marcan solos)
      if (MODULOS.envios) try { hecho.envios = await sincronizarEnvios(env, new URL(request.url).hostname, 15); } catch (e) { hecho.envios = { error: String(e.message || e) }; }

      // 9) Pedir opinión a los clientes con pedidos entregados hace unos días (un correo por pedido)
      if (MODULOS.resenas) try { hecho.resenas = await solicitarResenas(env, 10); } catch (e) { hecho.resenas = { error: String(e.message || e) }; }

      // 10) Fotos pendientes del proveedor (palas nuevas): unas cuantas por hora
      if (MODULOS.proveedor) try { hecho.fotos = await fotosPendientesProveedor(env, 3); } catch (e) { hecho.fotos = { error: String(e.message || e) }; }
    }

    // 9) Tipo de cambio de Banxico desactualizado (los precios dinámicos dependen de él)
    if (env.BANXICO_TOKEN && nuevo.avisos.banxico !== hoy) {
      const tc = (await leerDoc(env, "tipo-cambio"))?.valor;
      if (!tc || Date.now() - tc.consultado > 30 * 3600e3) { nuevo.avisos.banxico = hoy; alertas.push(["⚠️ El tipo de cambio de Banxico no se ha actualizado", [`Último valor: ${tc ? `${tc.valor} (consultado el ${escHtml(fechaHoraMX(new Date(tc.consultado)))})` : "ninguno"}.`, "Los precios dinámicos siguen usando el último valor guardado. Revisa en el panel → Precios, o fija un tipo de cambio manual."]]); }
    }
  }
  for (const [asunto, lineas] of alertas) await correoAlerta(env, asunto, lineas);
  hecho.alertas = alertas.length;
  nuevo.ultimaEjecucion = new Date().toISOString();
  await escribirDoc(env, "tareas-estado", nuevo);
  return json({ ok: true, ...hecho });
}
