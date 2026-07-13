-- Asistentes de WhatsApp con IA (Fase 1: responde a entrantes por Baileys).
-- Espejo del "agente" de voz: saludo + prompt con {{VARIABLES}}, horario, y
-- (fase 2/3) derivación a asesor/pool con timeout configurable.
CREATE TABLE IF NOT EXISTS wa_assistants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                 VARCHAR(255) NOT NULL,
  greeting             TEXT,                       -- saludo/firstMessage con {{VARIABLES}}
  system_prompt        TEXT NOT NULL,              -- prompt con {{VARIABLES}}
  ai_provider          VARCHAR(30),                -- null = hereda el Agente IA global
  ai_model             VARCHAR(100),
  active_hours_start   TIME DEFAULT '09:00',
  active_hours_end     TIME DEFAULT '18:00',
  timezone             VARCHAR(64) DEFAULT 'America/Lima',
  active_days          VARCHAR(40) DEFAULT 'mon,tue,wed,thu,fri',
  handoff_number       VARCHAR(20),                -- (fase 2) derivación a asesor humano
  handoff_triggers     TEXT DEFAULT 'asesor,humano,persona,operador,ejecutivo',
  handoff_timeout_min  INTEGER DEFAULT 5,          -- (fase 3) configurable
  history_limit        INTEGER DEFAULT 12,         -- mensajes de contexto que se envían a la IA
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Un número usa un asistente; un asistente puede ir en varios números.
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS assistant_id UUID;

-- Permite pausar la IA en una conversación puntual (opt-out del cliente o toma humana).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_wa_assistants_client ON wa_assistants(client_id);
