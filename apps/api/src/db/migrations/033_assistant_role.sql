-- Tipo del asistente IA: 'campaign' (Campaña, envíos masivos) o 'advisor' (Individual, 1 a 1).
-- Espejo de whatsapp_accounts.role: un asistente de tipo Campaña solo puede vincularse a
-- números de tipo Campaña, y uno Individual solo a números Individual. Así el asistente
-- y sus números hablan siempre del mismo tipo de tráfico.
ALTER TABLE wa_assistants ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'campaign';
