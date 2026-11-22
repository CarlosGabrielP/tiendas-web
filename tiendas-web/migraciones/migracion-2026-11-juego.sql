-- Aplicar UNA vez a las bases existentes (pruebas y producción)
ALTER TABLE partidas ADD COLUMN jugador TEXT;
ALTER TABLE partidas ADD COLUMN email TEXT;
ALTER TABLE partidas ADD COLUMN tel TEXT;
CREATE INDEX IF NOT EXISTS partidas_email ON partidas (email);
CREATE INDEX IF NOT EXISTS partidas_tel ON partidas (tel);
CREATE TABLE IF NOT EXISTS jugadores (token TEXT PRIMARY KEY, nombre TEXT NOT NULL, email TEXT NOT NULL, tel TEXT NOT NULL, creado TEXT NOT NULL, promos INTEGER);
CREATE INDEX IF NOT EXISTS jugadores_email ON jugadores (email);
ALTER TABLE premios ADD COLUMN tipo TEXT DEFAULT 'ganador';
