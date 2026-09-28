import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'

async function main() {
  if (!new URL(process.env.DATABASE_URL ?? '').hostname.includes('ep-muddy-leaf')) throw new Error('This smoke test only runs against the known test database')
  const db = new PrismaClient()
  const marker = 'audit-' + randomUUID()
  const results: unknown[] = []
  const rollback = new Error('ROLLBACK_AUDIT')
  try {
    try {
      await db.$transaction(async tx => {
        const user = await tx.appUser.create({ data: { username: marker, email: marker + '@example.invalid' } })
        for (const concept of ['redraft', 'dynasty', 'keeper']) {
          const conceptSetup = concept === 'dynasty'
            ? { startupRosterDepth: 24, benchCount: 12, irCount: 0, taxiSlots: 3, regularSeasonWeeks: 12, playoffTeamCount: 4, waiverTypeRecommended: 'rolling', faabBudget: 0 }
            : concept === 'keeper' ? { keeper_max_keepers: 2, keeperMaxKeepers: 2 } : {}
          const validation = validateCreatePayload({ concept, sport: 'NFL', teamCount: 12, draftType: 'snake', scoringPreset: 'fb_ppr', leagueName: marker, timezone: 'America/Chicago', tradeReviewMode: 'none', conceptSetup: { ...conceptSetup, thirdRoundReversal: true, medianGame: true, draftDate: '2026-11-08', draftTime: '20:00', draftTimezone: 'America/Chicago' } })
          if (!validation.ok) throw new Error('VALIDATION_' + validation.error)
          const body = validation.data
          const engine = runPresetEngine({ ...body, commissionerId: user.id })
          const created = await createCanonicalLeagueInTransaction(tx, user.id, body, engine)
          const [league, draft, rosters, slots, review] = await Promise.all([
            tx.league.findUniqueOrThrow({ where: { id: created.leagueId } }),
            tx.draftSession.findFirstOrThrow({ where: { leagueId: created.leagueId } }),
            tx.roster.count({ where: { leagueId: created.leagueId } }),
            tx.leagueEntrySlot.count({ where: { leagueId: created.leagueId } }),
            tx.redraftLeagueExtendedSettings.findUniqueOrThrow({ where: { leagueId: created.leagueId } }),
          ])
          if (rosters !== 12 || slots !== 12 || !draft.thirdRoundReversal || !league.medianGame || review.commissionerTradeReviewType !== 'instant') throw new Error('PERSISTENCE_PARITY_' + concept)
          if (concept === 'dynasty' && (draft.rounds !== 24 || league.playoffTeams !== 4 || league.playoffStartWeek !== 13)) throw new Error('DYNASTY_PARITY')
          if (concept === 'keeper' && league.keeperCount !== 2) throw new Error('KEEPER_PARITY')
          results.push({ concept, rosters, slots, draftRounds: draft.rounds, thirdRoundReversal: draft.thirdRoundReversal, medianGame: league.medianGame, tradeReview: review.commissionerTradeReviewType })
        }
        throw rollback
      }, { timeout: 120000, maxWait: 20000 })
    } catch (error) { if (error !== rollback) throw error }
    if (await db.appUser.count({ where: { username: marker } }) !== 0) throw new Error('ROLLBACK_NOT_CONFIRMED')
    console.log(JSON.stringify({ target: 'test database', rolledBack: true, results }, null, 2))
  } finally { await db.$disconnect() }
}
main().catch(error => { console.error('Smoke failed:', error.code ?? error.message?.slice(0, 180)); process.exitCode = 1 })
