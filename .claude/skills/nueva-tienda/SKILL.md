---
name: nueva-tienda
description: Da de alta una tienda cliente a partir de la maqueta: cuestionario, clientes/<clave>/ (tienda.json, catálogo, logo, legales), construcción, revisión local y publicación en pruebas. Úsala cuando digan «nueva tienda», «nuevo cliente», «arma la tienda de…» o similar.
---

# Nueva tienda

Referencias: `tiendas-web/docs/MAQUETA.md` (decisiones de cuentas), `tiendas-web/docs/TIENDA-JSON.md` (cada campo), `tiendas-web/demos/demo-suplementos/` (ejemplo completo
de una tienda que no es de pádel). **Nunca copies la carpeta de otro cliente** como base: tiene sus datos reales.

Si el negocio vende por Instagram, empieza con la skill `tienda-desde-instagram`: saca casi todo el cuestionario y el catálogo de su cuenta.

## 1. Cuestionario (pregunta lo que falte, todo junto, no de uno en uno)
- Negocio: nombre comercial, giro, qué vende, ciudad, por dónde vende hoy (WhatsApp, Instagram, local).
- Contacto: WhatsApp, correo, dirección (o «solo envíos»), horario.
- Marca: logo (PNG/SVG), 2 colores, estilo. Si no tiene, propón una paleta y enséñala antes de seguir.
- Venta: categorías, ¿tallas o variantes?, ¿inventario?, envío (paquetería, local, recoger), costo de envío, envío gratis desde, tiempos de entrega.
- Cobro: ¿tiene Mercado Pago? (la cuenta debe ser suya). ¿Factura? Razón social y RFC. Plazo y condiciones de devolución.
- Dominio: ¿tiene? Si no, propón 2–3 opciones y aclara que se registra a su nombre.
- Módulos: reseñas, envíos con guía (Envíosperros, cuenta suya), cupones.

## 2. Carpeta de la tienda
1. Clave corta en minúsculas, sin acentos, con guiones (`postres-mary`). Se queda para siempre: no se cambia después de publicar.
2. Copia `tiendas-web/demos/demo-suplementos/` a `clientes/<clave>/` (o a `tiendas-web/demos/<clave>/` si es otra demo) y reemplaza **todo**: `tienda.json` (datos, colores, textos, categorías, `prefijo`,
   `modulos`, `legal`), `catalogo.js`, `img/` (logo con fondo transparente, `icono.png` 512×512, `apple-touch-icon.png` 180×180, fuente con licencia libre).
3. Un dato desconocido queda como `[PENDIENTE: …]` y va a la lista de pendientes; no se inventa.
4. Catálogo → skill `importar-catalogo`. Legales → skill `textos-legales` (por defecto se usan `tiendas-web/plantillas/legal/` con los datos de `tienda.json`).
5. Si el giro tiene avisos obligatorios (suplementos: leyenda de COFEPRIS; alimentos: caducidad), van en `legal.avisoGiro` y en `textos.pie`.

## 3. Revisar en local
```
python3 tiendas-web/build.py --tienda <clave>
node --no-warnings tiendas-web/pruebas/local.mjs <clave> --revisar
```
Las dos deben terminar sin error. Luego `node --no-warnings tiendas-web/pruebas/local.mjs <clave>` y revisa en el navegador (computadora y celular):
portada, una categoría, un producto, agregar al carrito, páginas legales y que no aparezca nada de pádel ni de otra tienda.
Aplica también la skill `auditar-marca`.

## 4. Cloudflare (en nuestra cuenta; confirmar con la persona antes de crear recursos)
- Proyecto de Pages `<proyecto>`, D1 `<proyecto>-db` y `<proyecto>-db-pruebas` (aplicar `tiendas-web/schema.sql`), KV `<proyecto>-catalogo`.
- Vínculos `DB` y `CATALOGO` en Production y Preview.
- Secretos (lista en el README). Los pone la persona en el panel de Cloudflare. **Nunca** pidas que se peguen en el chat.
- Worker reloj `<proyecto>-tareas` con `dist/reloj/<clave>.js` y el mismo `TAREAS_TOKEN`.

## 5. Publicar en pruebas
Skill `publicar`, solo a pruebas. Pedido de prueba con credenciales de prueba de Mercado Pago: pago, correo de confirmación y pedido en el panel.

## Entrega
Enlace de pruebas, dónde está la contraseña de pruebas (no el valor), lista de pendientes del cliente y los pasos para producción
(dominio a su nombre con DNS en nuestra cuenta, credenciales de producción de MP, dominio verificado en Resend). Commit en la rama de trabajo.
