# Plantillas de diseño

`tienda.json` → `"plantilla": "<nombre>"`. El CSS de la plantilla se agrega al final del CSS de la tienda (index.html) y cambia
estructura y estilo; los colores siguen saliendo de `tienda.json` → `colores` (una plantilla clara necesita colores claros en
`fondo`, `tarjeta`, `texto`, `suave` y `borde`).

| Plantilla | Estilo | Colores que pide |
|---|---|---|
| `deportiva` | La base (la que usa qpadel): oscura, títulos en itálica y minúsculas, botones inclinados, franjas en la portada | Fondo oscuro |
| `fresca` | Clara y cercana: esquinas redondeadas, sombras suaves, botones redondos, portada con degradado y foto | Fondo claro |
| `boutique` | Cálida y elegante: títulos con serifa, líneas finas, esquinas rectas, mucho espacio | Fondo claro cálido |

Opcional en las tres: `textos.heroImagen` (ruta de una imagen, p. ej. `/img/portada.webp`) para la foto de la portada.
