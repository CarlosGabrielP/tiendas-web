-- Aplicar UNA vez a las bases existentes (pruebas y producción): verificación de correo del minijuego
ALTER TABLE jugadores ADD COLUMN email_envio TEXT;
ALTER TABLE jugadores ADD COLUMN verificado INTEGER DEFAULT 0;
ALTER TABLE jugadores ADD COLUMN codigo_hash TEXT;
ALTER TABLE jugadores ADD COLUMN codigo_expira INTEGER;
ALTER TABLE jugadores ADD COLUMN codigo_intentos INTEGER DEFAULT 0;
