-- Visitas a la tienda (contador propio, sin cookies): una fila por visitante y día, y páginas vistas por día
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
