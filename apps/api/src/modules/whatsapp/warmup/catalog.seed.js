import { sql } from '../../../lib/db.js'

// Banco inicial de conversaciones para el calentamiento (fallback sin IA).
// Cada conversación es una lista de turnos alternados entre dos interlocutores
// 'a' y 'b'. El motor la reproduce entre un par de chips, remezclando y variando.
// Es un RECURSO fijo (no crece con el uso). La IA, si se configura, agrega más.
export const SEED_CONVERSATIONS = [
  {
    topic: 'saludo-casual',
    turns: [
      { from: 'a', text: 'Hola! cómo estás?' },
      { from: 'b', text: 'Hola, todo bien y tú?' },
      { from: 'a', text: 'Bien tmb, aquí con cosas del trabajo jeje' },
      { from: 'b', text: 'jaja te entiendo, día ocupado' },
      { from: 'a', text: 'Sí un montón, pero ya casi salgo' },
      { from: 'b', text: 'Buenísimo, descansa' },
    ],
  },
  {
    topic: 'planes-fin-de-semana',
    turns: [
      { from: 'a', text: 'Oye qué vas a hacer el finde?' },
      { from: 'b', text: 'Nada seguro aún, tal vez salir un rato' },
      { from: 'a', text: 'Podríamos vernos para almorzar' },
      { from: 'b', text: 'Me parece! qué día te queda mejor?' },
      { from: 'a', text: 'El sábado como al mediodía' },
      { from: 'b', text: 'Perfecto, ahí coordinamos 👍' },
    ],
  },
  {
    topic: 'pregunta-favor',
    turns: [
      { from: 'a', text: 'Hey te puedo pedir un favor?' },
      { from: 'b', text: 'Claro dime' },
      { from: 'a', text: 'Me pasas el contacto del que arregla laptops?' },
      { from: 'b', text: 'Ah sí, ahorita te lo busco' },
      { from: 'a', text: 'Gracias crack' },
      { from: 'b', text: 'De nada, cualquier cosa avísame' },
    ],
  },
  {
    topic: 'comida',
    turns: [
      { from: 'a', text: 'Ya almorzaste?' },
      { from: 'b', text: 'Todavía no, muriendo de hambre jaja' },
      { from: 'a', text: 'yo igual, voy a pedir algo' },
      { from: 'b', text: 'qué vas a pedir?' },
      { from: 'a', text: 'creo que pollo a la brasa' },
      { from: 'b', text: 'uff buena elección 🤤' },
    ],
  },
  {
    topic: 'trabajo',
    turns: [
      { from: 'a', text: 'Cómo va todo por allá?' },
      { from: 'b', text: 'Tranquilo, avanzando con los pendientes' },
      { from: 'a', text: 'Bien, luego me cuentas cómo quedó' },
      { from: 'b', text: 'Dale, apenas termine te aviso' },
    ],
  },
  {
    topic: 'clima',
    turns: [
      { from: 'a', text: 'Qué frío está haciendo hoy no?' },
      { from: 'b', text: 'Sí demasiado, ni ganas de salir' },
      { from: 'a', text: 'jaja igual, mejor quedarse en casa' },
      { from: 'b', text: 'Total, un café y listo ☕' },
    ],
  },
  {
    topic: 'saludo-corto',
    turns: [
      { from: 'a', text: 'Buenos días!' },
      { from: 'b', text: 'Buenos días, cómo amaneces?' },
      { from: 'a', text: 'Todo bien gracias 🙌' },
    ],
  },
  {
    topic: 'recordatorio',
    turns: [
      { from: 'a', text: 'No te olvides de lo de mañana eh' },
      { from: 'b', text: 'Tranqui, ya lo tengo anotado' },
      { from: 'a', text: 'Perfecto, cualquier cosa te escribo' },
      { from: 'b', text: 'Vale 👌' },
    ],
  },
]

// Pequeñas variaciones para que el mismo texto no se repita idéntico.
const EMOJI_POOL = ['', '', '', ' 🙂', ' 👍', ' jaja', '', '']

export function varyText(text) {
  let t = text
  // Ocasionalmente quitar signos de apertura (más informal)
  if (Math.random() < 0.3) t = t.replace(/^¿/, '').replace(/^¡/, '')
  // Ocasionalmente agregar un emoji/coletilla si no termina en emoji
  if (Math.random() < 0.25 && !/[\u{1F300}-\u{1FAFF}]$/u.test(t)) {
    t = t + EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)]
  }
  return t.trim()
}

// Inserta el catálogo semilla si el cliente aún no tiene conversaciones.
export async function seedWarmupCatalog(clientId) {
  const [{ count }] = await sql`
    SELECT count(*) FROM warmup_conversations
    WHERE (client_id = ${clientId} OR client_id IS NULL) AND is_active = true
  `
  if (parseInt(count) > 0) return { seeded: 0 }

  const rows = SEED_CONVERSATIONS.map(c => ({
    client_id: clientId,
    topic:     c.topic,
    lang:      'es',
    turns:     JSON.stringify(c.turns),
    source:    'manual',
  }))

  await sql`
    INSERT INTO warmup_conversations ${sql(rows, 'client_id', 'topic', 'lang', 'turns', 'source')}
  `
  return { seeded: rows.length }
}
