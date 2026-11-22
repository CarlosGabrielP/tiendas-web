// Generador de códigos QR para el panel (modo byte, corrección de errores nivel M, versiones 1–10).
// Escrito para este proyecto, sin librerías externas: solo se usa para mostrar el código de alta de la
// verificación en 2 pasos. Sigue la norma ISO/IEC 18004.
const QR = (() => {
  const EC_POR_BLOQUE = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // nivel M, por versión
  const BLOQUES = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const modulosDatos = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const palabrasDatos = v => Math.floor(modulosDatos(v) / 8) - EC_POR_BLOQUE[v] * BLOQUES[v];
  // Aritmética en GF(256) con el polinomio 0x11D
  const mult = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  function divisor(grado) {
    const r = new Array(grado).fill(0); r[grado - 1] = 1; let raiz = 1;
    for (let i = 0; i < grado; i++) { for (let j = 0; j < r.length; j++) { r[j] = mult(r[j], raiz); if (j + 1 < r.length) r[j] ^= r[j + 1]; } raiz = mult(raiz, 0x02); }
    return r;
  }
  function residuo(datos, div) {
    const r = div.map(() => 0);
    for (const b of datos) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mult(c, f); }); }
    return r;
  }
  function crear(texto) {
    const bytes = [...new TextEncoder().encode(texto)];
    let v = 1;
    for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= palabrasDatos(v) * 8) break;
    if (v > 10) throw new Error("Texto demasiado largo para el QR");
    // Bits de datos: modo byte (0100), longitud, datos, terminador y relleno
    const bits = [];
    const poner = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    poner(4, 4); poner(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => poner(b, 8));
    const capacidad = palabrasDatos(v) * 8;
    poner(0, Math.min(4, capacidad - bits.length)); poner(0, (8 - bits.length % 8) % 8);
    for (let p = 0xEC; bits.length < capacidad; p ^= 0xEC ^ 0x11) poner(p, 8);
    const datos = []; for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    // Corrección de errores (Reed–Solomon) e intercalado de bloques
    const nb = BLOQUES[v], ec = EC_POR_BLOQUE[v], total = Math.floor(modulosDatos(v) / 8);
    const cortos = nb - total % nb, largoCorto = Math.floor(total / nb), div = divisor(ec), bloques = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = datos.slice(k, k + largoCorto - ec + (i < cortos ? 0 : 1)); k += dat.length;
      const r = residuo(dat, div); if (i < cortos) dat.push(0); bloques.push(dat.concat(r));
    }
    const palabras = [];
    for (let i = 0; i < bloques[0].length; i++) bloques.forEach((b, j) => { if (i !== largoCorto - ec || j >= cortos) palabras.push(b[i]); });
    // Matriz y patrones fijos
    const n = v * 4 + 17, m = Array.from({ length: n }, () => new Array(n).fill(false)), fijo = Array.from({ length: n }, () => new Array(n).fill(false));
    const fija = (x, y, oscuro) => { m[y][x] = oscuro; fijo[y][x] = true; };
    for (let i = 0; i < n; i++) { fija(6, i, i % 2 === 0); fija(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < n && y >= 0 && y < n) fija(x, y, d !== 2 && d !== 4); }
    if (v > 1) {
      const na = Math.floor(v / 7) + 2, paso = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2, pos = [6];
      for (let p = n - 7; pos.length < na; p -= paso) pos.splice(1, 0, p);
      for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fija(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    const formato = mascara => {
      const d = (0 << 3) | mascara; let r = d;                       // nivel M = 00
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) fija(8, i, bit(i));
      fija(8, 7, bit(6)); fija(8, 8, bit(7)); fija(7, 8, bit(8));
      for (let i = 9; i < 15; i++) fija(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) fija(n - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) fija(8, n - 15 + i, bit(i));
      fija(8, n - 8, true);
    };
    formato(0);
    if (v >= 7) {
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const o = ((b >>> i) & 1) !== 0, a = n - 11 + i % 3, c = Math.floor(i / 3); fija(a, c, o); fija(c, a, o); }
    }
    // Colocación de los datos en zigzag
    let i = 0;
    for (let der = n - 1; der >= 1; der -= 2) {
      if (der === 6) der = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = der - j, arriba = ((der + 1) & 2) === 0, y = arriba ? n - 1 - vert : vert;
        if (!fijo[y][x] && i < palabras.length * 8) { m[y][x] = ((palabras[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    // Máscara: se prueba cada una y se elige la de menor penalización (rachas, bloques y equilibrio)
    const MASCARAS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const aplicar = k => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fijo[y][x] && MASCARAS[k](x, y)) m[y][x] = !m[y][x]; };
    const penalizacion = () => {
      let p = 0, oscuros = 0;
      for (let a = 0; a < n; a++) for (const fila of [true, false]) {
        let racha = 1;
        for (let b = 1; b < n; b++) { const c0 = fila ? m[a][b - 1] : m[b - 1][a], c1 = fila ? m[a][b] : m[b][a]; if (c0 === c1) { racha++; if (racha === 5) p += 3; else if (racha > 5) p++; } else racha = 1; }
      }
      for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) oscuros++;
      return p + Math.floor(Math.abs(oscuros * 20 - n * n * 10) / (n * n)) * 10;
    };
    let mejor = 0, minimo = Infinity;
    for (let k = 0; k < 8; k++) { aplicar(k); formato(k); const p = penalizacion(); if (p < minimo) { minimo = p; mejor = k; } aplicar(k); }
    aplicar(mejor); formato(mejor);
    return m;
  }
  // SVG listo para insertar (con margen blanco de 4 módulos, como pide la norma)
  function svg(texto, tam = 220) {
    const m = crear(texto), n = m.length, t = n + 8;
    let d = ""; m.forEach((fila, y) => fila.forEach((o, x) => { if (o) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${tam}" height="${tam}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { crear, svg };
})();
