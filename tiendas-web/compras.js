// ---------- Compras de inventario: registro, costo real por pieza y existencias ----------
// Cada compra reparte cruce/aduana según el valor y los envíos según el tamaño (calcularCompra en precio.js), suma las piezas
// a existencias y guarda el costo real de cada producto (promedio ponderado con lo que ya tenías en almacén).
async function apiCompras(request, env, ruta, url) {
  if (ruta === "/compras" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, fecha, proveedor, total, piezas, datos, creado, anulada FROM compras ORDER BY fecha DESC, creado DESC LIMIT 200").all();
    return json({ compras: results.map(r => ({ ...r, datos: JSON.parse(r.datos || "{}") })) });
  }
  if (ruta === "/compras" && request.method === "POST") {
    let b = {}; try { b = await request.json(); } catch {}
    const num = (v, min, max) => { const x = Number(v); return x >= min && x <= max ? Math.round(x * 100) / 100 : null; };
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || "") ? b.fecha : hoyMX(), tc = num(b.tc, 5, 100);
    if (!tc) return json({ error: "Escribe el tipo de cambio que te cobraron (entre 5 y 100)." }, 400);
    const cat = await leerCatalogo(env), mapa = new Map(cat.productos.map(p => [p.id, p]));
    const lineas = (Array.isArray(b.lineas) ? b.lineas : []).slice(0, 200).map(l => {
      const p = mapa.get(String(l.id || "")), piezas = Math.round(Number(l.piezas)), costoEur = num(l.costoEur, 0, 100000);
      if (!p) throw new Error("Un producto de la compra ya no existe en el catálogo.");
      if (!(piezas >= 1 && piezas <= 5000) || costoEur == null) throw new Error(`Revisa las piezas y el costo de ${p.nombre}.`);
      const talla = p.variantes?.length ? String(l.talla || "") : "";
      if (p.variantes?.length && !p.variantes.some(v => v.talla === talla)) throw new Error(`Elige la talla de ${p.nombre}.`);
      return { id: p.id, nombre: p.nombre, categoria: p.categoria, talla, piezas, costoEur };
    });
    if (!lineas.length) return json({ error: "Agrega al menos un producto." }, 400);
    const compra = { fecha, proveedor: texto(b.proveedor || "", 60), tc, envProvEur: num(b.envProvEur, 0, 100000) || 0, cruce: num(b.cruce, 0, 1e7) || 0, aduana: num(b.aduana, 0, 1e7) || 0,
      mtyGdl: num(b.mtyGdl, 0, 1e6) || 0, otros: num(b.otros, 0, 1e7) || 0, nota: texto(b.nota || "", 200), lineas };
    const r = calcularCompra(compra), id = "C" + fecha.replace(/-/g, "").slice(2) + "-" + aleatorio(4), sumar = b.sumarExistencias !== false;
    // Existencias y costo real en el ALMACÉN (promedio ponderado con lo que ya había)
    if (sumar) {
      const base = await leerCatalogoBase(env), enBase = new Map(base.productos.map(p => [p.id, p]));
      await modificarDoc(env, "almacen", () => ({ items: {} }), a => {
        const items = { ...(a.items || {}) };
        for (const pid of new Set(r.lineas.map(l => l.id))) {
          const p = enBase.get(pid) || mapa.get(pid), mias = r.lineas.filter(l => l.id === pid);
          const e = items[pid] ? { ...items[pid], tallas: items[pid].tallas ? { ...items[pid].tallas } : undefined } : entradaDe(p);
          let antes = 0, nuevas = 0, costoNuevas = 0;
          for (const l of mias) {
            if (l.talla) { e.tallas = e.tallas || {}; const st = e.tallas[l.talla]; antes += st > 0 ? st : 0; e.tallas[l.talla] = Math.max(0, st || 0) + l.piezas; }
            else { antes += e.stock > 0 ? e.stock : 0; e.stock = Math.max(0, e.stock || 0) + l.piezas; }
            nuevas += l.piezas; costoNuevas += l.unitario * l.piezas;
          }
          const previo = e.costoReal?.unitario > 0 && antes > 0 ? e.costoReal.unitario : null;
          e.costoReal = { unitario: Math.round((previo ? (previo * antes + costoNuevas) / (antes + nuevas) : costoNuevas / nuevas) * 100) / 100, fecha, compra: id };
          if (p) e.producto = instantanea(p);
          items[pid] = e;
        }
        return { ...a, items };
      });
      // Lo que estaba marcado «siempre bajo pedido» pasa a entrega inmediata: ya lo tienes en almacén
      if (r.lineas.some(l => enBase.get(l.id)?.entrega === "pedido"))
        await modificarDoc(env, "catalogo", () => ({ productos: [] }), c => ({ ...c, productos: c.productos.map(p => r.lineas.some(l => l.id === p.id) && p.entrega === "pedido" ? { ...p, entrega: "inmediata" } : p) }));
    }
    await env.DB.prepare("INSERT INTO compras (id, fecha, proveedor, total, piezas, datos, creado) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, fecha, compra.proveedor, r.totalMx, r.piezas, JSON.stringify({ ...compra, resultado: r, sumoExistencias: sumar }), new Date().toISOString()).run();
    return json({ ok: true, id, resultado: r });
  }
  // Anular: quita las piezas que se sumaron (sin bajar de 0). El costo real se conserva.
  if (ruta === "/compras/anular" && request.method === "POST") {
    let b = {}; try { b = await request.json(); } catch {}
    const fila = await env.DB.prepare("SELECT datos, anulada FROM compras WHERE id = ?").bind(String(b.id || "")).first();
    if (!fila) return json({ error: "Compra no encontrada." }, 404);
    if (fila.anulada) return json({ error: "Esta compra ya estaba anulada." }, 400);
    const d = JSON.parse(fila.datos);
    if (d.sumoExistencias) await moverExistencias(env, d.lineas.map(l => ({ id: l.id, talla: l.talla || "", delta: -l.piezas })));
    await env.DB.prepare("UPDATE compras SET anulada = ? WHERE id = ?").bind(new Date().toISOString(), String(b.id)).run();
    return json({ ok: true });
  }
  return json({ error: "No encontrado." }, 404);
}
