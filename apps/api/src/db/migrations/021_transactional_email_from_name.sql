-- 021_transactional_email_from_name.sql
-- Guarda el nombre del remitente (from_name) del envío individual, para mostrarlo
-- en la vista 360° ("Enviado desde: <Remitente> · <correo>").
ALTER TABLE transactional_emails ADD COLUMN IF NOT EXISTS from_name VARCHAR(255);
