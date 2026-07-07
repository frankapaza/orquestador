-- Soporte de proxy por celular (para no correr todos los números WhatsApp desde
-- la misma IP del VPS, lo que aumenta el riesgo de baneo en cadena). Cada cuenta
-- Baileys puede salir por su propio proxy (iProxy.online / Proxidize).
ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS proxy_provider varchar(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS proxy_url      varchar(500);

-- Proveedores de proxy habilitados por cliente (controla qué opciones se ofrecen
-- al asignar un proxy a cada celular en Configuración → Proxies).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS proxy_iproxy_enabled    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS proxy_proxidize_enabled boolean DEFAULT false;
