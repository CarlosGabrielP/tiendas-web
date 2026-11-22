#!/usr/bin/env python3
"""Genera dist/<tienda>/_worker.js para Cloudflare Pages a partir del código común (esta carpeta, tiendas-web/)
y de la carpeta de la tienda: clientes/<clave>/ (tiendas de clientes) o tiendas-web/demos/<clave>/ (demostraciones).

Uso (desde la raíz del repositorio):
      python3 tiendas-web/build.py --tienda <clave>
      python3 tiendas-web/build.py --todas
Luego publica la carpeta dist/<tienda>/ (Create deployment en Pages, o la API).
Los datos de cada tienda están en <carpeta de la tienda>/tienda.json y se insertan donde el código dice {{tienda.campo}}.
"""
import argparse, base64, json, os, re, subprocess, sys

RAIZ = os.path.dirname(os.path.abspath(__file__))       # tiendas-web/: código común de la maqueta
REPO = os.path.dirname(RAIZ)                            # raíz del repositorio (dist/ y clientes/ viven aquí)
CARPETAS_TIENDAS = [os.path.join(REPO, "clientes"), os.path.join(RAIZ, "demos")]


def carpeta_tienda(clave):
    """Ruta (relativa a tiendas-web/) de la carpeta de una tienda; se detiene si no existe o si está repetida."""
    halladas = [os.path.join(c, clave) for c in CARPETAS_TIENDAS if os.path.isfile(os.path.join(c, clave, "tienda.json"))]
    if not halladas: sys.exit(f"No existe la tienda «{clave}» (busqué clientes/{clave}/ y tiendas-web/demos/{clave}/ con tienda.json)")
    if len(halladas) > 1: sys.exit(f"La tienda «{clave}» está repetida en clientes/ y en tiendas-web/demos/")
    return os.path.relpath(halladas[0], RAIZ)


def todas_las_tiendas():
    return sorted(d for c in CARPETAS_TIENDAS if os.path.isdir(c) for d in os.listdir(c) if os.path.isfile(os.path.join(c, d, "tienda.json")))
TIPOS = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".woff2": "font/woff2"}


TIENDA = {}   # tienda.json de la tienda que se está construyendo (lo llena cargar_tienda)
# {{tienda.campo}} texto · {{html:tienda.campo}} texto con etiquetas HTML (solo en HTML o en plantillas `…`) · {{json:tienda.campo}} valor en JSON
MARCADOR = re.compile(r"\{\{(json:|html:)?tienda\.([A-Za-z0-9_.]+)\}\}")
PROHIBIDOS = set('"`\\<>\n\r')   # caracteres que romperían el JS o el HTML donde se insertan los textos (y «${»)
PROHIBIDOS_HTML = set('`\\\n\r')


def cargar_tienda(clave):
    ruta = os.path.join(RAIZ, carpeta_tienda(clave), "tienda.json")
    t = json.load(open(ruta, encoding="utf-8"))
    if t.get("clave") != clave: sys.exit(f"tienda.json: «clave» debe ser {clave!r}")
    t.setdefault("sitio", "https://" + t["dominio"])
    # Campos opcionales (agregados después): valores por defecto para que las tiendas existentes sigan construyendo igual
    t.setdefault("variante", {"singular": "talla", "Singular": "Talla", "plural": "tallas", "Plural": "Tallas", "articulo": "una", "ejemplo": "Ej. S, M, L, XL"})
    t.setdefault("tiempos", {"zona": "America/Mexico_City", "envioHoyHasta": 14, "diasEnvio": [1, 2, 3, 4, 5], "cortePedidoHora": 21,
                             "diasMaxPedido": 10, "diasTransito": [2, 3], "diasCerrado": []})
    textos = t.setdefault("textos", {})
    textos.setdefault("avisoProducto", "")
    textos.setdefault("beneficios", [{"ico": "💬", "titulo": "Asesoramiento", "texto": "Te ayudamos a elegir"}])
    for m in ("whatsapp", "demo"): t.setdefault("modulos", {}).setdefault(m, False)
    esc = lambda x: str(x).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    t["_beneficiosHtml"] = " ".join(f'<div class="beneficio"><span class="ico">{esc(b["ico"])}</span><div><b>{esc(b["titulo"])}</b>{esc(b["texto"])}</div></div>'
                                       for b in textos["beneficios"])
    # Campos calculados (empiezan con _): no se escriben en tienda.json
    slugs = [c["slug"] for c in t.get("categorias", {}).values()]
    t["_listaCategorias"] = ", ".join(slugs[:-1]) + " o " + slugs[-1] if len(slugs) > 1 else "".join(slugs)
    t["_categoriasPublicas"] = {k: {c: v[c] for c in ("nombre", "slug", "h1")} for k, v in t.get("categorias", {}).items()}   # para index.html
    # Pie de página → Ayuda y menú de las páginas legales: solo las que tiene la tienda
    nombres = paginas_legales(clave)[1]
    t["_enlacesAyuda"] = "<br>".join(f'<a href="/{n}">{texto}</a>' for n, texto in [("devoluciones", "Envíos, cambios y devoluciones"), ("facturacion", "Facturación"),
                                     ("terminos", "Términos y condiciones"), ("privacidad", "Aviso de privacidad")] if n in nombres)
    t["_enlacesLegales"] = "".join(f'<a href="/{n}">{texto}</a>' for n, texto in [("terminos", "Términos y condiciones"), ("devoluciones", "Envíos, cambios y devoluciones"),
                                   ("facturacion", "Facturación"), ("privacidad", "Aviso de privacidad"), ("bases-juego", "Bases del reto")] if n in nombres)
    TIENDA.clear(); TIENDA.update(t)


ORDEN_LEGALES = ["privacidad", "terminos", "devoluciones", "facturacion", "bases-juego"]


def paginas_legales(clave):
    """Carpeta y nombres de las páginas legales: las propias de la tienda (<carpeta de la tienda>/legal/) o las plantillas comunes (plantillas/legal/)."""
    propia = os.path.join(carpeta_tienda(clave), "legal")
    carpeta = propia if os.path.isdir(os.path.join(RAIZ, propia)) else os.path.join("plantillas", "legal")
    nombres = sorted((f[:-5] for f in os.listdir(os.path.join(RAIZ, carpeta)) if f.endswith(".html") and not f.startswith("_")),
                     key=lambda n: (ORDEN_LEGALES.index(n) if n in ORDEN_LEGALES else 99, n))
    return carpeta, nombres


def pagina_legal(carpeta, nombre):
    """Una página legal. Las plantillas empiezan con <!--LEGAL {"titulo", "desc"}--> y se arman con _cabeza.html y _pie.html."""
    txt = leer(os.path.join(carpeta, nombre + ".html"))
    if not txt.startswith("<!--LEGAL "): return txt
    meta = json.loads(txt[len("<!--LEGAL "):txt.index("-->")])
    cabeza = leer(os.path.join(carpeta, "_cabeza.html")).replace("@@TITULO@@", meta["titulo"]).replace("@@DESC@@", meta["desc"]).replace("@@RUTA@@", nombre)
    return cabeza + txt[txt.index("-->") + 3:].lstrip("\n") + leer(os.path.join(carpeta, "_pie.html"))


def valor_tienda(campo, modo, origen):
    v = TIENDA
    for parte in campo.split("."):
        if not isinstance(v, dict) or parte not in v: sys.exit(f"{origen}: falta «{campo}» en {carpeta_tienda(TIENDA['clave'])}/tienda.json")
        v = v[parte]
    if modo == "json:": return con_tienda(json.dumps(v, ensure_ascii=False).replace("</", "<\\/"), f"tienda.json ({campo})")
    if v is None or isinstance(v, (dict, list)): sys.exit(f"{origen}: «{campo}» debe ser texto o número en tienda.json")
    v = str(v)
    if modo == "html:":
        if PROHIBIDOS_HTML & set(v) or "${" in v: sys.exit(f"tienda.json: «{campo}» no puede llevar `, ${{, \\ ni saltos de línea")
    elif PROHIBIDOS & set(v) or "${" in v:
        sys.exit(f"tienda.json: «{campo}» no puede llevar comillas, <, >, ${{, \\ ni saltos de línea (si lleva HTML, usa el marcador html:)")
    return con_tienda(v, f"tienda.json ({campo})")   # un texto puede usar otros campos, p. ej. {{tienda.nombre}}


def con_tienda(texto, origen):
    return MARCADOR.sub(lambda m: valor_tienda(m.group(2), m.group(1), origen), texto)


def leer(nombre):
    with open(os.path.join(RAIZ, nombre), encoding="utf-8") as f:
        return con_tienda(f.read(), nombre)


def de_tienda(*partes):
    return os.path.join(carpeta_tienda(TIENDA["clave"]), *partes)


def catalogo_inicial(html):
    """Inserta <carpeta de la tienda>/catalogo.js en el bloque del catálogo de index.html y lo devuelve también como lista."""
    texto = leer(de_tienda("catalogo.js"))
    bloque = texto[texto.index("["):texto.rindex("]") + 1]   # sin los comentarios de arriba
    i = html.index("/*CATALOGO_INICIO*/") + len("/*CATALOGO_INICIO*/")
    j = html.index("/*CATALOGO_FIN*/")
    if html[i:j].strip() != "[]": sys.exit("index.html: el catálogo va en <carpeta de la tienda>/catalogo.js; deja el bloque como /*CATALOGO_INICIO*/[]/*CATALOGO_FIN*/")
    # El bloque es un literal de JS (con comentarios); node lo convierte a JSON.
    salida = subprocess.run(["node", "-e", "process.stdout.write(JSON.stringify(eval(require('fs').readFileSync(0,'utf8'))))"],
                            input=bloque, capture_output=True, text=True, check=True)
    return html[:i] + bloque + html[j:], json.loads(salida.stdout)


def estaticos():
    res, base = {}, os.path.join(RAIZ, de_tienda())
    for carpeta, _, archivos in os.walk(os.path.join(base, "img")):
        for a in sorted(archivos):
            ext = os.path.splitext(a)[1].lower()
            if ext in TIPOS:
                ruta = os.path.join(carpeta, a)
                res["/" + os.path.relpath(ruta, base).replace(os.sep, "/")] = [TIPOS[ext], base64.b64encode(open(ruta, "rb").read()).decode()]
    return res


def sin_modulos_apagados(html, origen):
    """Lo marcado con data-modulo="x" queda oculto (display:none) si el módulo x está apagado en tienda.json."""
    modulos = TIENDA.get("modulos", {})
    def cambiar(m):
        nombre = m.group(1)
        if nombre not in modulos: sys.exit(f"{origen}: data-modulo=\"{nombre}\" no está en tienda.json → modulos")
        return m.group(0) if modulos[nombre] else m.group(0) + ' style="display:none"'
    html = re.sub(r'data-modulo="([A-Za-z]+)"', cambiar, html)
    # Bloques <!--MODULO:x-->…<!--/MODULO:x--> (HTML) y /*MODULO:x*/…/*/MODULO:x*/ (JS): se quitan si x está apagado
    def bloque(m):
        nombre = m.group(2)
        if nombre not in modulos: sys.exit(f"{origen}: MODULO:{nombre} no está en tienda.json → modulos")
        return m.group(3) if modulos[nombre] else ""   # encendido: queda el contenido sin las marcas
    html = re.sub(r"(<!--MODULO:([A-Za-z]+)-->)(.*?)<!--/MODULO:\2-->", bloque, html, flags=re.S)
    html = re.sub(r"(/\*MODULO:([A-Za-z]+)\*/)(.*?)/\*/MODULO:\2\*/", bloque, html, flags=re.S)
    restos = set(re.findall(r"MODULO:([A-Za-z]+)", html))
    if any(not modulos.get(r, True) for r in restos): sys.exit(f"{origen}: quedó un bloque MODULO sin cerrar")
    return html


def construir(clave):
    cargar_tienda(clave)
    publico, admin, worker = leer("index.html"), leer("admin.html"), leer("worker.js")
    publico, admin = sin_modulos_apagados(publico, "index.html"), sin_modulos_apagados(admin, "admin.html")
    if admin.count("/*GENERADOR_QR*/") != 1: sys.exit("Marcador /*GENERADOR_QR*/ no encontrado en admin.html")
    admin = admin.replace("/*GENERADOR_QR*/", leer("qr.js"))   # QR para dar de alta la verificación en 2 pasos
    motor = leer("juego/motor.js")
    publico = publico.replace("/*MOTOR_JUEGO*/", motor)          # el navegador y el servidor usan el MISMO motor
    if worker.count("__MOTOR_JUEGO__") != 1: sys.exit("Marcador __MOTOR_JUEGO__ no encontrado")
    worker = worker.replace("__MOTOR_JUEGO__", motor)
    if worker.count("__PRECIO__") != 1: sys.exit("Marcador __PRECIO__ no encontrado")
    worker = worker.replace("__PRECIO__", leer("precio.js"))   # precio por costo puesto en México
    if admin.count("/*PRECIO_COSTO*/") != 1: sys.exit("Marcador /*PRECIO_COSTO*/ no encontrado en admin.html")
    admin = admin.replace("/*PRECIO_COSTO*/", leer("precio.js"))
    if worker.count("__SEO__") != 1: sys.exit("Marcador __SEO__ no encontrado")
    worker = worker.replace("__SEO__", leer("seo.js"))   # páginas para buscadores
    if worker.count("__TAREAS__") != 1: sys.exit("Marcador __TAREAS__ no encontrado")
    worker = worker.replace("__TAREAS__", leer("tareas.js"))   # respaldo diario y alertas (las dispara el Worker reloj)
    if worker.count("__ENVIOS__") != 1: sys.exit("Marcador __ENVIOS__ no encontrado")
    worker = worker.replace("__ENVIOS__", leer("envios.js"))   # guías y rastreo con Envíosperros
    if worker.count("__RESENAS__") != 1: sys.exit("Marcador __RESENAS__ no encontrado")
    worker = worker.replace("__RESENAS__", leer("resenas.js"))   # reseñas después de la entrega
    if worker.count("__FICHA__") != 1: sys.exit("Marcador __FICHA__ no encontrado")
    worker = worker.replace("__FICHA__", leer("ficha.js"))   # completar fichas técnicas (PadelProShop + Gemini)
    if worker.count("__COMPRAS__") != 1: sys.exit("Marcador __COMPRAS__ no encontrado")
    worker = worker.replace("__COMPRAS__", leer("compras.js"))   # compras de inventario y costo real
    if worker.count("__PROVEEDOR__") != 1: sys.exit("Marcador __PROVEEDOR__ no encontrado")
    worker = worker.replace("__PROVEEDOR__", leer("proveedor.js"))   # sincronización diaria con el proveedor
    # Páginas legales → /<nombre> (propias de la tienda o plantillas comunes)
    carpeta_legal, nombres = paginas_legales(clave)
    legales = {n: pagina_legal(carpeta_legal, n) for n in nombres}
    for n in ["privacidad", "terminos", "devoluciones"]:
        if n not in legales: sys.exit(f"Falta la página legal {n}.html en {carpeta_legal} (obligatoria)")
    # Guías de compra: <carpeta de la tienda>/guias/<slug>.html, con sus datos (título, descripción…) en un comentario JSON en la primera línea
    guias, carpeta_guias = {}, os.path.join(RAIZ, de_tienda("guias"))
    for f in sorted(os.listdir(carpeta_guias)) if os.path.isdir(carpeta_guias) else []:
        if f.endswith(".html"):
            txt = leer(de_tienda("guias", f))
            meta = json.loads(txt[txt.index("<!--") + 4:txt.index("-->")])
            guias[f[:-5]] = {**meta, "html": txt[txt.index("-->") + 3:].strip()}
    publico, cat = catalogo_inicial(publico)
    est = estaticos()
    for marca, valor in [("__HTML_PUBLICO__", publico), ("__HTML_ADMIN__", admin), ("__HTML_LEGALES__", legales), ("__ESTATICOS__", est), ("__CATALOGO_INICIAL__", cat), ("__GUIAS__", guias)]:
        if worker.count(marca) != 1:
            sys.exit(f"Marcador {marca} no encontrado en worker.js")
        worker = worker.replace(marca, json.dumps(valor, ensure_ascii=False))
    if "{{tienda." in worker: sys.exit("Quedó un marcador {{tienda.…}} sin sustituir")
    salida = os.path.join(REPO, "dist", clave)
    os.makedirs(salida, exist_ok=True)
    with open(os.path.join(salida, "_worker.js"), "w", encoding="utf-8") as f:
        f.write(worker)
    # Worker aparte de tareas programadas: fuera de la carpeta que se sube a Pages (no debe publicarse como archivo)
    os.makedirs(os.path.join(REPO, "dist", "reloj"), exist_ok=True)
    with open(os.path.join(REPO, "dist", "reloj", clave + ".js"), "w", encoding="utf-8") as f:
        f.write(leer("reloj/worker.js"))
    print(f"dist/{clave}/_worker.js: {len(worker)//1024} KB · {len(cat)} productos iniciales · {len(est)} imágenes")


def main():
    ap = argparse.ArgumentParser(description="Construye la tienda para Cloudflare Pages")
    ap.add_argument("--tienda", help="clave de la tienda: clientes/<clave> o tiendas-web/demos/<clave>")
    ap.add_argument("--todas", action="store_true", help="construye todas las tiendas (clientes y demos)")
    a = ap.parse_args()
    if not a.todas and not a.tienda: ap.error("indica --tienda <clave> o --todas")
    claves = todas_las_tiendas() if a.todas else [a.tienda]
    for clave in claves: construir(clave)


if __name__ == "__main__":
    main()
