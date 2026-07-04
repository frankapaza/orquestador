-- Configuración de Agente IA para generar el catálogo de conversaciones de warmup.
-- ChatGPT (OpenAI) y DeepSeek comparten el formato de API (chat completions),
-- por eso basta con proveedor + base_url + modelo + api_key (cifrada).
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS ai_provider    VARCHAR(20) DEFAULT 'openai'; -- openai | deepseek | custom
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS ai_model       VARCHAR(80);
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS ai_base_url    VARCHAR(200);
ALTER TABLE warmup_config ADD COLUMN IF NOT EXISTS ai_api_key_enc TEXT;                         -- cifrada con lib/crypto (enc:...)
