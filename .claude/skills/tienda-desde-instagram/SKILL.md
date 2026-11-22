---
name: tienda-desde-instagram
description: Arma la tienda de un negocio a partir de su Instagram (la descarga oficial de su cuenta, capturas de pantalla o su perfil público): nombre, bio, contacto, colores, logo, categorías y productos con fotos y precios, y deja lista clientes/<clave>/. Úsala cuando digan «hazle la tienda con su Instagram», «basada en su página de Instagram», «toma su @…» o cuando un cliente solo tenga Instagram.
---

# Tienda desde Instagram

Convierte lo que el negocio ya publica en Instagram en su tienda. Al terminar, la tienda queda en `clientes/<clave>/` y se sigue
con la skill `nueva-tienda` desde su paso 3 (revisar en local).

## 0. Permiso y privacidad (antes de todo)
- Solo con permiso del **dueño de la cuenta**: las fotos y los textos son suyos. No armes la tienda de una cuenta ajena.
- **Nunca scrapees Instagram** con scripts ni con `curl`: lo prohíben sus condiciones y además pide iniciar sesión.
- La descarga oficial trae mensajes privados, seguidores y otros datos personales. Se guarda en `entrada/` (no se sube al repositorio)
  o en una carpeta temporal, nunca en `clientes/`. La herramienta solo lee el perfil y las publicaciones.
- No publiques fotos donde salgan clientes o personas reconocibles sin permiso; no copies comentarios ni nombres de seguidores.

## 1. De dónde salen los datos (de mejor a peor)
1. **Descarga oficial (recomendada)**. Instrucciones para el cliente: Instagram → Configuración → Centro de cuentas → Tu información y
   permisos → Descargar tu información → su cuenta → **Formato JSON**, calidad de fotos **alta** → le llega un .zip por correo (puede
   tardar horas). Luego:
   ```
   python3 tiendas-web/herramientas/instagram.py entrada/<clave>/descarga.zip entrada/<clave>/borrador
   ```
   Deja `instagram.json` (perfil, colores sugeridos y publicaciones con `nombreProbable`, `precios`, `hashtags`, `texto`, `fotos`),
   las fotos en WebP y `perfil.png`.
2. **Capturas de pantalla** o fotos que manda el cliente (perfil, publicaciones, historias destacadas con precios o menú).
   Ábrelas con Read y saca los mismos datos. Las fotos de producto para la tienda deben ser los originales, no capturas: pídelas.
3. **Perfil público en un navegador**, solo si hay uno conectado en esta sesión y el dueño lo autorizó: lee la bio, los destacados
   y las publicaciones a mano. Las fotos se piden al cliente.

## 2. Interpretar el borrador
Mira las fotos (Read) además de los textos. Decide y anota:
- **Marca**: `nombre` del perfil, `clave` corta sin acentos (puede salir del usuario), `giro`.
- **Contacto**: WhatsApp y teléfono de la bio o del perfil (los tres formatos de `tienda.json`), correo, ciudad o dirección.
  Si la bio dice «solo envíos» o «entregas en…», úsalo en `textos.entrega` y en `legal.tiempoEntrega`.
- **Textos**: `textos.hero`, `textos.pie` y `textos.descripcion` a partir de la bio, en el tono del negocio, sin prometer nada que no diga.
- **Colores**: parte de `coloresSugeridos` y de la foto de perfil. Revisa contraste (texto claro sobre `fondo`, texto negro sobre `acento`).
- **Logo**: si la foto de perfil es el logo, úsala para `icono.png` y `apple-touch-icon.png`. Para `logo.png` (horizontal, fondo
  transparente) pide el archivo original; si no hay, arma uno de texto con la fuente de la tienda y enséñalo.
- **Productos**: cada publicación que muestra algo a la venta es un producto. Un carrusel = un producto con varias fotos (la primera es
  la principal); varias publicaciones del mismo producto = uno solo. Omite avisos, agradecimientos, memes, sorteos y fotos de personas.
  - `nombre`: claro y corto (no la frase del post). `resumen` (máx. 400 caracteres, se ve en la ficha): lo que dice el texto, sin
    hashtags ni emojis de más; no inventes ingredientes, medidas, materiales ni garantías. Datos sueltos (sabor, tamaño, piezas) van en `specs`.
  - `precio`: solo si es claro. Varios precios en un post = variantes o productos separados (pregunta cuál). Precio dudoso o viejo
    (publicación de hace más de 6 meses) → pregunta. Sin precio → `precio: null` («Precio próximamente») y a la lista de pendientes.
  - `categoria`: agrupa por lo que se ve y por los hashtags; propón 3 a 6 categorías con `slug`, textos para buscadores y `alias`.
- **Giro con reglas**: alimentos (caducidad, conservación), suplementos (leyenda de COFEPRIS), etc. → `legal.avisoGiro` (skill `textos-legales`).

## 3. Confirmar con la persona antes de escribir
Muestra un resumen corto: nombre, clave, contacto, paleta (con muestras), categorías y una tabla de productos
(publicación · nombre · categoría · precio · fotos), y la lista de pendientes (precios dudosos, datos fiscales, logo, dominio).
Ajusta con lo que digan.

## 4. Crear la tienda
1. Copia `tiendas-web/demos/demo-suplementos/` a `clientes/<clave>/` como esqueleto y reemplaza todo (ver `tiendas-web/docs/TIENDA-JSON.md`).
   Apaga los módulos que no aplican (`recomendador`, `juego`, `proveedor`, `fichas`, `preciosEuro`, `compras`, `pistaPadel`).
2. Fotos: copia las elegidas del borrador a `clientes/<clave>/img/productos/<id>.webp` (id = nombre en minúsculas, sin acentos, con guiones).
   Si un producto tiene varias fotos, la principal va en `imagen` y las demás se suben después desde el panel.
3. `catalogo.js` con los productos confirmados (formato de `tiendas-web/demos/demo-suplementos/catalogo.js`, con `resumen`; `stock: null`
   si no maneja inventario). Si el texto da para una descripción larga, guárdala en `clientes/<clave>/contenido/descripciones.json`
   (`{ "<id>": "texto" }`): se carga en la base después de publicar, desde el panel (Catálogo → editar producto) o con `PUT /api/admin/descripciones`.
4. Datos legales que no sepas → `[PENDIENTE: …]`; nunca inventes RFC, razón social ni domicilio.
5. Sigue con `nueva-tienda` desde el paso 3: `python3 tiendas-web/build.py --tienda <clave>`, `node --no-warnings tiendas-web/pruebas/local.mjs <clave> --revisar`,
   revisión en el navegador (computadora y celular) y la skill `auditar-marca`.

## Entrega
Capturas de la portada y de un producto, la lista de pendientes para el cliente y qué falta para publicarla (skill `publicar`).
No subas `entrada/` al repositorio; borra la descarga cuando la tienda quede lista o pide al cliente que lo autorice para guardarla.
