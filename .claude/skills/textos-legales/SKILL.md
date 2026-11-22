---
name: textos-legales
description: Arma el aviso de privacidad, términos y condiciones y la política de envíos y devoluciones de una tienda con tiendas-web/plantillas/legal/ y los datos de tienda.json (legal, contacto, envío), incluidos los avisos del giro. Úsala al dar de alta una tienda o cuando cambien sus datos fiscales, de contacto o sus políticas.
---

# Textos legales

1. Por defecto la tienda usa `tiendas-web/plantillas/legal/` (privacidad, términos, devoluciones), que se llenan solas con `tienda.json`. Solo crea
   `clientes/<clave>/legal/` si la tienda necesita textos propios; en ese caso debe tener **las tres** páginas (más `facturacion.html` si factura).
2. Llena `tienda.json` → `legal`: `razonSocial`, `rfc`, `actualizacion`, `diasDevolucion`, `tiempoEntrega`, `condicionDevolucion`, `avisoGiro`.
   Si falta un dato, `[PENDIENTE: …]` visible y en la lista de pendientes; nunca inventes RFC, razón social ni domicilio.
3. Ajusta al giro:
   - Suplementos: leyenda «Este producto no es un medicamento. El consumo de este producto es responsabilidad de quien lo recomienda y de quien lo usa.»;
     devoluciones solo con sello intacto.
   - Alimentos: caducidad, conservación, sin devoluciones de perecederos salvo defecto.
   - Ropa: cambios de talla, prendas sin usar y con etiqueta.
4. Si cambias una plantilla de `tiendas-web/plantillas/legal/`, cambia a todas las tiendas que la usan: construye y revisa cada una (`tiendas-web/build.py --todas`).
5. Revisa en local `/privacidad`, `/terminos` y `/devoluciones` y que no aparezca otra tienda.
6. Al entregar, aclara que son una plantilla y que conviene que un abogado los revise antes de producción.
