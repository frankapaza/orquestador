-- Clientes (multi-tenant)
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  plan        VARCHAR(50) DEFAULT 'basic',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Dominios de envio
CREATE TABLE IF NOT EXISTS domains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain          VARCHAR(255) NOT NULL,
  spf_configured  BOOLEAN DEFAULT false,
  dkim_configured BOOLEAN DEFAULT false,
  dmarc_configured BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  daily_limit     INTEGER DEFAULT 1000,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, domain)
);

-- Cuentas SMTP por dominio
CREATE TABLE IF NOT EXISTS email_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id   UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  smtp_host   VARCHAR(255) NOT NULL,
  smtp_port   INTEGER DEFAULT 587,
  smtp_user   VARCHAR(255) NOT NULL,
  smtp_pass   VARCHAR(255) NOT NULL,
  use_tls     BOOLEAN DEFAULT true,
  daily_limit INTEGER DEFAULT 300,
  sent_today  INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(domain_id, email)
);

-- Listas de contactos
CREATE TABLE IF NOT EXISTS contact_lists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  total_count INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Contactos
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  list_id     UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  first_name  VARCHAR(100),
  last_name   VARCHAR(100),
  metadata    JSONB DEFAULT '{}',
  is_subscribed BOOLEAN DEFAULT true,
  unsubscribed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(list_id, email)
);

-- Campanas
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  subject         VARCHAR(500) NOT NULL,
  from_name       VARCHAR(255) NOT NULL,
  reply_to        VARCHAR(255),
  html_content    TEXT,
  text_content    TEXT,
  list_id         UUID NOT NULL REFERENCES contact_lists(id),
  strategy        VARCHAR(50) DEFAULT 'smtp_own', -- smtp_own | mailchimp | sendgrid
  status          VARCHAR(50) DEFAULT 'draft', -- draft | scheduled | sending | paused | completed | failed
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  total_recipients INTEGER DEFAULT 0,
  sent_count      INTEGER DEFAULT 0,
  failed_count    INTEGER DEFAULT 0,
  open_count      INTEGER DEFAULT 0,
  click_count     INTEGER DEFAULT 0,
  bounce_count    INTEGER DEFAULT 0,
  unsub_count     INTEGER DEFAULT 0,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Jobs individuales de envio (1 por destinatario por campana)
CREATE TABLE IF NOT EXISTS campaign_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id),
  email_account_id UUID REFERENCES email_accounts(id),
  recipient_email VARCHAR(255) NOT NULL,
  status          VARCHAR(50) DEFAULT 'pending', -- pending | sent | failed | bounced
  message_id      VARCHAR(500),
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Eventos de tracking
CREATE TABLE IF NOT EXISTS tracking_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  job_id        UUID REFERENCES campaign_jobs(id),
  event_type    VARCHAR(50) NOT NULL, -- open | click | bounce | unsub
  recipient_email VARCHAR(255) NOT NULL,
  metadata      JSONB DEFAULT '{}',
  ip_address    VARCHAR(45),
  user_agent    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Proveedores externos configurados
CREATE TABLE IF NOT EXISTS integrations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider    VARCHAR(50) NOT NULL, -- mailchimp | sendgrid | brevo | ses
  name        VARCHAR(255) NOT NULL,
  credentials JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, provider, name)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_domains_client ON domains(client_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_domain ON email_accounts(domain_id);
CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_campaign ON campaign_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_status ON campaign_jobs(status);
CREATE INDEX IF NOT EXISTS idx_tracking_campaign ON tracking_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracking_type ON tracking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_created ON tracking_events(created_at);
