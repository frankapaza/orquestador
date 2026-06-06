CREATE TABLE IF NOT EXISTS email_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  subject      VARCHAR(500) NOT NULL,
  from_name    VARCHAR(255) NOT NULL DEFAULT '',
  html_content TEXT NOT NULL,
  text_content TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_templates_client ON email_templates(client_id);
