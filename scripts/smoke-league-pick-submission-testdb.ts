/** Real service/DB smoke. Explicit known test DB only; deletes only tracked synthetic rows. */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { configureEventInfrastructure, InMemoryOutboxStore, resetPlatformEvents } from '../lib/events'

import { startDraftSession } from '../lib/live-draft-engine/DraftSessionService'
import { submitPick } from '../lib/live-draft-engine/PickSubmissionService'
import { canSubmitPickForRoster } from '../lib/live-draft-engine/auth'
async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  if (!host.startsWith('ep-muddy-leaf-') || !host.endsWith('.neon.tech')) throw new Error('KNOWN_TEST_DATABASE_REQUIRED')
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN) throw new Error('SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })
  resetPlatformEvents()
  const marker = 'pick-smoke-' + randomUUID()
  const userIds: string[] = []
  let leagueId: string | undefined
  try {
    for (let i = 0; i < 3; i++) userIds.push((await prisma.appUser.create({ data: { username: marker + '-' + i, email: marker + '-' + i + '@example.invalid' } })).id)
    const validation = validateCreatePayload({ concept: 'redraft', sport: 'NFL', teamCount: 2, draftType: 'snake', scoringPreset: 'fb_ppr', leagueName: marker, timezone: 'America/Chicago' })
    if (!validation.ok) throw new Error('INVALID_FIXTURE')
    const engine = runPresetEngine({ ...validation.data, commissionerId: userIds[0] })
    const created = await prisma.$transaction(tx => createCanonicalLeagueInTransaction(tx, userIds[0], validation.data, engine), { timeout: 120000 })
    leagueId = created.leagueId
    await createDefaultLeagueRosterConfig(leagueId, 'NFL', 'redraft')
    const rosters = (await prisma.roster.findMany({ where: { leagueId } })).sort((a, b) => Number(b.platformUserId === userIds[0]) - Number(a.platformUserId === userIds[0]))
    await prisma.roster.update({ where: { id: rosters[1].id }, data: { platformUserId: userIds[1] } })
    if (!await canSubmitPickForRoster(leagueId, userIds[1], rosters[1].id) || await canSubmitPickForRoster(leagueId, userIds[1], rosters[0].id) || await canSubmitPickForRoster(leagueId, userIds[2], rosters[1].id)) throw new Error('OWNER_AUTHORITY')
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { rounds: 2, status: 'pre_draft', slotOrder: rosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: marker + '-team-' + i })) } })
    const started = await startDraftSession(leagueId)
    if (!started.ok) throw new Error('START_' + started.reason)
    const input = (overall: number, name: string, rosterIndex: number) => ({ leagueId: leagueId!, playerName: marker + '-' + name, position: 'WR', rosterId: rosters[rosterIndex].id, madeByUserId: userIds[rosterIndex], source: 'user' as const, expectedOverall: overall })
    const raced = await Promise.all([submitPick(input(1, 'A', 0)), submitPick(input(1, 'B', 0))])
    if (raced.filter(r => r.success).length !== 1 || await prisma.draftPick.count({ where: { sessionId: draft.id } }) !== 1) throw new Error('RACE_DOUBLE_COMMIT')
    const winner = await prisma.draftPick.findFirstOrThrow({ where: { sessionId: draft.id } })
    const stale = await submitPick(input(1, 'C', 1))
    if (stale.success || stale.code !== 'DRAFT_PICK_STALE_OVERALL') throw new Error('STALE_PICK')
    const duplicate = await submitPick({ ...input(2, 'ignored', 1), playerName: winner.playerName })
    if (duplicate.success || duplicate.code !== 'DRAFT_PICK_DUPLICATE_PLAYER') throw new Error('DUPLICATE_PLAYER')
    for (const [overall, owner] of [[2, 1], [3, 1], [4, 0]]) {
      const result = await submitPick(input(overall, 'player-' + overall, owner))
      if (!result.success) throw new Error('PICK_' + overall + '_' + (result.code ?? result.error))
    }
    const completed = await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const players = await prisma.redraftRosterPlayer.count({ where: { roster: { seasonId: season.id } } })
    if (completed.status !== 'completed' || players !== 4) throw new Error('AUTOMATIC_FINALIZATION')
    console.log(JSON.stringify({ target: 'known test database', ownerAuthority: true, competingPickExactlyOnce: true, staleRejected: true, duplicateRejected: true, autoCompleted: true, finalizedPlayers: players }))
  } finally {
    // Pick chat and achievement writes are intentionally asynchronous in the service.
    await new Promise(resolve => setTimeout(resolve, 5000))
    if (leagueId) {
      await prisma.analyticsEvent.deleteMany({ where: { OR: [{ meta: { path: ['leagueId'], equals: leagueId } }, { userId: { in: userIds } }] } })
      await prisma.automationLock.deleteMany({ where: { lockKey: 'draft:' + leagueId + ':pick' } })
      await prisma.league.deleteMany({ where: { id: leagueId } })
    }
    await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    console.log(JSON.stringify({ cleanup: { remainingLeagues: leagueId ? await prisma.league.count({ where: { id: leagueId } }) : 0, remainingUsers: await prisma.appUser.count({ where: { id: { in: userIds } } }) } }))
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error('Pick smoke failed:', error.code ?? error.message?.slice(0, 180)); process.exitCode = 1 })
