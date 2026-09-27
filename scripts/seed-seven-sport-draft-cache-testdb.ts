/** Guarded cache fixtures for seven-sport native draft browser verification. */
async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  globalThis.fetch = async () => { throw new Error('EXTERNAL_HTTP_DISABLED') }
  const { prisma } = await import('../lib/prisma')
  const { getEffectiveLeagueRosterTemplate, starterEligiblePlayerPositionsFromTemplate } = await import('../lib/league/getEffectiveLeagueRosterTemplate')
  const { rosterFingerprintFromEligible } = await import('../lib/draft-room/draft-pool-eligible-positions')
  const leagueId = process.argv[2]
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } })
  if (!league.name?.startsWith('seven-sport-browser-')) throw new Error('SYNTHETIC_BROWSER_LEAGUE_REQUIRED')
  const template = await getEffectiveLeagueRosterTemplate(leagueId)
  const eligible = starterEligiblePlayerPositionsFromTemplate(template.template)
  const allowed = eligible.size ? eligible : new Set(template.allowedPositions)
  const preferred: Record<string,string> = { NFL: 'WR', NBA: 'PG', NHL: 'C', MLB: 'OF', NCAAF: 'WR', NCAAB: 'G', SOCCER: 'FWD' }
  const position = allowed.has(preferred[league.sport]) ? preferred[league.sport] : [...allowed].sort()[0]
  if (!position) throw new Error('DRAFT_ELIGIBLE_POSITION_REQUIRED')
  const rosterFp = (template.hasPersistedRosterSchema ? 'cfg' : 'nocfg') + ':starters:' + rosterFingerprintFromEligible(allowed)
  const entries = Array.from({ length: 8 }, (_, i) => ({ playerId: league.name + '-p' + (i + 1), name: 'Fixture Player ' + (i + 1), position, team: 'FA', adp: i + 1 }))
  await prisma.draftPoolCache.create({ data: { leagueId, cacheKey: 'seven-sport-browser:' + leagueId, sourceFingerprint: rosterFp, entryCount: entries.length, sport: league.sport, poolType: 'pro', expiresAt: new Date(Date.now() + 3600000), payload: { entries, sport: league.sport, count: entries.length, rosterConfigurationIncomplete: false } } })
  console.log(JSON.stringify({ position, entries }))
  await prisma.$disconnect()
}
main().catch(() => { process.exitCode = 1 })
