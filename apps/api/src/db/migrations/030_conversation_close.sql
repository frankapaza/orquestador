-- Motivo y fecha de cierre de la conversación (reporte + dashboard futuro).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(20);   -- 'inactivity' | 'manual' | (fase 2) 'ai'
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at     TIMESTAMPTZ;

-- Horas de inactividad tras las cuales el asistente cierra la conversación (0 = desactivado).
ALTER TABLE wa_assistants ADD COLUMN IF NOT EXISTS inactivity_close_hours INTEGER DEFAULT 24;
