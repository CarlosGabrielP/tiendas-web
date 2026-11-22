// Corre una tienda construida (dist/<clave>/_worker.js) en tu computadora, sin Cloudflare:
// D1 = SQLite de Node (con schema.sql), KV = memoria, secretos de prueba y sin llamadas a internet.
//
//   node --no-warnings tiendas-web/pruebas/local.mjs <clave>            → sirve la tienda en http://localhost:8787
//   node --no-warnings tiendas-web/pruebas/local.mjs <clave> --revisar  → abre las páginas principales y falla si alguna no responde 200
//                                                             o si aparece el nombre o el dominio de otra tienda
//   node --no-warnings tiendas-web/pruebas/local.mjs <clave> --guardar <carpeta>  → además guarda el HTML de cada página (para comparar versiones)
// Antes: python3 tiendas-web/build.py --tienda <clave>
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");   // tiendas-web/
const REPO = path.dirname(RAIZ);
const carpetaTienda = c => [path.join(REPO, "clientes", c), path.join(RAIZ, "demos", c)].find(d => existsSync(path.join(d, "tienda.json")));
const [clave, ...resto] = process.argv.slice(2);
if (!clave || clave.startsWith("--")) { console.error("Uso: node --no-warnings tiendas-web/pruebas/local.mjs <clave> [--revisar]"); process.exit(1); }
const revisar = resto.includes("--revisar") || resto.includes("--guardar");
const guardarEn = resto.includes("--guardar") ? resto[resto.indexOf("--guardar") + 1] : null;
const archivo = resto.includes("--worker") ? path.resolve(resto[resto.indexOf("--worker") + 1]) : path.join(REPO, "dist", clave, "_worker.js");
if (!existsSync(archivo)) { console.error(`No existe ${archivo}. Corre antes: python3 tiendas-web/build.py --tienda ${clave}`); process.exit(1); }
if (!carpetaTienda(clave)) { console.error(`No existe la tienda «${clave}» en clientes/ ni en tiendas-web/demos/`); process.exit(1); }
const tienda = JSON.parse(readFileSync(path.join(carpetaTienda(clave), "tienda.json"), "utf8"));

// ---------- D1 sobre SQLite ----------
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(path.join(RAIZ, "schema.sql"), "utf8"));
const plano = r => (r ? { ...r } : null);
class Sentencia {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Sentencia(this.sql, args.map(a => (a === undefined ? null : typeof a === "boolean" ? +a : a))); }
  async first(col) { const r = plano(sqlite.prepare(this.sql).get(...this.args)); return col ? r?.[col] ?? null : r; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args).map(plano), success: true, meta: {} }; }
  async raw() { return sqlite.prepare(this.sql).all(...this.args).map(r => Object.values(r)); }
  async run() {
    const st = sqlite.prepare(this.sql);
    if (/\breturning\b/i.test(this.sql)) { const results = st.all(...this.args).map(plano); return { results, success: true, meta: { changes: results.length } }; }
    const r = st.run(...this.args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}
const DB = { prepare: sql => new Sentencia(sql), batch: async ss => Promise.all(ss.map(s => s.run())), exec: async sql => sqlite.exec(sql) };

// ---------- KV en memoria ----------
const kv = new Map();
const CATALOGO = {
  async get(k, tipo) { const v = kv.get(k); if (v == null) return null; const t = typeof tipo === "object" ? tipo.type : tipo;
    return t === "json" ? JSON.parse(v) : t === "arrayBuffer" ? new TextEncoder().encode(v).buffer : v; },
  async getWithMetadata(k, tipo) { return { value: await this.get(k, tipo), metadata: null }; },
  async put(k, v) { kv.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
  async delete(k) { kv.delete(k); },
  async list({ prefix = "" } = {}) { return { keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
};

// Sin internet: cualquier llamada externa (Banxico, Mercado Pago, Resend…) responde 503
globalThis.fetch = async u => new Response(JSON.stringify({ error: "sin red en pruebas locales", url: String(u) }), { status: 503 });

const env = { DB, CATALOGO, ADMIN_PASSWORD: "prueba-local", TAREAS_TOKEN: "prueba-local" };
const ctx = { waitUntil: p => Promise.resolve(p).catch(() => {}), passThroughOnException() {} };
const worker = (await import(pathToFileURL(archivo).href)).default;
const pedir = (ruta, init) => worker.fetch(new Request(`https://${tienda.dominio}${ruta}`, init), env, ctx);

if (!revisar) {
  createServer(async (req, res) => {
    const cuerpo = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise(ok => { const b = []; req.on("data", c => b.push(c)); req.on("end", () => ok(Buffer.concat(b))); });
    const r = await pedir(req.url, { method: req.method, headers: req.headers, body: cuerpo });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(8787, () => console.log(`${tienda.nombre} en http://localhost:8787 (panel: /admin, contraseña «prueba-local»)`));
} else {
  // Las páginas del sitemap (categorías con productos, marcas, productos, guías…) más las fijas
  const mapa = await (await pedir("/sitemap.xml")).text();
  const delMapa = [...mapa.matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)].map(m => m[1] || "/");
  const rutas = ["/", "/sitemap.xml", "/robots.txt", "/feed/google.xml", "/admin", "/privacidad", "/terminos", "/devoluciones",
    "/no-existe-esta-pagina", ...delMapa.slice(0, 60)];
  // Nombres y dominios de las demás tiendas (y «qpadel», la tienda de donde salió el código): no deben aparecer en esta
  const { readdirSync } = await import("node:fs");
  const otras = [path.join(REPO, "clientes"), path.join(RAIZ, "demos")].filter(existsSync)
    .flatMap(d => readdirSync(d).map(c => path.join(d, c, "tienda.json"))).filter(existsSync).map(f => JSON.parse(readFileSync(f, "utf8")))
    .filter(t => t.clave !== clave);
  const AJENAS = [...new Set(["qpadel", ...otras.flatMap(t => [t.nombre, t.dominio])].map(x => String(x || "").toLowerCase()).filter(x => x.length > 3))]
    .filter(a => !String(tienda.nombre).toLowerCase().includes(a) && !String(tienda.dominio).toLowerCase().includes(a));
  let fallas = 0;
  if (guardarEn) mkdirSync(guardarEn, { recursive: true });
  for (const ruta of [...new Set(rutas)]) {
    const r = await pedir(ruta), texto = await r.text();
    const esperado = ruta === "/no-existe-esta-pagina" ? 404 : 200;
    const ajena = AJENAS.find(a => texto.toLowerCase().includes(a));
    const ok = r.status === esperado && !ajena && !texto.includes("{{tienda.");
    if (!ok) fallas++;
    console.log(`${ok ? "✓" : "✗"} ${r.status} ${ruta}${ajena ? `  ← aparece «${ajena}» (otra tienda)` : ""}${texto.includes("{{tienda.") ? "  ← marcador sin llenar" : ""}`);
    if (guardarEn) writeFileSync(path.join(guardarEn, (ruta.replace(/[^a-z0-9]+/gi, "_") || "_") + ".txt"), `${r.status}\n${texto}`);
  }
  console.log(fallas ? `\n${fallas} página(s) con problemas` : "\nTodo bien");
  process.exit(fallas ? 1 : 0);
}
