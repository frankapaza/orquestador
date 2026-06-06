import { SendGridAdapter }  from './sendgrid.adapter.js'
import { BrevoAdapter }     from './brevo.adapter.js'
import { MailchimpAdapter } from './mailchimp.adapter.js'
import { sql }              from '../../../lib/db.js'
import { decryptCredentials } from '../../../lib/crypto.js'

const ADAPTERS = {
  sendgrid:  SendGridAdapter,
  brevo:     BrevoAdapter,
  mailchimp: MailchimpAdapter,
}

export function buildAdapter(provider, credentials) {
  const Adapter = ADAPTERS[provider]
  if (!Adapter) throw new Error(`Proveedor no soportado: ${provider}`)
  return new Adapter(credentials)
}

export async function getAdapterForCampaign(campaign) {
  const strategy = campaign.strategy
  if (strategy === 'smtp_own') return null

  const integrationId = campaign.settings?.integration_id
  if (!integrationId) throw new Error(`La campana usa estrategia "${strategy}" pero no tiene integration_id configurado`)

  const [integration] = await sql`
    SELECT * FROM integrations
    WHERE id = ${integrationId} AND client_id = ${campaign.client_id} AND is_active = true
  `
  if (!integration) throw new Error(`Integracion no encontrada o inactiva`)

  return buildAdapter(integration.provider, decryptCredentials(integration.credentials))
}
