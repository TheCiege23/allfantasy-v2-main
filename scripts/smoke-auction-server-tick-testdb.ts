/**
 * The server draft tick closing an expired auction bid with NOBODY in the room — on the known test DB.
 *
 * A real auction draft is started; the first nominator nominates, a second manager bids, and the bid
 * clock is moved into the past (time travel, not a code path). Then the server's per-league auction
 * processor runs TWICE AT ONCE, as a cron tick racing a room poll would. Exactly one sale must happen.
 *
 * Calls `processExpiredAuctionForLeague` directly, not the scanner: the scanner advances EVERY expired
 * draft in the database, and the test DB holds other sessions' fixtures. Never accepts a production host.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { applyDefaultNflScoringOnCreate } from '../lib/nfl-scoring'
import { startDraftSession } from '../lib/live-draft-engine/DraftSessionService'
import { getAuctionStateFromSession, getBudgetsFromSession, nominatePlayer, placeBid } from '../lib/live-draft-engine/auction'
import { processExpiredAuctionForLeague } from '../lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'auctick-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const report: Record<string, unknown> = {}
  try {
    for (let i = 0; i < 4; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)
    const v = validateCreatePayload({ concept: 'redraft', sport: 'NFL', teamCount: 4, draftType: 'auction', scoringPreset: 'fb_ppr', leagueName: marker, timezone: 'America/Chicago', conceptSetup: {} })
    if (!v.ok) throw new Error('CREATION_' + v.error)
    const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
    leagues.push(leagueId)
    await createDefaultLeagueRosterConfig(leagueId, 'NFL', 'redraft')
    await applyDefaultNflScoringOnCreate(leagueId, 'af_ppr')
    const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }))
      .sort((a, b) => Number(b.platformUserId === users[0]) - Number(a.platformUserId === users[0]))
    for (let i = 0; i < 4; i++) {
      await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i]!.platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i] } })
      await prisma.roster.update({ where: { id: generic[i]!.id }, data: { platformUserId: users[i] } })
    }

    const started = await startDraftSession(leagueId)
    check(started.ok, 'START:' + JSON.stringify(started))
    let session = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    check(session.draftType === 'auction' && session.status === 'in_progress', `AUCTION_IN_PROGRESS:${session.draftType}/${session.status}`)
    const slotOrder = session.slotOrder as unknown as Array<{ rosterId: string }>
    const stateBefore = getAuctionStateFromSession(session)!
    const nominator = slotOrder[stateBefore.nominationOrderIndex % slotOrder.length]!.rosterId
    const bidder = slotOrder.find((s) => s.rosterId !== nominator)!.rosterId
    const budgetBefore = getBudgetsFromSession(session)[bidder] ?? 0

    const nom = await nominatePlayer(leagueId, { playerName: `${marker} Test Back`, position: 'RB', team: 'DAL', playerId: `${marker}-rb` }, nominator)
    check(nom.success, 'NOMINATE:' + nom.error)
    const bid = await placeBid(leagueId, bidder, 7)
    check(bid.success, 'BID:' + bid.error)

    // Nobody is in the room. The bid clock runs out.
    await prisma.draftSession.update({ where: { id: session.id }, data: { timerEndAt: new Date(Date.now() - 60_000) } })

    // ── The change under test, twice at once ────────────────────────────────────────────────
    const [a, b] = await Promise.all([processExpiredAuctionForLeague(leagueId), processExpiredAuctionForLeague(leagueId)])
    const picks = await prisma.draftPick.findMany({ where: { sessionId: session.id } })
    session = await prisma.draftSession.findFirstOrThrow({ where: { id: session.id } })
    const stateAfter = getAuctionStateFromSession(session)!
    const budgetAfter = getBudgetsFromSession(session)[bidder] ?? 0

    check(picks.length === 1, 'EXACTLY_ONE_SALE:' + picks.length)
    check(picks[0]!.rosterId === bidder && picks[0]!.amount === 7, `SOLD_TO_HIGH_BIDDER:${picks[0]!.rosterId}/${picks[0]!.amount}`)
    check(budgetAfter === budgetBefore - 7, `BUDGET:${budgetBefore}->${budgetAfter}`)
    check(stateAfter.currentNomination == null, 'NOMINATION_CLEARED')
    check(stateAfter.nominationOrderIndex !== stateBefore.nominationOrderIndex, 'NEXT_NOMINATOR')
    check(session.timerEndAt && session.timerEndAt.getTime() > Date.now(), 'NEW_NOMINATION_CLOCK_STARTED')
    const outcomes = [a, b].map((d) => d.outcome)
    check(outcomes.filter((o) => o === 'processed_auction').length === 1, 'ONE_PROCESSOR_ACTED:' + JSON.stringify([a, b]))

    // A second pass with the new clock not yet expired does nothing.
    const again = await processExpiredAuctionForLeague(leagueId)
    check(again.outcome === 'skipped', 'IDLE_PASS_IS_A_SKIP:' + JSON.stringify(again))
    check((await prisma.draftPick.count({ where: { sessionId: session.id } })) === 1, 'NO_SECOND_SALE')

    Object.assign(report, {
      concurrentOutcomes: [a, b],
      sale: { toBidder: true, amount: picks[0]!.amount },
      budget: { before: budgetBefore, after: budgetAfter },
      nominationIndex: { before: stateBefore.nominationOrderIndex, after: stateAfter.nominationOrderIndex },
      idlePass: again,
    })
  } finally {
    await prisma.automationLock.deleteMany({ where: { lockKey: { contains: leagues[0] ?? '__none__' } } }).catch(() => undefined)
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      sessions: await prisma.draftSession.count({ where: { leagueId: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    check(Object.values(cleanup).every((n) => n === 0), 'CLEANUP:' + JSON.stringify(cleanup))
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('Auction server-tick smoke failed:', e.code ?? e.message); process.exitCode = 1 })
