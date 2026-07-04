-- Zona horaria del calentamiento: el horario/días activos se evalúan en esta zona.
-- Por defecto Perú (America/Lima) para que 08:00–20:00 sea hora peruana.
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/Lima';
