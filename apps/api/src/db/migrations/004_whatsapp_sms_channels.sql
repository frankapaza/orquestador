-- Cuentas WhatsApp (Evolution API)
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  phone_number        VARCHAR(20),
  instance_name       VARCHAR(255) NOT NULL,
  evolution_url       VARCHAR(500) NOT NULL,
  evolution_api_key   VARCHAR(255) NOT NULL,
  daily_limit         INTEGER DEFAULT 200,
  sent_today          INTEGER DEFAULT 0,
  delay_min           INTEGER DEFAULT 10,
  delay_max           INTEGER DEFAULT 30,
  active_hours_start  TIME DEFAULT '08:00',
  active_hours_end    TIME DEFAULT '20:00',
  is_connected        BOOLEAN DEFAULT false,
  role                VARCHAR(50) DEFAULT 'campaign',
  is_active           BOOLEAN DEFAULT true,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, instance_name)
);

-- Cuentas SMS (Android SMS Gateway)
CREATE TABLE IF NOT EXISTS sms_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  phone_number        VARCHAR(20) NOT NULL,
  gateway_url         VARCHAR(500) NOT NULL,
  api_key             VARCHAR(255),
  daily_limit         INTEGER DEFAULT 100,
  sent_today          INTEGER DEFAULT 0,
  delay_min           INTEGER DEFAULT 5,
  delay_max           INTEGER DEFAULT 15,
  active_hours_start  TIME DEFAULT '08:00',
  active_hours_end    TIME DEFAULT '20:00',
  is_online           BOOLEAN DEFAULT false,
  is_active           BOOLEAN DEFAULT true,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Conversaciones (una por contacto + canal + cuenta)
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel         VARCHAR(20) NOT NULL,
  contact_phone   VARCHAR(20) NOT NULL,
  contact_name    VARCHAR(255),
  account_id      UUID NOT NULL,
  account_type    VARCHAR(20) NOT NULL,
  status          VARCHAR(50) DEFAULT 'open',
  last_message_at TIMESTAMPTZ,
  unread_count    INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, channel, contact_phone, account_id)
);

-- Mensajes (todos los canales, bidireccional)
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel         VARCHAR(20) NOT NULL,
  direction       VARCHAR(10) NOT NULL,
  from_number     VARCHAR(20),
  to_number       VARCHAR(20),
  body            TEXT,
  media_url       VARCHAR(1000),
  media_type      VARCHAR(50),
  media_caption   TEXT,
  status          VARCHAR(50) DEFAULT 'pending',
  external_id     VARCHAR(500),
  campaign_id     UUID REFERENCES campaigns(id),
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Webhooks salientes (para CRM u otros sistemas)
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  url         VARCHAR(1000) NOT NULL,
  events      TEXT[] NOT NULL,
  secret      VARCHAR(255),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_wa_accounts_client   ON whatsapp_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_sms_accounts_client  ON sms_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_last   ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_external    ON messages(external_id);
CREATE INDEX IF NOT EXISTS idx_messages_created     ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_client  ON webhook_subscriptions(client_id);
