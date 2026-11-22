# tiendas-web

Maqueta de tienda en línea para negocios mexicanos que ya venden (por WhatsApp, Instagram, mostrador) pero no tienen página web:
catálogo, carrito, pagos con Mercado Pago, panel de administración, correos, envíos, reseñas, páginas para buscadores y avisos legales.
Corre en Cloudflare Pages; cada tienda tiene su proyecto, su base de datos y sus cuentas.

| Carpeta | Qué es |
|---|---|
| [`tiendas-web/`](tiendas-web/README.md) | El código común, plantillas legales, herramientas (p. ej. importar desde Instagram), pruebas, documentación y demos |
| [`clientes/`](clientes/README.md) | Las tiendas de los clientes, una carpeta por tienda |

```bash
python3 tiendas-web/build.py --todas
```

```bash
node --no-warnings tiendas-web/pruebas/local.mjs demo-suplementos
```

La primera construye todas las tiendas en `dist/<clave>/_worker.js` (lo que se sube a Pages); la segunda abre la demo en
http://localhost:8787. Requiere Python 3 (con Pillow para las herramientas) y Node.js 22 o más nuevo.

Plan del negocio y decisiones: `tiendas-web/docs/MAQUETA.md`. Reglas para trabajar aquí: `CLAUDE.md`.
