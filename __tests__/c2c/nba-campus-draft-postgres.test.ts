// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

// Keep the real draft transaction and eligibility reads, but never send chat or analytics from a rehearsal.
vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({ postDraftPickChatEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn() }))
vi.mock('@/lib/player-trend/signal-integration', () => ({ resolveTrendPlayerIds: vi.fn(async () => []), recordTrendSignalByPlayerId: vi.fn(async () => undefined) }))
vi.mock('@/lib/draft/draftLock', async load => ({ ...(await load<typeof import('@/lib/draft/draftLock')>()), withPickLock: async (_leagueId: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn(), backend: 'passthrough' }) }))

import { prisma } from '@/lib/prisma'
import { currentNcaabSeasonYear, ESPN_NCAAB_ROSTER_KEY_PREFIX } from '@/lib/espn/ncaabRosterSnapshot'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { finalizeRosterAssignments } from '@/lib/live-draft-engine/RosterAssignmentService'

const pilot = process.env.NBA_CAMPUS_POSTGRES_PILOT === '1' ? describe : describe.skip
pilot('NBA campus live draft submission on isolated Postgres', () => {
  it('verifies and persists a current college pick and assigns its drafted rights', async () => {
    const target = new URL(process.env.DATABASE_URL!)
    expect(target.hostname).toBe('ep-billowing-shadow-ado0fgzv-pooler.c-2.us-east-1.aws.neon.tech')
    expect(target.pathname).toBe('/neondb')
    const id = `campus-draft-${randomUUID()}`, owner = `${id}-owner`, rr = `${id}-redraft`, roster = `${id}-roster`
    const athleteId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const teamId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`))
    const player = `espn:ncaab:${athleteId}`, now = new Date(), year = currentNcaabSeasonYear(now)
    const cacheKey = `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${year}:${teamId}`
    const name = `Synthetic ${athleteId}`
    try {
      await prisma.appUser.create({ data: { id: owner, email: `${id}@example.invalid`, username: id } })
      await prisma.league.create({ data: { id, userId: owner, platform: 'manual', platformLeagueId: id, leagueType: 'dynasty', leagueVariant: 'c2c', sport: 'NBA', isDynasty: true, settings: {} } })
      await prisma.c2CLeagueConfig.create({ data: { leagueId: id, collegeScoringSystem: 'points', bestBallPro: false, bestBallCollege: false, standingsModel: 'unified' } })
      const season = await prisma.redraftSeason.create({ data: { leagueId: id, sport: 'NBA', season: 2026, status: 'active', totalWeeks: 18, playoffStartWeek: 19 } })
      await prisma.redraftRoster.create({ data: { id: rr, leagueId: id, seasonId: season.id, ownerId: owner, ownerName: 'Home' } })
      await prisma.roster.create({ data: { id: roster, leagueId: id, platformUserId: owner, redraftRosterId: rr, playerData: {} } })
      await prisma.devyPlayer.create({ data: { id: player, name, normalizedName: name.toLowerCase(), position: 'G', school: 'Synthetic School', sport: 'NCAAB', source: 'espn_ncaab_roster', devyEligible: true } })
      await prisma.sportsDataCache.create({ data: { cacheKey, expiresAt: new Date(now.getTime() + 86400000), data: { seasonYear: year, teamId, school: 'Synthetic School', observedAt: now.toISOString(), athletes: [{ id: athleteId, fullName: name, position: 'G' }] } } })
      const draft = await prisma.draftSession.create({ data: { leagueId: id, status: 'in_progress', draftModeLabel: 'startup', draftType: 'snake', rounds: 1, teamCount: 2, c2cConfig: { enabled: true, collegeRounds: [1] }, slotOrder: [{ slot: 1, rosterId: roster, displayName: 'Home' }, { slot: 2, rosterId: `${id}-open`, displayName: 'Open' }] } })
      const result = await submitPick({ leagueId: id, playerId: player, playerName: name, position: 'G', rosterId: roster, source: 'user', expectedOverall: 1 })
      expect(result).toMatchObject({ success: true, snapshot: { sessionId: draft.id, overall: 1, rosterId: roster } })
      expect(await prisma.draftPick.findFirstOrThrow({ where: { sessionId: draft.id, overall: 1 } })).toMatchObject({ playerId: player, assetType: 'c2c_college' })
      expect(await prisma.devyRights.findFirstOrThrow({ where: { leagueId: id, rosterId: roster, devyPlayerId: player } })).toMatchObject({ state: 'COLLEGE_ACTIVE' })
      await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
      expect(await finalizeRosterAssignments(id, draft.id)).toMatchObject({ teamsSynced: 1, playersSynced: 1 })
      const saved = await prisma.roster.findUniqueOrThrow({ where: { id: roster } })
      expect(saved.playerData).toMatchObject({ lineup_sections: { devy: [expect.objectContaining({ id: player })] } })
    } finally {
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey } })
      await prisma.league.deleteMany({ where: { id } })
      await prisma.devyPlayer.deleteMany({ where: { id: player } })
      await prisma.appUser.deleteMany({ where: { id: owner } })
    }
  }, 90000)
})
