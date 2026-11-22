#!/usr/bin/env python3
"""Lee la descarga oficial de Instagram de un negocio y deja un borrador para armar su tienda.

La descarga la pide el dueño de la cuenta: Instagram → Configuración → Centro de cuentas → Tu información y permisos →
Descargar tu información → (su cuenta de Instagram) → Formato JSON, calidad de fotos alta. Llega un .zip por correo.

Uso (desde la raíz del repositorio):
    python3 tiendas-web/herramientas/instagram.py <descarga.zip o carpeta> <carpeta de salida>

Guarda la descarga y el borrador en `entrada/` (no se sube al repositorio) o en una carpeta temporal.
La descarga trae también mensajes privados, seguidores y otros datos personales: este script **solo lee** el perfil
(nombre, usuario, bio, sitio, correo y teléfono públicos de negocio, foto de perfil) y las publicaciones (texto, fecha, fotos).
No abre mensajes ni listas de seguidores.

Salida:
    <salida>/instagram.json   perfil, colores sugeridos y publicaciones con precios detectados
    <salida>/fotos/*.webp     fotos de las publicaciones (máx. 1200 px, WebP)
    <salida>/perfil.png       foto de perfil (para el logo o el ícono)
"""
import json, os, re, sys, tempfile, zipfile
from datetime import datetime, timezone

try:
    from PIL import Image
except ImportError:
    sys.exit("Falta Pillow: pip install pillow")

EXT_FOTO = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def arreglar(t):
    """Meta guarda los acentos mal codificados (UTF-8 leído como latin-1): «cafÃ©» → «café»."""
    if not isinstance(t, str): return t
    try: return t.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError): return t


def abrir(origen):
    """Devuelve la carpeta con la descarga (descomprime el .zip en una carpeta temporal, solo los archivos necesarios)."""
    if os.path.isdir(origen): return origen
    if not zipfile.is_zipfile(origen): sys.exit(f"{origen} no es un .zip ni una carpeta")
    destino = tempfile.mkdtemp(prefix="instagram-")
    with zipfile.ZipFile(origen) as z:
        for n in z.namelist():
            bajo = n.lower()
            if ".." in n or n.startswith("/"): continue   # rutas raras: no se extraen
            if "message" in bajo or "follow" in bajo: continue   # mensajes y seguidores: nunca
            if bajo.endswith(".json") and ("posts_" in bajo or "personal_information" in bajo or "profile" in bajo) or os.path.splitext(bajo)[1] in EXT_FOTO and "/media/" in "/" + bajo:
                z.extract(n, destino)
    return destino


def buscar(raiz, patron):
    return sorted(os.path.join(c, a) for c, _, archivos in os.walk(raiz) for a in archivos if re.fullmatch(patron, a))


def leer_perfil(raiz):
    perfil = {}
    for ruta in buscar(raiz, r"personal_information\.json"):
        datos = json.load(open(ruta, encoding="utf-8"))
        for u in datos.get("profile_user", []):
            for k, v in (u.get("string_map_data") or {}).items():
                perfil[arreglar(k)] = arreglar(v.get("value", ""))
            foto = (u.get("media_map_data") or {}).get("Profile Photo", {}).get("uri")
            if foto: perfil["_foto"] = foto
    claves = {"nombre": ["Name", "Nombre"], "usuario": ["Username", "Nombre de usuario"], "bio": ["Bio", "Biografía", "Presentación"],
              "sitio": ["Website", "Sitio web"], "correo": ["Email", "Correo electrónico"], "telefono": ["Phone Number", "Número de teléfono"],
              "categoria": ["Category", "Categoría"]}
    salida = {k: next((perfil[o] for o in opciones if perfil.get(o)), "") for k, opciones in claves.items()}
    salida["_foto"] = perfil.get("_foto", "")
    return salida


def leer_publicaciones(raiz):
    pubs = []
    for ruta in buscar(raiz, r"posts_\d+\.json"):
        datos = json.load(open(ruta, encoding="utf-8"))
        for p in datos if isinstance(datos, list) else datos.get("ig_posts", []):
            medios = p.get("media", [])
            texto = arreglar(p.get("title") or (medios[0].get("title") if medios else "") or "")
            fecha = p.get("creation_timestamp") or (medios[0].get("creation_timestamp") if medios else 0)
            fotos = [m["uri"] for m in medios if os.path.splitext(m.get("uri", ""))[1].lower() in EXT_FOTO]
            if fotos: pubs.append({"texto": texto, "fecha": fecha, "fotos": fotos})
    pubs.sort(key=lambda p: p["fecha"], reverse=True)
    return pubs


PRECIO = re.compile(r"(?:\$\s?|mxn\s?)(\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,](\d{2}))?(?!\d)|(\d{1,3}(?:[,.]\d{3})+|\d{2,6})\s?(?:pesos|mxn|mn\b)", re.I)


def precios(texto):
    """Precios escritos en el texto: «$499», «$1,299.00», «850 pesos», «MXN 300»."""
    res = []
    for m in PRECIO.finditer(texto or ""):
        entero = (m.group(1) or m.group(3) or "").replace(",", "").replace(".", "")
        if entero and 10 <= int(entero) <= 500000: res.append(float(entero + ("." + m.group(2) if m.group(2) else "")))
    return res


def nombre_probable(texto):
    """Primera línea del texto, sin emojis, hashtags ni menciones (el nombre del producto suele ir ahí)."""
    for linea in (texto or "").splitlines():
        limpio = re.sub(r"[#@]\S+", "", linea)
        limpio = re.sub(r"[^\w\s.,'’%/+&()-]", "", limpio, flags=re.U).strip(" -–—·.,")
        if len(limpio) >= 3: return limpio[:80]
    return ""


def a_webp(origen, destino, lado=1200):
    with Image.open(origen) as im:
        im = im.convert("RGB"); im.thumbnail((lado, lado)); im.save(destino, "WEBP", quality=82)


def colores(rutas):
    """Colores más frecuentes (sin casi-blancos, casi-negros ni grises) de la foto de perfil y las primeras fotos."""
    cuenta = {}
    for r in rutas:
        try:
            with Image.open(r) as im:
                im = im.convert("RGB"); im.thumbnail((120, 120))
                for n, (rr, g, b) in im.quantize(8).convert("RGB").getcolors(120 * 120):
                    if max(rr, g, b) < 40 or min(rr, g, b) > 220 or max(rr, g, b) - min(rr, g, b) < 30: continue
                    clave = (rr // 24 * 24, g // 24 * 24, b // 24 * 24); cuenta[clave] = cuenta.get(clave, 0) + n
        except OSError:
            continue
    return ["#%02x%02x%02x" % c for c, _ in sorted(cuenta.items(), key=lambda x: -x[1])[:5]]


def main():
    if len(sys.argv) != 3: sys.exit(__doc__)
    raiz, salida = abrir(sys.argv[1]), sys.argv[2]
    os.makedirs(os.path.join(salida, "fotos"), exist_ok=True)
    perfil, pubs = leer_perfil(raiz), leer_publicaciones(raiz)
    if not perfil.get("usuario") and not pubs: sys.exit("No encontré el perfil ni publicaciones. ¿Es la descarga en formato JSON?")
    ruta = lambda uri: os.path.join(raiz, uri) if os.path.exists(os.path.join(raiz, uri)) else next(iter(buscar(raiz, re.escape(os.path.basename(uri)))), "")
    foto_perfil = ruta(perfil.pop("_foto")) if perfil.get("_foto") else ""
    if foto_perfil:
        with Image.open(foto_perfil) as im: im.convert("RGB").save(os.path.join(salida, "perfil.png"))
    hechas, sin_foto = [], 0
    for i, p in enumerate(pubs, 1):
        fotos = []
        for j, uri in enumerate(p["fotos"], 1):
            origen = ruta(uri)
            if not origen: sin_foto += 1; continue
            nombre = f"pub{i:03d}-{j}.webp"
            try: a_webp(origen, os.path.join(salida, "fotos", nombre)); fotos.append("fotos/" + nombre)
            except OSError: sin_foto += 1
        hechas.append({"id": f"pub{i:03d}", "fecha": datetime.fromtimestamp(p["fecha"], timezone.utc).strftime("%Y-%m-%d") if p["fecha"] else "",
                       "nombreProbable": nombre_probable(p["texto"]), "precios": precios(p["texto"]),
                       "hashtags": sorted(set(re.findall(r"#(\w+)", p["texto"]))), "texto": p["texto"], "fotos": fotos})
    paleta = colores(([foto_perfil] if foto_perfil else []) + [os.path.join(salida, f) for p in hechas[:12] for f in p["fotos"][:1]])
    borrador = {"origen": "descarga oficial de Instagram", "perfil": perfil, "coloresSugeridos": paleta,
                "resumen": {"publicaciones": len(hechas), "conPrecio": sum(1 for p in hechas if p["precios"]), "fotosSinArchivo": sin_foto},
                "publicaciones": hechas}
    json.dump(borrador, open(os.path.join(salida, "instagram.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    r = borrador["resumen"]
    print(f"@{perfil.get('usuario') or '?'} · {r['publicaciones']} publicaciones ({r['conPrecio']} con precio) · colores {', '.join(paleta) or '—'}")
    print(f"Borrador: {os.path.join(salida, 'instagram.json')}")


if __name__ == "__main__":
    main()
