#!/usr/bin/env python3
"""Prueba de herramientas/instagram.py con una descarga de Instagram inventada (negocio ficticio).

Uso: python3 tiendas-web/pruebas/instagram_prueba.py
Arma un .zip con la misma forma que la descarga oficial (acentos mal codificados incluidos, un mensaje privado que NO debe leerse),
corre la herramienta y revisa el resultado.
"""
import json, os, subprocess, sys, tempfile, zipfile
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
HERRAMIENTA = os.path.join(AQUI, "..", "herramientas", "instagram.py")
mal = lambda t: t.encode("utf-8").decode("latin-1")   # así guarda Meta los acentos


def foto(color):
    ruta = tempfile.mktemp(suffix=".jpg"); Image.new("RGB", (900, 900), color).save(ruta); return ruta


def main():
    tmp = tempfile.mkdtemp(prefix="ig-prueba-")
    zipr = os.path.join(tmp, "descarga.zip")
    perfil = {"profile_user": [{"string_map_data": {
        "Name": {"value": mal("Postres Doña Lupe")}, "Username": {"value": "postresdonalupe"},
        "Bio": {"value": mal("Pasteles y galletas artesanales 🍰 Pedidos por WhatsApp 33 1234 5678 · Envíos en Guadalajara")},
        "Email": {"value": "hola@example.com"}, "Phone Number": {"value": "+523312345678"}},
        "media_map_data": {"Profile Photo": {"uri": "media/profile/202401/perfil.jpg"}}}]}
    posts = [
        {"media": [{"uri": "media/posts/202611/a1.jpg", "creation_timestamp": 1763000000, "title": mal("Pastel de zanahoria 🥕\nRebanada $85 · pastel completo $650\n#pasteles #guadalajara")}]},
        {"media": [{"uri": "media/posts/202611/b1.jpg", "creation_timestamp": 1762000000, "title": mal("Caja de galletas de mantequilla (12 piezas) 850 pesos la docena... no, ¡$180!\n#galletas")},
                   {"uri": "media/posts/202611/b2.jpg", "creation_timestamp": 1762000000, "title": ""}]},
        {"media": [{"uri": "media/posts/202610/c1.jpg", "creation_timestamp": 1761000000, "title": mal("¡Gracias por 1,000 seguidores! 💛")}]},
    ]
    with zipfile.ZipFile(zipr, "w") as z:
        z.writestr("personal_information/personal_information/personal_information.json", json.dumps(perfil))
        z.writestr("your_instagram_activity/content/posts_1.json", json.dumps(posts))
        z.writestr("your_instagram_activity/messages/inbox/cliente_1/message_1.json", json.dumps({"messages": [{"content": "SECRETO"}]}))
        z.write(foto((214, 120, 60)), "media/profile/202401/perfil.jpg")
        for n, c in [("202611/a1", (230, 140, 50)), ("202611/b1", (200, 160, 110)), ("202611/b2", (190, 150, 100)), ("202610/c1", (240, 200, 60))]:
            z.write(foto(c), f"media/posts/{n}.jpg")
    salida = os.path.join(tmp, "borrador")
    r = subprocess.run([sys.executable, HERRAMIENTA, zipr, salida], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    assert r.returncode == 0, r.stderr
    b = json.load(open(os.path.join(salida, "instagram.json"), encoding="utf-8"))
    fallas = []
    revisa = lambda cond, msg: None if cond else fallas.append(msg)
    revisa(b["perfil"]["nombre"] == "Postres Doña Lupe", f"nombre con acentos: {b['perfil']['nombre']!r}")
    revisa(b["perfil"]["usuario"] == "postresdonalupe", "usuario")
    revisa(len(b["publicaciones"]) == 3, "3 publicaciones")
    p1, p2 = b["publicaciones"][0], b["publicaciones"][1]
    revisa(p1["precios"] == [85.0, 650.0], f"precios de la 1: {p1['precios']}")
    revisa(p1["nombreProbable"] == "Pastel de zanahoria", f"nombre probable: {p1['nombreProbable']!r}")
    revisa(180.0 in p2["precios"] and len(p2["fotos"]) == 2, f"carrusel con 2 fotos y $180: {p2}")
    revisa(b["publicaciones"][2]["precios"] == [], f"«1,000 seguidores» no es precio: {b['publicaciones'][2]['precios']}")
    revisa(os.path.exists(os.path.join(salida, "perfil.png")), "foto de perfil")
    revisa(all(os.path.exists(os.path.join(salida, f)) for p in b["publicaciones"] for f in p["fotos"]), "fotos en WebP")
    revisa(b["coloresSugeridos"], "colores sugeridos")
    revisa("SECRETO" not in open(os.path.join(salida, "instagram.json"), encoding="utf-8").read(), "no debe leer mensajes")
    print("\n".join("✗ " + f for f in fallas) if fallas else "✓ Todo bien")
    sys.exit(1 if fallas else 0)


if __name__ == "__main__":
    main()
