# Reglas del proyecto

Este repositorio es **tiendas-web**: una **maqueta de tienda en línea** que se vende a negocios que ya venden
(por WhatsApp, Instagram, mostrador) pero no tienen página web. Cada cliente recibe su copia con su marca, su dominio y sus cuentas.
El plan completo está en `tiendas-web/docs/MAQUETA.md`. Estructura: `README.md` (raíz), `tiendas-web/README.md` (maqueta) y `clientes/<clave>/README.md` (operación de cada tienda).

## Idioma y tono
- Todo en español de México: código (nombres de funciones y variables), comentarios, commits, textos de la tienda y del panel.
- Textos para el cliente final: claros, de tú, sin tecnicismos. Fechas y horas al estilo «3:17 a. m.», hora de México.

## Arquitectura (no romperla)
- Un solo archivo de servidor por tienda: `tiendas-web/build.py` junta todo en `dist/<clave>/_worker.js` mediante **marcadores** (`__SEO__`, `/*PRECIO_COSTO*/`…).
  Cada marcador debe aparecer exactamente una vez; si agregas un módulo nuevo, agrega su marcador y su comprobación en `build.py`.
- Sin dependencias de npm ni frameworks en la tienda: HTML, CSS y JS a mano. Node solo se usa en `build.py`.
- Datos en D1 (`datos` = documentos JSON con `version`; escribir siempre con escrituras condicionadas). Fotos en el KV `CATALOGO`.
- Cambio de estructura de la base = `tiendas-web/schema.sql` (idempotente) **y** un `tiendas-web/migraciones/migracion-AAAA-MM-<tema>.sql` para bases existentes (aplicarlo en la base de cada tienda).

## Maqueta: separar la marca del código
- El código común vive en `tiendas-web/`. Cada tienda vive en `clientes/<clave>/` (clientes) o `tiendas-web/demos/<clave>/` (demos) (`tienda.json`, `catalogo.js`, `img/`, opcional `legal/` y `guias/`). Campos: `tiendas-web/docs/TIENDA-JSON.md`.
- **Nunca escribas datos de una tienda en el código común** (nombre, dominio, correos, WhatsApp, dirección, colores, montos, textos del giro).
  Usa `{{tienda.campo}}` (texto), `{{html:tienda.campo}}` (con HTML, solo en HTML o plantillas `…`) o `{{json:tienda.campo}}` (objetos en JS),
  y agrega el campo a **todas** las tiendas (`clientes/` y `tiendas-web/demos/`).
- Lo específico de un giro es un **módulo** (`tienda.json` → `modulos`): en la tienda pública, envuélvelo con `<!--MODULO:x-->…<!--/MODULO:x-->`
  o `/*MODULO:x*/…/*/MODULO:x*/` (se quita al construir); en el panel, `data-modulo="x"`; en el servidor, revisa `MODULOS.x`.
- `clave` y `prefijo` no se cambian en una tienda publicada (firmas de sesión, códigos de recuperación y folios dependen de ellos).
- Para revisar qué falta por separar, usa la skill `auditar-marca`.

## Secretos y seguridad
- Ningún secreto en el repositorio: van en Cloudflare (Settings → Variables and Secrets). La lista está en el README.
- Los respaldos de una tienda (y su carpeta `contenido/respaldos/`, si la tiene) pueden tener datos de clientes: no los copies a otras tiendas ni a servicios externos.
- Descargas de clientes (Instagram, catálogos) van en `entrada/` (ignorada por git): pueden traer mensajes y datos personales. Nunca se suben.
- Cada tienda tiene sus propios recursos (proyecto de Pages, D1, KV, secretos) y la cuenta de Mercado Pago del cliente. Nunca compartir base ni llaves entre tiendas.

## Antes de terminar un cambio
1. `python3 tiendas-web/build.py --todas` debe terminar sin error.
2. `node --no-warnings tiendas-web/pruebas/local.mjs <clave> --revisar` en cada tienda afectada (al menos demo-suplementos y cada cliente afectado).
3. Publicar primero en **pruebas** y revisar; producción solo con confirmación explícita (skill `publicar`).
4. Si cambias secretos, módulos, campos de `tienda.json`, estructura o pasos de publicación, actualiza los README y `tiendas-web/docs/`.
