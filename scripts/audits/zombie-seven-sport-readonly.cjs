/** Anonymized, database-only acceptance inventory. Never starts drafts or fetches providers. */
const { PrismaClient } = require('@prisma/client')
const { identifyTarget } = require('../db-target-identity.cjs')
async function main() {
  const connection = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connection) throw new Error('An explicit database URL is required')
  const url = new URL(connection), local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  const production = identifyTarget(connection).kind === 'production'
  if (!local && !(production && process.env.ALLOW_ZOMBIE_READONLY_PROD === '1')) throw new Error('Use explicit loopback or the guarded production read-only audit')
  const season = Number(process.env.ZOMBIE_AUDIT_SEASON)
  if (!Number.isInteger(season) || season < 2020 || season > 2200) throw new Error('An explicit audit season is required')
  const db = new PrismaClient({ datasources: { db: { url: connection } } })
  try {
    const sports = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const report = []
      for (const sport of ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']) {
        const [leagues, players, calendars, matches, corrections] = await Promise.all([
          tx.zombieLeague.groupBy({ by: ['status'], where: { sport, season }, _count: true }),
          tx.playerWeeklyScore.aggregate({ where: { sport, season, isFinalized: true }, _count: true, _max: { updatedAt: true } }),
          tx.sportsGame.groupBy({ by: ['source'], where: { sport, season, startTime: { not: null } }, _count: true, _min: { startTime: true }, _max: { startTime: true } }),
          tx.redraftMatchup.count({ where: { season: { sport, season }, league: { zombieLeague: { isNot: null } }, awayRosterId: { not: null }, isMedianMatchup: false, status: { in: ['final', 'complete', 'completed'] } } }),
          tx.zombieWeeklyResolution.count({ where: { league: { sport, season }, requiresStatCorrection: true } }),
        ])
        report.push({ sport, leagueStates: Object.fromEntries(leagues.map(l => [l.status, l._count])), finalizedPlayerRows: players._count,
          latestFinalPlayerRowAt: players._max.updatedAt, savedCalendars: calendars.map(c => ({ source: c.source, count: c._count, first: c._min.startTime, last: c._max.startTime })), completedZombieMatchups: matches, unresolvedCorrections: corrections,
          acceptance: 'NOT_ESTABLISHED_BY_ROW_COUNTS' })
      }
      return report
    }, { timeout: 60_000 })
    process.stdout.write(JSON.stringify({ observedAt: new Date().toISOString(), season, target: production ? 'verified-production-read-only' : 'explicit-loopback-read-only', sports,
      limitations: ['No provider API was called.', 'Counts do not establish scoring completeness, calibrated gameplay, consent or physical iPhone acceptance.'] }, null, 2) + '\n')
  } finally { await db.$disconnect() }
}
main().catch(error => { process.stderr.write(`Zombie read-only audit failed: ${error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted connection]')}\n`); process.exitCode = 1 })
