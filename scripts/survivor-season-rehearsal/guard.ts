/**
 * The one rule both rehearsal scripts run before touching a database: DATABASE_URL must name the
 * isolated rehearsal endpoint (SURVIVOR_REHEARSAL_ENDPOINT), never production, and no delivery
 * credential may be in the environment. Shared so the season run and the walkthrough cannot drift.
 */
import assert from 'node:assert/strict'

export const PRODUCTION_ENDPOINT = 'ep-curly-block-ad0dlt9o'

export const DELIVERY_ENV = [
  'RESEND_API_KEY', 'VAPID_PRIVATE_KEY', 'APNS_PRIVATE_KEY', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_SECRET',
  'PUSHER_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'DISCORD_BOT_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'DEEPSEEK_API_KEY',
]

export function assertIsolatedRehearsalDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.DATABASE_URL ?? ''
  const host = url.match(/@([^/:?]+)/)?.[1] ?? ''
  const endpoint = host.split('.')[0].replace(/-pooler$/, '')
  assert.ok(endpoint, 'DATABASE_URL must be set explicitly')
  assert.notEqual(endpoint, PRODUCTION_ENDPOINT, 'Refusing the production endpoint')
  assert.equal(endpoint, env.SURVIVOR_REHEARSAL_ENDPOINT, 'DATABASE_URL must point at SURVIVOR_REHEARSAL_ENDPOINT')
  const present = DELIVERY_ENV.filter(k => env[k])
  assert.deepEqual(present, [], `Unset delivery credentials first: ${present.join(', ')}`)
}
