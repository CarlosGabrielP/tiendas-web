---
name: auditar-marca
description: Busca datos de una tienda escritos a mano en el código (nombre, dominio, correos, WhatsApp, dirección, colores, textos de pádel) y entrega un inventario de lo que falta pasar a tienda.json. Úsala antes y durante la Fase 1 de la maqueta, antes de dar de alta una tienda nueva, o cuando pregunten «¿qué tan lista está la maqueta?».
---

# Auditar marca

Objetivo: saber qué falta para que el código no tenga datos de ninguna tienda (ver `tiendas-web/docs/MAQUETA.md`, Fase 1).

## Pasos
1. Busca en `index.html admin.html worker.js seo.js tareas.js envios.js resenas.js ficha.js proveedor.js precio.js compras.js reloj/`
   (dentro de `tiendas-web/`, sin `demos/`, `plantillas/`, `docs/`; excluye `clientes/` y `dist/`):
   - Marca: `qpadel`, `qpadelshop`, `QP-` (la tienda de donde salió el código) y los nombres y dominios de las tiendas de `clientes/` y `demos/`.
   - Contacto: correos `@qpadelshop.com`, `wa.me/`, teléfonos (`33 1104`, `52\d{10}`), la dirección (`Joaquín Amaro`, `44700`, `Guadalajara`).
   - Diseño: colores en hexadecimal fuera de `:root` (sobre todo en las plantillas de correo), la fuente `Saira`.
   - Giro: `pala`, `pádel`, `paletero`, `Bullpadel`, `nivel`, `juego:` (atributos de producto propios del pádel).
   - Legales: razón social, RFC, nombres de responsables.
2. Agrupa cada hallazgo por **tipo** y **archivo**, con `archivo:línea`. Distingue:
   - **Dato de tienda** → debe ir a `tienda.json` (propón el nombre del campo, p. ej. `contacto.whatsapp`).
   - **Texto del giro** → debe depender del módulo o del giro.
   - **Aceptable** → comentarios, nombres internos sin efecto visible (dilo, no lo cuentes como pendiente).
3. Construye cada tienda y revísala: `python3 tiendas-web/build.py --todas` y `node --no-warnings tiendas-web/pruebas/local.mjs <clave> --revisar`
   (falla si una página no responde o si aparece el nombre o el dominio de otra tienda). Busca además palabras del giro de pádel en el HTML visible de sus páginas
   (`--guardar <carpeta>` guarda cada página para revisarla).

## Entrega
Una tabla corta: tipo · archivo · cuántas · campo propuesto; luego el total de pendientes y los 5 cambios que más avanzan.
No cambies código salvo que lo pidan.
