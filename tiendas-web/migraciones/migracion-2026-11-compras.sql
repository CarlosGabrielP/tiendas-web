-- Compras de inventario (registro de lo que compraste, con su costo real repartido por pieza)
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
