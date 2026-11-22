-- Esquema de la base de datos D1 de cada tienda (idempotente: se puede ejecutar varias veces)
CREATE TABLE IF NOT EXISTS datos (
  clave       TEXT PRIMARY KEY,          -- catalogo, catalogo:anterior, config, cupones, descripciones, clientes, tipo-cambio, cupones-usos
  valor       TEXT NOT NULL,             -- JSON
  version     INTEGER NOT NULL DEFAULT 1,-- se incrementa en cada escritura (escrituras condicionadas)
  actualizado TEXT
);
CREATE TABLE IF NOT EXISTS pedidos (
  id         TEXT PRIMARY KEY,           -- QP-AAMMDD-XXXXX
  creado     TEXT NOT NULL,
  estado     TEXT NOT NULL,
  total      REAL,
  nombre     TEXT,
  email      TEXT,
  piezas     INTEGER,
  con_pedido INTEGER DEFAULT 0,
  alerta     INTEGER DEFAULT 0,
  version    INTEGER NOT NULL DEFAULT 1,
  datos      TEXT NOT NULL               -- JSON completo del pedido
);
CREATE INDEX IF NOT EXISTS pedidos_creado ON pedidos (creado DESC);
CREATE INDEX IF NOT EXISTS pedidos_email ON pedidos (email);
CREATE TABLE IF NOT EXISTS intentos (    -- límite de intentos (contraseñas, cupones, pedidos)
  clave  TEXT PRIMARY KEY,
  n      INTEGER NOT NULL,
  expira INTEGER NOT NULL
);
-- Minijuego "¿Te atreves?"
CREATE TABLE IF NOT EXISTS partidas (
  id         TEXT PRIMARY KEY,
  semilla    INTEGER NOT NULL,
  rival      TEXT NOT NULL,
  creado     INTEGER NOT NULL,            -- ms
  ip         TEXT,
  resultado  TEXT,                        -- null (en juego) | perdida | ganada | revision | reclamada
  marcador   TEXT,
  jugador    TEXT, email TEXT, tel TEXT     -- quién jugó (un intento por persona al día)
);
CREATE INDEX IF NOT EXISTS partidas_email ON partidas (email);
CREATE INDEX IF NOT EXISTS partidas_tel ON partidas (tel);
CREATE TABLE IF NOT EXISTS jugadores (
  token      TEXT PRIMARY KEY,            -- se guarda en el navegador del jugador
  nombre     TEXT NOT NULL, email TEXT NOT NULL, tel TEXT NOT NULL,
  creado     TEXT NOT NULL, promos INTEGER,
  email_envio TEXT,                       -- correo tal como lo escribió (el campo email es el "canónico" para los límites)
  verificado INTEGER DEFAULT 0, codigo_hash TEXT, codigo_expira INTEGER, codigo_intentos INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jugadores_email ON jugadores (email);
CREATE INDEX IF NOT EXISTS partidas_creado ON partidas (creado);
CREATE TABLE IF NOT EXISTS premios (
  codigo     TEXT PRIMARY KEY,            -- QP-XXXXXX
  partida    TEXT NOT NULL UNIQUE,
  rival      TEXT,
  nombre     TEXT, email TEXT NOT NULL, tel TEXT NOT NULL,
  porcentaje REAL NOT NULL, tope REAL,    -- descuento sobre UN artículo (el más caro del carrito), con tope opcional
  creado     TEXT NOT NULL, vence TEXT NOT NULL,
  usado      TEXT,                         -- folio del pedido en que se usó
  tipo       TEXT DEFAULT 'ganador'        -- ganador | consuelo (el de consolación solo se da una vez por persona)
);
CREATE INDEX IF NOT EXISTS premios_email ON premios (email);
CREATE INDEX IF NOT EXISTS premios_tel ON premios (tel);
CREATE INDEX IF NOT EXISTS premios_creado ON premios (creado);
CREATE TABLE IF NOT EXISTS visitas (
  dia        TEXT NOT NULL,              -- AAAA-MM-DD (hora de México)
  visitante  TEXT NOT NULL,              -- huella anónima: cambia cada día, no se puede revertir a la IP
  paginas    INTEGER NOT NULL DEFAULT 1,
  origen     TEXT,                       -- google, facebook, instagram, directo, …
  disp       TEXT,                       -- móvil, computadora, tableta
  PRIMARY KEY (dia, visitante)
);
CREATE TABLE IF NOT EXISTS visitas_paginas (
  dia   TEXT NOT NULL,
  ruta  TEXT NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, ruta)
);
CREATE TABLE IF NOT EXISTS resenas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido          TEXT NOT NULL,
  producto        TEXT NOT NULL,
  nombre_producto TEXT,
  estrellas       INTEGER NOT NULL,
  texto           TEXT,
  autor           TEXT,               -- nombre e inicial del apellido, como se publica
  ciudad          TEXT,               -- estado del país (se publica)
  email           TEXT,               -- no se publica
  creado          TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente',
  UNIQUE (pedido, producto)
);
CREATE INDEX IF NOT EXISTS resenas_producto ON resenas (producto, estado);
CREATE TABLE IF NOT EXISTS compras (
  id        TEXT PRIMARY KEY,         -- C261110-AB12
  fecha     TEXT NOT NULL,            -- AAAA-MM-DD
  proveedor TEXT,
  total     REAL,                     -- total pagado en pesos (producto + logística)
  piezas    INTEGER,
  datos     TEXT NOT NULL,            -- JSON: costos, líneas y resultado del reparto
  creado    TEXT NOT NULL,
  anulada   TEXT
);
CREATE INDEX IF NOT EXISTS compras_fecha ON compras (fecha DESC);
