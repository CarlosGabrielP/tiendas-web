# tiendas-web — maqueta de tienda en línea

Tienda completa para negocios mexicanos: catálogo, carrito, pagos con Mercado Pago, panel de administración, correos (Resend),
envíos (Envíosperros), reseñas, páginas para buscadores y avisos legales. Corre en **Cloudflare Pages** en modo `_worker.js`:
un solo archivo de servidor por tienda, generado con `build.py`.

El código de esta carpeta es común a todas las tiendas. Lo que distingue a cada una está en su carpeta:
`clientes/<clave>/` (clientes) o `tiendas-web/demos/<clave>/` (demostraciones, p. ej. `demos/demo-suplementos/`).
Plan y decisiones: `docs/MAQUETA.md`. Campos de la configuración: `docs/TIENDA-JSON.md`.

## Estructura

| Archivo / carpeta | Qué es |
|---|---|
| `index.html` | Tienda pública (catálogo, carrito, pago; módulos: recomendador, minijuego) |
| `admin.html` | Panel de administración (`/admin`): pedidos, catálogo, precios, CSV, cupones, envíos, reseñas, visitas, seguridad (y los módulos encendidos) |
| `worker.js` | Servidor: API, pedidos y pagos (Mercado Pago), correos (Resend), panel, minijuego, seguridad |
| `seo.js` | Páginas para buscadores: productos, categorías, marcas, guías, sitemap, robots.txt, feed de Google Merchant Center |
| `precio.js` | Precio por costo puesto en México (módulo `preciosEuro`) |
| `envios.js`, `resenas.js`, `compras.js`, `proveedor.js`, `ficha.js` | Módulos: envíos, reseñas, compras, proveedor de pádel, fichas técnicas |
| `tareas.js` | Tareas programadas: respaldo diario, conciliación de pagos y alertas por correo |
| `reloj/worker.js` | Worker aparte (cron) que llama a las tareas de cada tienda |
| `juego/motor.js` | Motor del minijuego (el mismo en navegador y servidor) |
| `qr.js` | Códigos QR para la verificación en 2 pasos del panel |
| `plantillas/legal/` | Aviso de privacidad, términos y devoluciones genéricos con marcadores `{{tienda.*}}` |
| `demos/<clave>/` | Tiendas de demostración (ficticias) |
| `schema.sql` | Estructura de la base de datos D1 (bases nuevas) |
| `migraciones/` | Cambios de estructura para bases ya existentes |
| `pruebas/local.mjs` | Corre una tienda construida en tu computadora (sin Cloudflare) y revisa sus páginas |
| `herramientas/instagram.py` | Lee la descarga oficial de Instagram de un negocio y deja un borrador (perfil, colores, publicaciones con precios y fotos en WebP) |
| `pruebas/instagram_prueba.py` | Prueba de la herramienta de Instagram con una descarga inventada |
| `docs/nichos/` | Investigaciones de cada giro (skill `investigar-nicho`) |
| `demos/demo-suplementos/generar_fotos.py` | Regenera las fotos ficticias de la demo |
| `build.py` | Genera `dist/<clave>/_worker.js` (en la raíz del repositorio) |

Cada carpeta de tienda tiene `tienda.json`, `catalogo.js`, `img/` y, si los necesita, `legal/` y `guias/`.

## Construir

```bash
python3 tiendas-web/build.py --tienda demo-suplementos
```

```bash
python3 tiendas-web/build.py --todas
```

Requiere Python 3 y Node.js 22 o más nuevo. El resultado queda en `dist/<clave>/_worker.js` (la carpeta que se sube a Pages)
y el Worker del reloj en `dist/reloj/<clave>.js`. Si falta un dato en `tienda.json` o queda un marcador sin llenar, la construcción se detiene.

### Probar en tu computadora

```bash
node --no-warnings tiendas-web/pruebas/local.mjs demo-suplementos --revisar
```

Abre las páginas principales con una base de datos de prueba y falla si alguna no responde o si aparece otra tienda. Sin `--revisar`,
sirve la tienda en http://localhost:8787 (panel en `/admin`, contraseña `prueba-local`). No se conecta a Mercado Pago, Resend ni Banxico.

## Configuración de cada tienda en Cloudflare (no está en el repositorio)

Cada tienda tiene su proyecto de Pages (`proyecto` en su `tienda.json`), su D1, su KV y sus secretos.


**Vínculos** (Settings → Bindings), uno por ambiente:
- `DB` → base de datos D1 (`<proyecto>-db` en producción, `<proyecto>-db-pruebas` en pruebas)
- `CATALOGO` → KV para las fotos de productos

**Secretos** (Settings → Variables and Secrets, tipo *Secret*). Nunca se guardan en el código:

| Nombre | Para qué |
|---|---|
| `ADMIN_PASSWORD` | Contraseña del panel (además, el panel pide un código de 6 dígitos de la app de autenticación) |
| `BANXICO_TOKEN` | Tipo de cambio EUR→MXN de Banxico para los precios dinámicos |
| `MP_ACCESS_TOKEN` | Mercado Pago (credenciales de prueba en Preview, de producción en Production) |
| `MP_WEBHOOK_SECRET` | Firma de los avisos (webhooks) de Mercado Pago |
| `RESEND_API_KEY` | Envío de correos (llave «solo envío» del dominio de la tienda) |
| `PRUEBAS_PASSWORD` | Solo en Preview: contraseña del sitio de pruebas |
| `TAREAS_TOKEN` | Secreto compartido con el Worker `<proyecto>-tareas` (el mismo valor en Pages y en el Worker) |

## Verificación en 2 pasos del panel


Se da de alta al entrar al panel por primera vez (código QR). Si se pierde el celular y los códigos de recuperación:
en Cloudflare → D1 → la base de la tienda → tabla `datos`, borrar la fila `admin-2fa` y volver a darla de alta.

## Envíos con Envíosperros
`envios.js` (se inserta en el worker con el marcador `__ENVIOS__`). Panel → **📮 Envíos** (dirección de origen, paquetes, tamaño de etiqueta)
y, en cada pedido pagado, **🏷️ Generar guía**: cotiza, genera la guía con el saldo de Envíosperros, marca el pedido como enviado y avisa al cliente.
El rastreo se consulta solo (al abrir pedidos en el panel, cuando el cliente abre «Ver mi pedido» y en la tarea programada); al llegar a «Entregado» el pedido cambia solo.
- Secreto `ENVIOSPERROS_TOKEN` (Envíosperros → Integraciones → «Conexión vía API REST»): en **Production** el token de app.enviosperros.com;
  en **Preview** el de staging-app.enviosperros.com (cuenta de pruebas, saldo ficticio). `ENVIOSPERROS_ENTORNO` (`staging`/`produccion`) fuerza el ambiente.

## Reseñas
`resenas.js` (marcador `__RESENAS__`). La tarea programada pide opinión por correo a los pedidos «Entregado» con más de N días (una vez por pedido).
El cliente califica en `/resena` (enlace con token del pedido); la reseña queda pendiente y se publica desde el panel → **⭐ Reseñas**
(opcional: publicar solas las de 4–5 ★ sin enlaces). Las publicadas se guardan resumidas en el documento `resenas-publicadas` y aparecen
en la página del producto con su promedio y en el JSON-LD (`aggregateRating`, `review`). Migración: `migraciones/migracion-2026-11-resenas.sql`.
