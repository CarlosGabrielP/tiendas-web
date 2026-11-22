// Motor del minijuego "¿Te atreves?" — determinista: la misma semilla + las mismas entradas
// producen exactamente la misma partida en el navegador y en el servidor (que la verifica).
// Solo usa + − × ÷, Math.sqrt/abs/min/max/floor/round/imul: resultados idénticos en todos los motores JS.
const MOTOR = (() => {
  const W = 360, H = 640, HZ = 120;            // cancha vertical; 120 pasos por segundo
  const PALA = 70, ALTO = 12, BOLA = 7;          // ancho de pala, grosor, radio de la bola
  const YJ = H - 34, YC = 34;                    // línea de golpeo jugador (abajo) y rival (arriba)
  const MAXJ = 10;                               // velocidad máxima de la pala del jugador (px/paso)
  const JUEGOS = 4;                              // gana quien llega a 4 juegos
  const PUNTOS = 4;                              // puntos por juego: 15-30-40-juego (punto de oro en 40-40)
  const CANTO = ["0", "15", "30", "40"];
  const VMAX = 9.5;
  const RIVALES = {
    // vel: px/paso · reaccion: pasos antes de moverse · error: px de error base + por velocidad · golpe: aceleración · angulo: cuánto abre el tiro
    // Calibrado con simulaciones (partido a 4 juegos): jugador "muy bueno" gana ~5 % contra El Rey y ~1 % contra El Mozart
    rey:    { nombre: "El Rey",    nivel: "Difícil",        estilo: "Potencia pura: remates que vuelan", vel: 3.1, reaccion: 12, errBase: 8, errVel: 5.2, golpe: 1.085, angulo: 0.95 },
    mozart: { nombre: "El Mozart", nivel: "Casi imposible", estilo: "Toque mágico: ángulos imposibles",  vel: 3.0, reaccion: 11, errBase: 7, errVel: 4.6, golpe: 1.04,  angulo: 1.5 },
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function rng(seed) {                           // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function nuevo(seed, rivalId) {
    const rival = RIVALES[rivalId] || RIVALES.rey;
    const s = { r: rng(seed), rival, t: 0, jug: { x: W / 2 }, cpu: { x: W / 2, meta: W / 2, espera: 0 }, bola: null,
      pj: 0, pc: 0, gj: 0, gc: 0, saque: 1, pausa: 0, fin: null, golpes: 0, eventos: [] };
    servir(s);
    return s;
  }
  function servir(s) {
    const lado = s.r() * 1.6 - 0.8;              // dirección lateral del saque
    const v = 4.2;
    let vx = lado * 2.2, vy = v * s.saque;
    const n = Math.sqrt(vx * vx + vy * vy); vx = vx / n * v; vy = vy / n * v;
    s.bola = { x: W / 2, y: H / 2, vx, vy };
    s.pausa = HZ;                                 // 1 s antes de cada saque
    s.cpu.espera = 0; s.cpu.leyendo = false;
  }
  // Dónde cruzará la bola la línea del rival (rebotando en las paredes)
  function predecir(b) {
    if (b.vy >= 0) return W / 2;
    let x = b.x + b.vx * ((YC + ALTO / 2 + BOLA) - b.y) / b.vy;
    const L = W - 2 * BOLA; x -= BOLA;
    x = ((x % (2 * L)) + 2 * L) % (2 * L);
    if (x > L) x = 2 * L - x;
    return x + BOLA;
  }
  function golpear(s, palaX, haciaArriba, fuerza, angulo) {
    const b = s.bola;
    const off = clamp((b.x - palaX) / (PALA / 2 + BOLA), -1, 1);    // −1 borde izq … +1 borde der
    let vel = Math.min(VMAX, Math.sqrt(b.vx * b.vx + b.vy * b.vy) * fuerza);
    let vx = off * 0.9 * angulo, vy = haciaArriba ? -1 : 1;
    const n = Math.sqrt(vx * vx + vy * vy);
    b.vx = vx / n * vel; b.vy = vy / n * vel;
    s.golpes++;
  }
  // Un paso de simulación. objetivo = x deseada de la pala del jugador (entero 0..W)
  function paso(s, objetivo) {
    if (s.fin) return;
    s.t++;
    s.jug.x = clamp(s.jug.x + clamp(objetivo - s.jug.x, -MAXJ, MAXJ), PALA / 2, W - PALA / 2);
    const R = s.rival, b = s.bola, c = s.cpu;
    // IA del rival: cuando la bola empieza a subir, "lee" el tiro UNA vez (con error que crece con la velocidad
    // y si viene rebotando en la pared), espera su tiempo de reacción y después se mueve con velocidad limitada.
    if (b.vy < 0 && !c.leyendo) {
      const rapidez = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const angular = Math.abs(b.vx) / rapidez > 0.45 ? 1.35 : 1;
      c.meta = predecir(b) + (s.r() * 2 - 1) * (R.errBase + R.errVel * rapidez) * angular;
      c.espera = R.reaccion; c.leyendo = true;
    }
    if (b.vy > 0) { c.leyendo = false; c.meta = W / 2 + (b.x - W / 2) * 0.2; }
    if (c.espera > 0) c.espera--;
    else c.x = clamp(c.x + clamp(c.meta - c.x, -R.vel, R.vel), PALA / 2, W - PALA / 2);
    if (s.pausa > 0) { s.pausa--; return; }
    b.x += b.vx; b.y += b.vy;
    if (b.x < BOLA) { b.x = 2 * BOLA - b.x; b.vx = -b.vx; }
    if (b.x > W - BOLA) { b.x = 2 * (W - BOLA) - b.x; b.vx = -b.vx; }
    // Pala del jugador (abajo)
    if (b.vy > 0 && b.y + BOLA >= YJ - ALTO / 2 && b.y - b.vy + BOLA < YJ - ALTO / 2 + 1 && Math.abs(b.x - s.jug.x) <= PALA / 2 + BOLA) {
      b.y = YJ - ALTO / 2 - BOLA; golpear(s, s.jug.x, true, 1.06, 1); s.eventos.push(["golpe", s.t]);
    }
    // Pala del rival (arriba)
    if (b.vy < 0 && b.y - BOLA <= YC + ALTO / 2 && b.y - b.vy - BOLA > YC + ALTO / 2 - 1 && Math.abs(b.x - c.x) <= PALA / 2 + BOLA) {
      b.y = YC + ALTO / 2 + BOLA; golpear(s, c.x, false, R.golpe, R.angulo); s.eventos.push(["rival", s.t]);
    }
    if (b.y > H + BOLA * 2) punto(s, false);
    else if (b.y < -BOLA * 2) punto(s, true);
  }
  // Marcador de pádel: 15-30-40-juego; en 40-40 se juega punto de oro (quien lo gana se lleva el juego)
  function punto(s, mio) {
    if (mio) { s.pj++; s.saque = -1; } else { s.pc++; s.saque = 1; }
    s.eventos.push([mio ? "punto" : "punto-rival", s.t]);
    s.aviso = null;
    if (s.pj >= PUNTOS || s.pc >= PUNTOS) {
      const oro = s.pj + s.pc === 2 * PUNTOS - 1;
      if (s.pj >= PUNTOS) s.gj++; else s.gc++;
      s.aviso = (mio ? "¡Juego para ti!" : "Juego para el rival") + (oro ? " (punto de oro)" : "");
      s.pj = 0; s.pc = 0;
      s.eventos.push([mio ? "juego" : "juego-rival", s.t]);
    } else if (s.pj === PUNTOS - 1 && s.pc === PUNTOS - 1) s.aviso = "¡Punto de oro!";
    if (s.gj >= JUEGOS) s.fin = "ganaste"; else if (s.gc >= JUEGOS) s.fin = "perdiste";
    if (!s.fin) servir(s);
  }
  const canto = s => `${CANTO[s.pj]} – ${CANTO[s.pc]}`;
  // Entradas comprimidas: [[x, repeticiones], …]
  function comprimir(lista) { const out = []; for (const x of lista) { const u = out[out.length - 1]; if (u && u[0] === x) u[1]++; else out.push([x, 1]); } return out; }
  // Repite la partida con las entradas del jugador y mide su tiempo de reacción: cada vez que la bola
  // empieza a bajar hacia él, cuántos pasos tarda en cambiar de dirección. Un humano no baja de ~6 pasos (50 ms).
  function repetir(seed, rivalId, rle, maxPasos = HZ * 1800) {
    const s = nuevo(seed, rivalId);
    let pasos = 0, prev = W / 2, bajando = false, desde = 0, medido = true;
    const reacciones = [];
    for (const [x, n] of rle) {
      if (!Number.isInteger(x) || !Number.isInteger(n) || n < 1 || x < 0 || x > W) return { error: "entradas inválidas" };
      for (let i = 0; i < n; i++) {
        if (s.fin) break;
        const b = s.bola;
        if (b.vy > 0 && !bajando && s.pausa === 0) { bajando = true; desde = s.t; medido = false; }
        if (b.vy <= 0) bajando = false;
        if (bajando && !medido && Math.abs(x - prev) > 2) { reacciones.push(s.t - desde); medido = true; }
        prev = x;
        paso(s, x);
        if (++pasos > maxPasos) return { error: "partida demasiado larga" };
      }
      if (s.fin) break;
    }
    reacciones.sort((a, b) => a - b);
    const mediana = reacciones.length ? reacciones[reacciones.length >> 1] : null;
    return { fin: s.fin, gj: s.gj, gc: s.gc, pasos: s.t, golpes: s.golpes, reaccionMediana: mediana, muestras: reacciones.length };
  }
  return { W, H, HZ, PALA, ALTO, BOLA, YJ, YC, PUNTOS, JUEGOS, CANTO, canto, RIVALES, nuevo, paso, comprimir, repetir, predecir };
})();
