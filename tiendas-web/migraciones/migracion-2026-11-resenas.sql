-- Reseñas de productos (una por producto por pedido). Estado: pendiente → publicada | oculta
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
