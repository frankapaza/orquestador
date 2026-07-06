-- Rampa por CONVERSACIONES que se multiplica cada día + flujo continuo + rotación IA.

-- Objetivo de conversaciones por día (se multiplica por conv_growth cada día, tope conv_cap).
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS conv_start  INTEGER      DEFAULT 50;   -- conversaciones/chip el día 1
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS conv_growth NUMERIC(4,2) DEFAULT 2.0;  -- multiplicador diario (2 = duplica)
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS conv_cap    INTEGER      DEFAULT 200;  -- tope de seguridad conversaciones/día

-- Permitir conversaciones con números EXTERNOS (default false = solo entre chips activos).
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS allow_external BOOLEAN DEFAULT false;

-- Contador de CONVERSACIONES iniciadas hoy por chip (aparte del contador de mensajes).
ALTER TABLE warmup_daily_stats ADD COLUMN IF NOT EXISTS warmup_conv INTEGER DEFAULT 0;

-- Para rotar el catálogo y no repetir: se usa la conversación menos usada recientemente.
ALTER TABLE warmup_conversations ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_warmup_conv_lru ON warmup_conversations(client_id, last_used_at);
