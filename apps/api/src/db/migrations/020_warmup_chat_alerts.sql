-- Chat del warmup, alertas in-app y auto-regeneración de catálogo

-- Mensajes de warmup para el visor de chat (retención: se limpian a los 7 días)
CREATE TABLE IF NOT EXISTS warmup_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  thread_key      VARCHAR(80) NOT NULL,             -- par de teléfonos ordenado 'min|max'
  from_account_id UUID REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  to_account_id   UUID REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  peer_phone      VARCHAR(30),
  peer_name       VARCHAR(120),
  peer_kind       VARCHAR(10) DEFAULT 'internal',   -- internal | external
  text            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warmup_msg_thread  ON warmup_messages(client_id, thread_key, created_at);
CREATE INDEX IF NOT EXISTS idx_warmup_msg_created ON warmup_messages(created_at);

-- Alertas in-app de riesgo/baneo
CREATE TABLE IF NOT EXISTS warmup_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  level        VARCHAR(10) NOT NULL,                -- red | banned
  reason       VARCHAR(255),
  acknowledged BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warmup_alerts_open ON warmup_alerts(client_id) WHERE acknowledged = false;

-- Regeneración automática semanal del catálogo con IA
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS ai_auto_weekly BOOLEAN DEFAULT false;
