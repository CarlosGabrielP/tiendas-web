# `clientes/<clave>/tienda.json`

Todo lo que distingue a una tienda de otra. `build.py` lo inserta donde el código dice:

| Marcador | Inserta | Dónde se puede usar |
|---|---|---|
| `{{tienda.campo}}` | texto (sin comillas, `<`, `>`, `\`, saltos de línea ni `${`) | en cualquier lugar, también dentro de "cadenas" de JS |
| `{{html:tienda.campo}}` | texto con etiquetas HTML | solo en HTML o en plantillas `` `…` `` de JS |
| `{{json:tienda.campo}}` | el valor como JSON (objetos, listas) | en JS |

Un texto puede usar otros campos: `"desc": "Lo nuevo en {{tienda.nombre}}"`. Los campos que empiezan con `_` los calcula `build.py`
(`_categoriasPublicas`, `_listaCategorias`, `_enlacesAyuda`, `_enlacesLegales`) y no se escriben a mano.

Ejemplo completo: `tiendas-web/demos/demo-suplementos/tienda.json`.

## Identidad y contacto
| Campo | Ejemplo | Para qué |
|---|---|---|
| `clave` | `demo-suplementos` | Igual que el nombre de la carpeta. Prefijo de firmas, cabeceras y archivos descargados. **No cambiarla** en una tienda publicada (cierra las sesiones del panel e invalida los códigos de recuperación). |
| `nombre` | `Vértice Nutrición` | Nombre visible en títulos, correos y textos |
| `giro` | `suplementos` | Referencia (aún no cambia comportamiento) |
| `dominio` / `proyecto` | `vertice.mx` / `vertice` | Dominio público y proyecto de Cloudflare Pages (`<proyecto>.pages.dev`). Una demo puede usar `dominio = <proyecto>.pages.dev` |
| `prefijo` | `VN` | Folios de pedido (`VN-261122-ABCDE`) y códigos de premio. No cambiar con pedidos existentes |
| `descriptorTarjeta` | `VERTICE` | Texto en el estado de cuenta (Mercado Pago, máx. 13 caracteres, mayúsculas) |
| `responsable` | | Persona que firma los envíos (Envíosperros) |
| `correo.remitente` / `contacto` / `avisos` | | Remitente de correos (dominio verificado en Resend), contacto público y destino de las alertas |
| `telefono`, `telefonoIntl`, `telefono10`, `whatsapp` | `33 1104 7821`, `+52 33 1104 7821`, `3311047821`, `523311047821` | Formatos del mismo número |
| `direccion.*` | `completa`, `calleCompleta`, `calle`, `numero`, `cp`, `ciudad`, `estado` | Pie de página, correos, datos para Google y origen de envíos |
| `emoji` | `💪` | Emoji de la marca en correos y avisos |
| `logoCorreo` (html) | | Encabezado de los correos |

## Diseño
- `colores`: `primario`, `primarioOscuro`, `primarioClaro`, `acento`, `fondo`, `tarjeta`, `texto`, `suave`, `borde`, `barraNavegador`.
- `fuente`: `nombre`, `normal`, `italica` (archivos `.woff2` en `img/fuentes/`, con licencia libre).
- Fotos: `img/logo.png` (fondo transparente, se ve sobre negro), `img/icono.png` (512×512), `img/apple-touch-icon.png` (180×180), `img/productos/*.webp`.

## Textos (`textos`)
`titulo` y `descripcion` (portada y buscadores), `h1`, `eslogan` (html), `hero`, `buscador`, `pie`, `enlacesPie` (html), `aviso` (barra de arriba),
`entrega`, `carritoVacio`, `rss`, `tipoProducto` (Google Merchant), `categoriaMP` (categoría de Mercado Pago: `sports`, `others`…), `hashtags`,
`novedades.{titulo,desc,intro}` (admiten `{temp}` = temporada más nueva y `{temp|otro texto}`), `marcas.{titulo,desc,h1,tituloMarca}`, `guias.{titulo,desc,catalogo}`.

## Catálogo
- `categorias`: objeto ordenado `{ clave: { nombre, slug, h1, titulo, desc, intro, alias[], hashtag, paquete, costo } }`.
  `slug` es la dirección (`/proteinas`); `alias` son palabras que acepta el CSV; `paquete` = medidas para cotizar envíos (o `null` = el primer paquete);
  `costo` solo se usa con el módulo `preciosEuro`. Los costos no se publican en la tienda.
- `categoriaPrincipal`: la que define «novedades por temporada» y pide complementos en el carrito.
- `sugerencias.conPrincipal` / `sugerencias.orden`: qué categorías sugerir para completar la compra.

## Envío
`envio.gratisDesde` (número), `envio.gratisDesdeTexto` (`$1,499.00`), `envio.costo`; `envios.paquetes` y `envios.descripcion` (Envíosperros).

## Módulos (`modulos`)
| Módulo | Qué incluye |
|---|---|
| `envios` | Guías y rastreo con Envíosperros |
| `resenas` | Reseñas por correo después de la entrega |
| `compras` | Compras de inventario y costo real (costos en euros) |
| `preciosEuro` | Precio dinámico por costo en euros, tipo de cambio de Banxico |
| `proveedor` | Sincronización diaria con el proveedor de pádel |
| `fichas` | Completar fichas técnicas con PadelProShop + Gemini |
| `recomendador` | «Encuentra tu pala» (solo pádel) |
| `juego` | Minijuego «¿Te atreves?» (pádel) |
| `pistaPadel` | Dibujo de la pista en la portada |

Apagado = no aparece en la tienda (el HTML marcado con `<!--MODULO:x-->…<!--/MODULO:x-->` o `/*MODULO:x*/…/*/MODULO:x*/` se quita al construir),
su apartado del panel se oculta, su API responde 404 y sus tareas programadas no corren.

## Legal (`legal`, para `tiendas-web/plantillas/legal/`)
`razonSocial`, `rfc`, `actualizacion`, `diasDevolucion`, `tiempoEntrega` (html), `condicionDevolucion` (html), `avisoGiro` (html: avisos propios del giro,
p. ej. la leyenda de COFEPRIS para suplementos). Un dato desconocido se escribe `[PENDIENTE: …]`, nunca se inventa.
