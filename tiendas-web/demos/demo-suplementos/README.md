# Demo: Vértice Nutrición (suplementos, ficticia)

Tienda de demostración para enseñar la maqueta a tiendas de suplementos. Productos, marcas y datos de contacto son inventados.
Investigación del nicho: `tiendas-web/docs/nichos/suplementos-mx.md`.

## Publicación
- Sitio: https://demo-suplementos.pages.dev (módulo `demo`: barra de demostración y no se indexa en buscadores)
- Cloudflare Pages: proyecto `demo-suplementos`, rama de producción `main`, publicado subiendo `dist/demo-suplementos/_worker.js`
- D1 `demo-suplementos-db` (vínculo `DB`, con `tiendas-web/schema.sql` aplicado) y KV `demo-suplementos-catalogo` (vínculo `CATALOGO`)
- Panel `/admin`: secreto `ADMIN_PASSWORD` configurado en Cloudflare (contraseña sencilla para enseñarla; datos ficticios). Verificación en 2 pasos
  apagada (`modulos.dosPasos: false`): se entra solo con contraseña y el apartado Seguridad la muestra como ejemplo configurable.
- Sin `MP_ACCESS_TOKEN`: el pago dice que aún no está activo.
  Para enseñar el pago, usar **credenciales de prueba** de Mercado Pago, nunca las de producción.
- Sin Worker reloj (no hace falta para una demo: no hay pedidos reales ni respaldos que guardar).

## Actualizar
```bash
python3 tiendas-web/build.py --tienda demo-suplementos
```
Luego volver a publicar (skill `publicar`, o «Create deployment» en Cloudflare subiendo la carpeta `dist/demo-suplementos/`).
Fotos: `python3 tiendas-web/demos/demo-suplementos/generar_fotos.py`.
