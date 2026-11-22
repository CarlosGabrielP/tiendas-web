---
name: investigar-nicho
description: Investiga un giro de negocio en México (cliente final, competencia, búsquedas en Google, leyes y reglas, catálogo, temporadas, logística, confianza) con fuentes citadas y deja tiendas-web/docs/nichos/<giro>.md, que luego alimenta la tienda (categorías, textos, palabras para buscadores, guías, avisos legales y módulos). Úsala antes de una demo de un giro nuevo, antes de armar la tienda de un cliente de un giro que no está investigado, o cuando pidan «investiga el nicho de…».
---

# Investigar un nicho

El resultado sirve para **todas** las tiendas de ese giro. Lo propio de un negocio (su Instagram, sus precios) va en su carpeta de cliente,
no aquí. Si ya existe `tiendas-web/docs/nichos/<giro>.md`, actualízalo (fecha nueva, qué cambió) en vez de empezar de cero.

## Cómo investigar
- Busca en la web (búsqueda normal; la extensa solo si los resultados son pobres o el dato es reciente, como precios).
  Lanza varias búsquedas a la vez. Lee las páginas que importan (leyes, reportes, estudios) en vez de quedarte con el resumen del buscador.
- **Cada dato importante lleva su fuente** (enlace) y su fecha si la tiene. Distingue lo que dice la fuente de lo que tú deduces («Inferencia:»).
- Prefiere fuentes oficiales (DOF, COFEPRIS, Profeco, INEGI, SAT), asociaciones del sector, estudios de mercado con metodología y
  las páginas de la competencia. Desconfía de blogs que venden algo.
- Leyes y reglas: resume y enlaza; **no des asesoría legal**. Marca lo que debe confirmar un abogado o un experto sanitario.
- No pongas datos personales de nadie ni copies textos largos de otros sitios.
- Precios de la competencia: rango y fecha de consulta; cambian rápido.

## Qué investigar (secciones del documento)
1. **Resumen**: 8–10 líneas con lo que más cambia cómo se arma la tienda.
2. **Cliente final**: quién compra, qué busca, qué le preocupa (objeciones), cómo paga y en qué aparato, cada cuánto vuelve, ticket típico.
3. **Competencia**: grandes (marketplaces, cadenas) y chicas (cuentas de Instagram, tiendas locales); precios, envío gratis, tiempos,
   qué hacen para dar confianza; dónde puede ganar una tienda chica.
4. **Búsquedas en Google**: palabras clave y preguntas frecuentes del giro (en español de México). Si no hay datos de volumen, dilo.
5. **Leyes y reglas**: sanitarias, de consumidor (Profeco), de publicidad, de envío (paqueterías), de pagos (Mercado Pago),
   de facturación. Qué textos o avisos son obligatorios y qué está prohibido decir.
6. **Catálogo**: categorías, datos que importan por producto (para `specs`), variantes (talla, sabor, presentación), paquetes,
   productos que se compran juntos, fotos que funcionan.
7. **Confianza**: qué necesita ver el comprador para pagar (originalidad, caducidad, reseñas, garantía, contacto).
8. **Temporadas**: meses fuertes y fechas de venta (Hot Sale, El Buen Fin, regreso a clases, enero…).
9. **Logística**: peso y tamaño típicos, restricciones de envío, entrega local, devoluciones.
10. **Qué le duele al dueño del negocio** (para vender la maqueta): lo que hoy le quita tiempo o ventas.
11. **Recomendaciones para la tienda** → tabla con el campo de `tienda.json` o la función de la maqueta que cambia:
    `categorias` (slug, títulos y textos para buscadores, alias), `textos` (hero, beneficios, entrega), `legal.avisoGiro`,
    `legal.condicionDevolucion`, `modulos`, guías de compra a escribir, funciones que faltan en la maqueta.
12. **Pendientes y riesgos**: lo que no se pudo confirmar y lo que debe revisar un experto.
13. **Fuentes**: lista numerada con título, sitio, enlace y fecha de consulta.

## Después
- Muestra el resumen y las recomendaciones a la persona antes de aplicarlas.
- Aplica las recomendaciones en la demo del giro (`tiendas-web/demos/<giro>/`) o en el cliente que se esté armando, y anota en la
  sección 11 qué se aplicó y dónde.
- Si la investigación pide una función que la maqueta no tiene, propónla (y agrégala a «Pendientes conocidos» en `tiendas-web/docs/MAQUETA.md`).
