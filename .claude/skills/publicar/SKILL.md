---
name: publicar
description: Construye la tienda y la publica en Cloudflare Pages, siempre primero en pruebas y en producción solo con confirmación explícita. Úsala cuando digan «publica», «sube a pruebas», «pásalo a producción» o «despliega», para cualquier tienda de clientes/ o de tiendas-web/demos/.
---

# Publicar

1. Tienda: la que digan; si hay duda (o dicen «todas»), confirma la lista de `clientes/` y `tiendas-web/demos/`.
2. `python3 tiendas-web/build.py --tienda <clave>` y `node --no-warnings tiendas-web/pruebas/local.mjs <clave> --revisar`. Si algo falla, arregla o detente; no publiques un resultado viejo.
3. **Pruebas**: despliegue de Pages del proyecto `proyecto` de su `tienda.json`, con `branch=pruebas`, subiendo `dist/<clave>/_worker.js`
   (API `accounts/<cuenta>/pages/projects/<proyecto>/deployments`). Nunca subas `dist/reloj/` a Pages.
   Si hubo migración SQL, aplícala antes en la base de pruebas.
   Comprueba portada, un producto, `/sitemap.xml` y `/admin` (debe pedir contraseña).
4. Resume qué cambia (commits desde la última publicación en producción) y qué revisaste.
5. **Producción**: solo si la persona lo confirma en este momento; una confirmación anterior o de otra tienda no cuenta.
   Migraciones en la base de producción antes de publicar. `branch=main` y repite las comprobaciones contra el dominio real.
6. Si cambió `reloj/worker.js`, publica `dist/reloj/<clave>.js` en el Worker `<proyecto>-tareas`.
7. Si algo falla en producción, vuelve a publicar el despliegue anterior (rollback en Pages) y avisa.
