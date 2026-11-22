// ---------- Precio por «costo puesto en México» (lo usan la tienda, el carrito, Google y el panel) ----------
// costo puesto = (costo € + envío del proveedor €) × TC euro × (1 + cruce %) [× (1 + aduana %) si la pieza pasa de 800 USD]
//                + Monterrey → Guadalajara (caja de 61×31×39) + otros costos por paquete (opcional) + envío al cliente (completo si el envío es gratis; si no, lo que no cubre lo que paga el cliente)
// ganancia     = 25 % del costo, al menos $300, y al menos $1,000 si el precio pasa de $6,000
// precio       = (costo + ganancia) ÷ (1 ÷ (1 + IVA) − comisión de Mercado Pago), terminado en 9
// Valores por categoría: tienda.json → categorias.<cat>.costo (CATS lo definen worker.js y admin.html)
const costoPorCat = campo => Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.costo?.[campo] ?? 0]));
const PRECIO_COSTO_INICIAL = {
  envProv: costoPorCat("envProv"),     // € por pedido de una pieza
  envMx: costoPorCat("envMx"),                // $ otros costos por paquete (opcional)
  cajaImport: { largo: 61, ancho: 31, alto: 39, peso: 3 },                                             // caja con la que llega a Monterrey (para cotizar MTY → GDL)
  envMtyGdl: costoPorCat("envMtyGdl"), // $ Monterrey → Guadalajara (caja de 61×31×39)
  envCliente: costoPorCat("envCliente"),// $ Guadalajara → cliente
  cruce: 10, aduana: 17, aduanaDesdeUsd: 800, usdPorEur: 1.08, comisionMP: 4.06,
  margen: 25, margenMin: 300, margenMinCaro: 1000, umbralCaro: 6000, envioGratisDesde: {{tienda.envio.gratisDesde}}, envioCliente: {{tienda.envio.costo}},
};
const redondearA9 = x => Math.ceil((x + 1) / 10) * 10 - 1;
// Precio a partir de un costo en pesos ya puesto en Guadalajara (sin el envío al cliente): ganancia, envío al cliente, Mercado Pago, IVA
function precioDesdeCosto(costoBase, categoria, cfgTotal, extra = {}) {
  const c = { ...PRECIO_COSTO_INICIAL, ...(cfgTotal.costo || {}) }, cat = categoria in c.envProv ? categoria : "accesorios";
  const envCli = Number((c.envCliente || {})[cat] ?? PRECIO_COSTO_INICIAL.envCliente[cat] ?? 150);
  const iva = (cfgTotal.iva ?? 16) / 100, com = (Number(c.comisionMP) || 0) / 100, divisor = 1 / (1 + iva) - com;
  const calcular = envioCli => {
    const costo = costoBase + envioCli;
    let ganancia = Math.max(costo * c.margen / 100, c.margenMin);
    let precio = (costo + ganancia) / divisor;
    if (precio >= c.umbralCaro && ganancia < c.margenMinCaro) { ganancia = c.margenMinCaro; precio = (costo + ganancia) / divisor; }
    return { costo, ganancia, precio };
  };
  // Envío al cliente: si el precio llega al envío gratis, lo pagas completo; si no, solo lo que no cubren los $149 que paga el cliente
  let r = calcular(envCli), gratis = true;
  if (r.precio < c.envioGratisDesde) { const r2 = calcular(Math.max(0, envCli - c.envioCliente)); if (r2.precio < c.envioGratisDesde) { r = r2; gratis = false; } }
  const precio = redondearA9(r.precio), neto = precio / (1 + iva) - precio * com;
  return { precio, costo: Math.round(r.costo), ganancia: Math.round(neto - r.costo), margenPct: Math.round((neto - r.costo) / r.costo * 1000) / 10, envioGratis: gratis, ...extra };
}
// Ganancia real si vendes a un precio dado (para comparar con el precio de hoy)
function gananciaConPrecio(precio, costoBase, categoria, cfgTotal) {
  const c = { ...PRECIO_COSTO_INICIAL, ...(cfgTotal.costo || {}) }, cat = categoria in c.envProv ? categoria : "accesorios";
  const envCli = Number((c.envCliente || {})[cat] ?? 150), iva = (cfgTotal.iva ?? 16) / 100, com = (Number(c.comisionMP) || 0) / 100;
  const envio = precio >= c.envioGratisDesde ? envCli : Math.max(0, envCli - c.envioCliente);
  return Math.round(precio / (1 + iva) - precio * com - costoBase - envio);
}
function precioPorCosto(costoEur, categoria, tc, cfgTotal) {
  const c = { ...PRECIO_COSTO_INICIAL, ...(cfgTotal.costo || {}) }, cat = categoria in c.envProv ? categoria : "accesorios";
  const val = (m, def) => Number((c[m] || {})[cat] ?? PRECIO_COSTO_INICIAL[m][cat] ?? def);
  const conAduana = costoEur * c.usdPorEur > c.aduanaDesdeUsd;
  const importacion = (costoEur + val("envProv", 25)) * tc * (1 + c.cruce / 100) * (conAduana ? 1 + c.aduana / 100 : 1);
  const logistica = val("envMx", 0) + val("envMtyGdl", 260);
  const r = precioDesdeCosto(importacion + logistica, cat, cfgTotal, { conAduana });
  return { ...r, desglose: { importacion: Math.round(importacion), logistica: Math.round(logistica), envioCliente: Math.round(r.costo - importacion - logistica) } };
}
// Precio de un producto del catálogo: si tienes piezas en almacén con costo real (de una compra registrada), se usa ese costo
const hayExistencias = p => p.variantes?.length ? p.variantes.some(v => v.stock > 0) : p.stock > 0;
function precioProducto(p, tc, cfgTotal) {
  if (p.costoReal?.unitario > 0 && hayExistencias(p)) return { ...precioDesdeCosto(p.costoReal.unitario, p.categoria, cfgTotal), costoReal: true };
  return p.costoEur != null && tc ? precioPorCosto(p.costoEur, p.categoria, tc, cfgTotal) : null;
}
// Reparto de una compra: el cruce y la aduana según el valor de cada producto; los envíos según el tamaño (pala = 1)
const PESO_ENVIO = costoPorCat("peso");
function calcularCompra(compra) {
  const tc = Number(compra.tc) || 0, L = (compra.lineas || []).filter(l => l.piezas > 0);
  const valorEur = L.reduce((s, l) => s + l.piezas * l.costoEur, 0), peso = L.reduce((s, l) => s + l.piezas * (PESO_ENVIO[l.categoria] ?? .5), 0);
  const porValor = (Number(compra.cruce) || 0) + (Number(compra.aduana) || 0);
  const porTamano = (Number(compra.envProvEur) || 0) * tc + (Number(compra.mtyGdl) || 0) + (Number(compra.otros) || 0);
  const lineas = L.map(l => {
    const v = l.piezas * l.costoEur, w = l.piezas * (PESO_ENVIO[l.categoria] ?? .5);
    const total = v * tc + (valorEur ? v / valorEur * porValor : 0) + (peso ? w / peso * porTamano : 0);
    return { ...l, totalMx: Math.round(total * 100) / 100, unitario: Math.round(total / l.piezas * 100) / 100, productoMx: Math.round(v * tc) };
  });
  const totalMx = lineas.reduce((s, l) => s + l.totalMx, 0), productoMx = valorEur * tc;
  return { lineas, valorEur, totalMx: Math.round(totalMx), productoMx: Math.round(productoMx), logisticaMx: Math.round(totalMx - productoMx),
    logisticaPct: totalMx ? Math.round((totalMx - productoMx) / totalMx * 1000) / 10 : 0, piezas: L.reduce((s, l) => s + l.piezas, 0) };
}
