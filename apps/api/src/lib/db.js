import postgres from 'postgres'
import { env } from '../config/env.js'

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 30,
})
