// Read-only release gate. Exit 2 means a preserved-benefit rollout is required before narrowing Supreme.
const { Client } = require('pg')
const { identifyTarget } = require('./db-target-identity.cjs')
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (identifyTarget(connectionString || '').kind !== 'production') throw new Error('Expected known production target')
const client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 10000 })
async function main() {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const subscriptions = await client.query(`SELECT p.code AS plan, s.status, count(*)::int AS count
    FROM user_subscriptions s JOIN subscription_plans p ON p.id = s."subscriptionPlanId"
    WHERE lower(btrim(p.code)) IN ('af_supreme', 'supreme')
      OR left(lower(btrim(coalesce(s.sku, ''))), 11) = 'af_supreme_'
    GROUP BY p.code, s.status ORDER BY p.code, s.status`)
  const grants = await client.query(`SELECT tier, count(*)::int AS count FROM admin_subscription_grants
    WHERE lower(btrim(tier))='supreme' AND "revokedAt" IS NULL AND "expiresAt">NOW() GROUP BY tier`)
  await client.query('ROLLBACK')
  const requiresPreservation = subscriptions.rows.length > 0 || grants.rows.length > 0
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), target: 'production',
    supremeSubscriptionsByStatus: subscriptions.rows, activeSupremeGrants: grants.rows, requiresPreservation }))
  if (requiresPreservation) process.exitCode = 2
}
main().catch(e => { console.error(e.code || e.name || 'database inventory failed'); process.exitCode=1 }).finally(()=>client.end())
