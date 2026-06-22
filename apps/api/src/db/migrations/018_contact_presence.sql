-- ============================================================================
-- 018_contact_presence.sql
--
-- Agrega campos de presencia WhatsApp a conversations:
--   - presence:     'available' | 'unavailable' | 'composing' | 'recording'
--   - last_seen_at: timestamp de la última vez visto (si el contacto lo expone)
--
-- Estos valores se llenan con el evento sock.ev.on('presence.update') de Baileys,
-- pero solo cuando el operador abre la conversación (sock.presenceSubscribe(jid)).
-- ============================================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS presence       TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presence_updated_at TIMESTAMPTZ;
