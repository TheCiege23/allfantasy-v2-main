/** Explicit live-provider draft grounding smoke. No production database access. */
async function main() {
  if (process.env.AF_LIVE_DRAFT_AI_CHECK !== '1' || process.env.AI_FEATURES_ENABLED !== 'true') throw new Error('EXPLICIT_LIVE_AI_CHECK_REQUIRED')
  for (const key of ['DATABASE_URL','DIRECT_DATABASE_URL','DIRECT_URL','POSTGRES_URL','POSTGRES_PRISMA_URL','POSTGRES_URL_NON_POOLING']) process.env[key] = 'postgresql://blocked:blocked@127.0.0.1:1/blocked'
  process.env.REDIS_URL = ''
  process.env.UPSTASH_REDIS_REST_URL = ''
  process.env.UPSTASH_REDIS_REST_TOKEN = ''
  // Isolate accounting from this bounded seven-request smoke. No production DB writes.
  // Production rate-limit behavior is a separate acceptance case.
  const { rateLimitManager } = await import('../lib/workers/rate-limit-manager')
  rateLimitManager.canCall = async () => true
  rateLimitManager.recordCall = async () => undefined
  const { routeTextCall } = await import('../lib/ai/providerRouter')
  const results = []
  const sports = ['NFL','NBA','NHL','MLB','NCAAF','NCAAB','SOCCER']
  const requestedSport = process.argv[2]
  if (requestedSport && !sports.includes(requestedSport)) throw new Error('SUPPORTED_SPORT_REQUIRED')
  for (const sport of requestedSport ? [requestedSport] : sports) {
    const result = await routeTextCall({ skipCache: true, maxTokens: 160, temperature: 0,
      messages: [
        { role: 'system', content: 'You explain draft choices using only supplied evidence. Return JSON with sport, recommendedPlayer, missingMarketAdp (boolean), missingStats (boolean). Never invent statistics or market ADP.' },
        { role: 'user', content: JSON.stringify({ sport, available: [{ name: 'Eligible Fixture', eligible: true, marketAdp: null, stats: null }, { name: 'Already Drafted Fixture', eligible: false, drafted: true }], instruction: 'Recommend an available eligible player. Explicitly mark missing market ADP and statistics.' }) },
      ] })
    let valid = false
    try {
      const text = result.text ?? ''
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      valid = parsed.sport === sport && parsed.recommendedPlayer === 'Eligible Fixture' && parsed.missingMarketAdp === true && parsed.missingStats === true
    } catch { /* Malformed or missing evidence is a failed check. */ }
    results.push({ sport, ok: result.ok && valid, provider: result.provider ?? null, model: result.model ?? null })
    console.log(JSON.stringify(results[results.length - 1]))
  }
  if (results.some(result => !result.ok)) process.exitCode = 1
}
main().catch(error => { console.error('Live AI draft check failed:', error.name); process.exitCode = 1 })
