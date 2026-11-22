# tiendas-web: maqueta de tienda en línea

**Objetivo:** vender una tienda en línea lista (catálogo, carrito, Mercado Pago, panel, correos, envíos, SEO, avisos legales)
a negocios mexicanos que ya venden pero no tienen página. Cada cliente recibe **su propia copia** con su marca, su dominio
y sus cuentas. Nació de qpadel (qpadelshop.com), que es el primer cliente y vive en su propio repositorio.

## Decisiones

### Repositorios
- **Este repositorio (`tiendas-web`)** es el producto: código común, plantillas, pruebas, documentación, demos (`tiendas-web/demos/`)
  y las tiendas de los clientes en `clientes/<clave>/`. Un arreglo llega a todas con `python3 tiendas-web/build.py --todas`.
- **qpadel** vive en su propio repositorio (`qpadelshop`), con una copia de `tiendas-web/` y su carpeta `clientes/qpadel/`.
  Para llevarle un arreglo de la maqueta: copiar la carpeta `tiendas-web/` de aquí a allá (sin `demos/`), construir y revisar qpadel.

### Cloudflare en **nuestra** cuenta; dominio, cobros y paquetería a nombre del **cliente**
| Pieza | Cuenta | Por qué |
|---|---|---|
| Cloudflare (Pages, D1, KV, Worker reloj) | Nuestra, con verificación en 2 pasos | Un solo lugar para publicar y actualizar todas las tiendas; el cliente no tiene que aprender Cloudflare. Cada tienda tiene su proyecto, su base y sus secretos: un problema en una no toca a las demás |
| Dominio | Registrado **a nombre del cliente**, con los DNS apuntando a nuestra cuenta de Cloudflare | Es suyo; si se va, se lleva su dominio |
| Mercado Pago | Del cliente | El dinero cae directo a su cuenta; nosotros nunca tocamos los cobros. Su token se guarda como secreto en su proyecto |
| Resend (correos) | Nuestra, un dominio verificado por cliente | Más simple; el plan gratuito alcanza para varias tiendas pequeñas |
| Envíosperros | Del cliente | El saldo de guías es suyo |
| Panel `/admin` | El cliente | Su contraseña y su verificación en 2 pasos; no necesita acceso a Cloudflare |

En el contrato: el cliente es dueño de sus datos y de su dominio; si cancela, le entregamos su respaldo (pedidos, catálogo, clientes)
y puede llevarse la tienda pagando la licencia del código o migrarla a su propia cuenta de Cloudflare.

### Primer giro: suplementos
Demo ficticia en `tiendas-web/demos/demo-suplementos/` («Vértice Nutrición», productos y marcas inventados). Avisos propios del giro:
leyenda de COFEPRIS («Este producto no es un medicamento…») y devoluciones solo con sello intacto.

## Estado

### Fase 1 · Separar la marca del código ✅
- `clientes/<clave>/tienda.json` con datos, colores, fuente, textos, categorías, envío, módulos y datos legales (ver `tiendas-web/docs/TIENDA-JSON.md`).
- `build.py --tienda <clave>` / `--todas` → `dist/<clave>/_worker.js`. Se detiene si falta un dato o queda un marcador.
- Fotos, catálogo inicial, guías y legales por tienda; plantillas legales comunes en `tiendas-web/plantillas/legal/`.
- Módulos que se apagan sin dejar rastro en la tienda.
- `tiendas-web/pruebas/local.mjs` corre la tienda sin Cloudflare y revisa sus páginas.
- Comprobado al separarla: la tienda de qpadel generada con la maqueta quedó igual que la original.

### Pendientes conocidos (no se ven en la demo, pero hay que pulirlos)
- **Panel:** textos de pádel en apartados que la demo tiene apagados (proveedor, precios en euros, compras), el ejemplo de la plantilla CSV
  («Pala Ejemplo») y el formulario de producto con campos de pala (solo aparecen si la categoría se llama `palas`).
- **Ficha de producto:** la frase «pala de nivel… para juego de…» solo sale en productos con `nivel` (pádel).
- **Variantes:** el catálogo maneja «tallas»; para suplementos convendría «sabores» o «presentaciones» con el mismo mecanismo.
- **Minijuego:** está hecho para pádel (rivales y marcador); para otros giros habría que cambiar personajes y textos.
- **Correos:** el encabezado usa `logoCorreo` en texto; se puede cambiar por la imagen del logo.

### Fase 2 · Alta de una tienda en un día (skills)
`nueva-tienda`, `tienda-desde-instagram`, `importar-catalogo`, `textos-legales`, `publicar`, `auditar-marca` en `.claude/skills/`.

**Desde Instagram:** la mayoría de los clientes ya venden por Instagram. Con la descarga oficial de su cuenta (formato JSON),
`tiendas-web/herramientas/instagram.py` saca perfil, colores, publicaciones, precios escritos y fotos; la skill `tienda-desde-instagram`
convierte eso en la tienda, siempre confirmando productos y precios con la persona. No se scrapea Instagram.

### Fase 3 · Producto y operación
- Publicar la demo de suplementos en `demo-suplementos.pages.dev` para enseñarla.
- Página de venta de la maqueta (precios, qué incluye, contacto por WhatsApp).
- Otra demo de otro giro (ropa o comida) para enseñar que no es solo deportes.
- Script que publique todas las tiendas después de un arreglo (primero pruebas de cada una).
- Registro por tienda: versión publicada, fecha, plan contratado, contacto.

## Qué pone el cliente y qué ponemos nosotros
| Cliente | Nosotros |
|---|---|
| Logo, colores, fotos y lista de productos con precios | Configuración, carga del catálogo y diseño |
| Su cuenta de Mercado Pago | Conexión y prueba de pago |
| Dominio a su nombre (o se lo compramos a su nombre) | DNS, correo de envío (Resend) y verificación |
| Datos fiscales y políticas (devoluciones, envíos) | Textos legales a partir de las plantillas (recomendamos revisión de un abogado) |

Cobro sugerido: instalación + mensualidad (hosting, respaldos, actualizaciones y soporte por WhatsApp).
