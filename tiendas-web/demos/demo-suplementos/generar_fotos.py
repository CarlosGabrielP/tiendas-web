#!/usr/bin/env python3
"""Genera las fotos ficticias de la demo (envases con volumen, brillo y etiqueta) a partir de catalogo.js.

Uso (desde la raíz del repositorio): python3 tiendas-web/demos/demo-suplementos/generar_fotos.py [carpeta de la tienda]
El logo toma el color de texto de su tienda.json (claro en plantillas oscuras, oscuro en las claras).
Son ilustraciones de marcas inventadas: para una tienda real se usan las fotos del cliente.
"""
import json, os, re, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
FUENTES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img", "fuentes")
NAR, AMA, NEG = (255, 107, 26), (255, 210, 63), (14, 14, 16)
W = 1000


def fuente(tam, estilo="Bold", italica=False):
    f = ImageFont.truetype(os.path.join(FUENTES, "saira-latin-italica.woff2" if italica else "saira-latin.woff2"), tam)
    f.set_variation_by_name(estilo); return f


def rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def mezcla(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def cilindro(im, caja, color, radio=40):
    """Cuerpo cilíndrico: degradado horizontal (sombra a los lados, brillo cerca del centro izquierdo)."""
    x0, y0, x1, y1 = caja
    capa = Image.new("RGB", (x1 - x0, y1 - y0)); d = ImageDraw.Draw(capa)
    for x in range(x1 - x0):
        t = x / (x1 - x0)
        luz = 1 - abs(t - 0.38) * 1.6
        c = mezcla(mezcla(color, (0, 0, 0), 0.45), mezcla(color, (255, 255, 255), 0.25), max(0, min(1, luz)))
        d.line([(x, 0), (x, y1 - y0)], fill=c)
    mascara = Image.new("L", capa.size, 0); ImageDraw.Draw(mascara).rounded_rectangle([0, 0, *capa.size], radius=radio, fill=255)
    im.paste(capa, (x0, y0), mascara)
    if y1 - y0 < 120: return   # piezas chicas (tapas): sin reflejo
    brillo = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(brillo).rounded_rectangle([x0 + (x1 - x0) * .22, y0 + 30, x0 + (x1 - x0) * .29, y1 - 40], radius=20, fill=(255, 255, 255, 60))
    im.alpha_composite(brillo.filter(ImageFilter.GaussianBlur(8)))


def tapa(im, caja, color=(28, 28, 32)):
    x0, y0, x1, y1 = caja
    cilindro(im, caja, color, radio=14)
    d = ImageDraw.Draw(im)
    for x in range(x0 + 10, x1 - 6, 12): d.line([(x, y0 + 8), (x, y1 - 8)], fill=(255, 255, 255, 18), width=2)


def etiqueta(im, caja, marca, titulo, sabor, color_marca):
    x0, y0, x1, y1 = caja
    capa = Image.new("RGBA", im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(capa)
    d.rounded_rectangle(caja, radius=16, fill=(*NEG, 245))
    d.rectangle([x0, y1 - 46, x1, y1 - 40], fill=(*color_marca, 255))
    cx, ancho = (x0 + x1) / 2, x1 - x0 - 36
    d.text((cx, y0 + 42), marca.upper(), font=fuente(46, "Black Italic", True), fill=color_marca, anchor="mm")
    lineas, actual = [], ""
    for p in titulo.split():
        prueba = (actual + " " + p).strip()
        if d.textlength(prueba, font=fuente(34)) > ancho and actual: lineas.append(actual); actual = p
        else: actual = prueba
    lineas.append(actual)
    for i, l in enumerate(lineas[:3]): d.text((cx, y0 + 98 + i * 40), l, font=fuente(34), fill="white", anchor="mm")
    if sabor: d.text((cx, y1 - 74), sabor, font=fuente(28, "SemiBold"), fill=(200, 200, 205), anchor="mm")
    im.alpha_composite(capa)


def sombra(im, cx, ancho, y):
    s = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse([cx - ancho / 2, y - 22, cx + ancho / 2, y + 22], fill=(0, 0, 0, 70))
    im.alpha_composite(s.filter(ImageFilter.GaussianBlur(14)))


def fondo():
    im = Image.new("RGBA", (W, W), (255, 255, 255, 255)); d = ImageDraw.Draw(im)
    for y in range(W): d.line([(0, y), (W, y)], fill=(*mezcla((255, 255, 255), (236, 237, 240), y / W), 255))
    return im


def bote(im, cx, base, ancho, alto, color, marca, titulo, sabor, color_marca, chico=False):
    x0, x1 = int(cx - ancho / 2), int(cx + ancho / 2)
    sombra(im, cx, ancho * 1.05, base)
    cilindro(im, (x0, base - alto, x1, base), color)
    tapa(im, (x0 + 14, base - alto - (52 if not chico else 40), x1 - 14, base - alto + 14))
    m = 22 if not chico else 16
    etiqueta(im, (x0 + m, base - alto + int(alto * .22), x1 - m, base - int(alto * .14)), marca, titulo, sabor, color_marca)


def frasco(im, cx, base, color, marca, titulo):
    sombra(im, cx, 330, base)
    cilindro(im, (cx - 150, base - 470, cx + 150, base), color, radio=50)
    cilindro(im, (cx - 95, base - 540, cx + 95, base - 450), (240, 240, 242), radio=14)
    etiqueta(im, (cx - 132, base - 370, cx + 132, base - 70), marca, titulo, "", NAR if marca == "VÉRTICE" else AMA)


def caja_barras(im, color, marca, titulo, sabor):
    sombra(im, 500, 700, 760)
    d = ImageDraw.Draw(im)
    d.polygon([(180, 420), (760, 420), (840, 360), (260, 360)], fill=mezcla(color, (255, 255, 255), .25))
    d.polygon([(760, 420), (840, 360), (840, 700), (760, 760)], fill=mezcla(color, (0, 0, 0), .35))
    d.rectangle([180, 420, 760, 760], fill=color)
    etiqueta(im, (230, 450, 710, 730), marca, titulo, sabor, NAR)


def shaker(im, cx, base, alto=560, ancho=260):
    sombra(im, cx, ancho, base)
    d = ImageDraw.Draw(im)
    d.polygon([(cx - ancho / 2, base - alto), (cx + ancho / 2, base - alto), (cx + ancho / 2 - 30, base), (cx - ancho / 2 + 30, base)], fill=(*NAR, 255))
    cilindro(im, (int(cx - ancho / 2 - 8), base - alto - 90, int(cx + ancho / 2 + 8), base - alto + 10), NEG, radio=18)
    for i in range(6): d.line([(cx - ancho / 2 + 40, base - alto + 80 + i * 70), (cx - ancho / 2 + 70, base - alto + 80 + i * 70)], fill=(255, 255, 255), width=4)
    d.text((cx + 20, base - alto / 2), "VÉRTICE", font=fuente(int(ancho / 5.5), "Black Italic", True), fill=NEG, anchor="mm")


def logo():
    """Logo horizontal con fondo transparente; el texto toma el color de texto de la tienda."""
    colores = json.load(open(os.path.join(AQUI, "tienda.json"), encoding="utf-8"))["colores"]
    texto, acento = rgb(colores["texto"]), rgb(colores["primario"])
    im = Image.new("RGBA", (900, 140), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.polygon([(10, 112), (52, 22), (94, 112), (75, 112), (52, 62), (29, 112)], fill=NAR)
    d.text((112, 6), "vértice", font=fuente(88, "Black Italic", True), fill=texto)
    w = d.textlength("vértice ", font=fuente(88, "Black Italic", True))
    d.text((112 + w, 6), "nutrición", font=fuente(88, "Black Italic", True), fill=acento)
    im.crop(im.getbbox()).save(os.path.join(AQUI, "img", "logo.png"), optimize=True)


def portada():
    """Imagen de la portada (plantillas fresca y boutique): varios productos juntos sobre fondo transparente."""
    im = Image.new("RGBA", (1340, 1000), (0, 0, 0, 0))
    shaker(im, 130, 930, alto=420, ancho=200)
    bote(im, 470, 900, 420, 560, (107, 62, 38), "Vértice", "Whey Protein 2 lb", "Chocolate", NAR)
    bote(im, 850, 910, 280, 350, (242, 242, 242), "Vértice", "Creatina", "", NAR, chico=True)
    frasco(im, 1170, 930, (27, 108, 168), "KORA", "Omega 3")
    im.save(os.path.join(AQUI, "img", "portada.webp"), "WEBP", quality=86)


def main():
    txt = open(os.path.join(AQUI, "catalogo.js"), encoding="utf-8").read()
    os.makedirs(os.path.join(AQUI, "img", "productos"), exist_ok=True)
    for linea in txt.splitlines():
        m = re.search(r'id:"([^"]+)".*?nombre:"([^"]+)",categoria:"([^"]+)"', linea)
        if not m: continue
        pid, nombre, cat = m.groups()
        color = rgb(re.search(r'color:"(#[0-9a-f]{6})"', linea).group(1))
        sabores = re.findall(r'talla:"([^"]+)"', linea)
        marca = nombre.split()[0]
        titulo = re.sub(r"\s*\(.*?\)", "", " ".join(nombre.split()[1:]))
        cm = NAR if marca == "Vértice" else AMA
        im = fondo()
        if cat in ("proteinas",):
            grande = "5 lb" in nombre
            bote(im, 500, 830, 470 if grande else 420, 600 if grande else 540, color, marca, titulo, sabores[0] if sabores else "", cm)
        elif cat in ("creatinas", "preentrenos", "aminoacidos", "colageno"):
            bote(im, 500, 820, 340, 430, color, marca, titulo, sabores[0] if sabores else "", cm, chico=True)
        elif cat == "vitaminas":
            frasco(im, 500, 830, color, marca.upper(), titulo)
        elif cat == "snacks":
            caja_barras(im, color, marca, titulo, sabores[0] if sabores else "")
        elif cat == "kits":
            bote(im, 310, 850, 360, 480, (107, 62, 38), "Vértice", "Whey Protein 2 lb", "Chocolate", NAR)
            bote(im, 610, 850, 240, 300, (242, 242, 242), "Vértice", "Creatina 300 g", "", NAR, chico=True)
            shaker(im, 845, 850, alto=380, ancho=170)
        else:
            shaker(im, 500, 830)
        im.convert("RGB").save(os.path.join(AQUI, "img", "productos", pid + ".webp"), "WEBP", quality=84)
        print(pid)
    portada()
    logo()


if __name__ == "__main__":
    main()
