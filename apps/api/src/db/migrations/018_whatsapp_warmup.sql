-- Calentamiento (warmup) de chips WhatsApp + alerta de baneo
-- Ver nota de diseño: warmup selectivo, config global + override por chip,
-- catálogo de conversaciones (IA) reutilizable, y stats agregadas (anti-llenado de BD).

-- ── 1. Configuración global de warmup (una fila por cliente) ──────────────────
CREATE TABLE IF NOT EXISTS warmup_config (
  client_id           UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  is_enabled          BOOLEAN DEFAULT false,          -- interruptor global del warmup
  warmup_days         INTEGER DEFAULT 7,              -- duración total del calentamiento
  delay_min_sec       INTEGER DEFAULT 30,             -- delay mínimo entre mensajes
  delay_max_sec       INTEGER DEFAULT 300,            -- delay máximo entre mensajes
  active_hours_start  TIME    DEFAULT '08:00',
  active_hours_end    TIME    DEFAULT '20:00',
  active_days         VARCHAR(50) DEFAULT 'mon,tue,wed,thu,fri', -- días activos
  ramp_start          INTEGER DEFAULT 5,              -- mensajes/día el día 1
  ramp_end            INTEGER DEFAULT 40,             -- mensajes/día el último día
  ramp_mode           VARCHAR(10) DEFAULT 'linear',   -- linear | steps
  daily_cap           INTEGER DEFAULT 50,             -- tope de seguridad por chip/día
  internal_ratio      NUMERIC(3,2) DEFAULT 0.60,      -- % conversaciones entre chips internos vs externos
  simulate_typing     BOOLEAN DEFAULT true,           -- sendPresenceUpdate('composing')
  mark_read           BOOLEAN DEFAULT true,           -- readMessages antes de responder
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Columnas nuevas en whatsapp_accounts: selección, estado y riesgo ───────
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS warmup_enabled    BOOLEAN DEFAULT false;   -- el "check" de selección
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ;
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS warmup_day        INTEGER DEFAULT 0;       -- día actual de la rampa (0 = no iniciado)
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS warmup_overrides  JSONB;                   -- overrides por chip (nullable = usa global)
-- Riesgo de baneo
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS risk_score        INTEGER DEFAULT 0;       -- 0-100
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS risk_level        VARCHAR(10) DEFAULT 'green'; -- green | yellow | red
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS risk_checked_at   TIMESTAMPTZ;
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS banned_at         TIMESTAMPTZ;
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS ban_reason        VARCHAR(255);

-- ── 3. Catálogo de conversaciones (generado por IA, reutilizable) ─────────────
-- Es un RECURSO fijo (no crece con el uso). turns: [{ "from": "a"|"b", "text": "..." }]
CREATE TABLE IF NOT EXISTS warmup_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE, -- NULL = catálogo global/compartido
  topic       VARCHAR(120),
  lang        VARCHAR(10) DEFAULT 'es',
  turns       JSONB NOT NULL,
  source      VARCHAR(10) DEFAULT 'ai',   -- ai | manual
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warmup_conv_client ON warmup_conversations(client_id) WHERE is_active = true;

-- ── 4. Stats diarias agregadas (el contador ligero anti-llenado de BD) ────────
-- NO se guarda el contenido de cada mensaje; solo el conteo por chip y día.
-- warmup_received permite calcular ratio saliente/entrante para el score de riesgo.
CREATE TABLE IF NOT EXISTS warmup_daily_stats (
  account_id       UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  stat_date        DATE NOT NULL,
  warmup_sent      INTEGER DEFAULT 0,
  warmup_received  INTEGER DEFAULT 0,
  PRIMARY KEY (account_id, stat_date)
);
