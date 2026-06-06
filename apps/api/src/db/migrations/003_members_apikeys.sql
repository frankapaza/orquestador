-- Miembros de equipo (sub-usuarios de un cliente)
CREATE TABLE IF NOT EXISTS client_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  role        VARCHAR(50) DEFAULT 'editor', -- owner | editor | viewer
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- API Keys para acceso programático
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  key_hash     VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hex del token
  key_prefix   VARCHAR(20) NOT NULL,        -- primeros chars para mostrar
  last_used_at TIMESTAMPTZ,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_members_client ON client_members(client_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_client       ON api_keys(client_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash         ON api_keys(key_hash);
