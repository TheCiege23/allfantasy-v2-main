import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Regression guard for the tournament id-space leak.
 *
 * `normalizedTournaments` (lib/dashboard/get-dashboard-league-list.ts) builds one board row per
 * `LegacyTournament`, and sets `id`, `unifiedLeagueId` and `navigationLeagueId` to the
 * **`LegacyTournament` primary key** while marking the row `hasUnifiedRecord: true`. Nothing in the
 * `leagues` table carries that id, so `prisma.league.findUnique({ where: { id } })` returns null for
 * every one of them — but because the flag is `true`, every `hasUnifiedRecord !== false` filter in
 * the codebase (the `/core` rail, My Leagues, the Decision OS command centers, Start/Sit's picker,
 * the player page's league scope, Commissioner Hub's health tiles) handed those ids straight to a
 * `leagues`-keyed query.
 *
 * `normalizedSleeper` has the mirror-image shape — `id` is a `SleeperLeague.id` — but it is filtered
 * to `!hasUnifiedRecord`, so the page-level filters already drop it. Tournaments were the path that
 * leaked, and `hasUnifiedRecord` is structurally unable to express it: the board reads that flag as
 * "this row opens to something real", which a tournament does, at `/tournament/[id]`.
 *
 * The discriminator is `kind`. These tests fail if a tournament row stops carrying it, or if the
 * shared predicate goes back to reading `hasUnifiedRecord` on its own.
 */

const leagueFindMany = vi.fn()
const sleeperFindMany = vi.fn()
const legacyTournamentFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    sleeperLeague: { findMany: (...a: unknown[]) => sleeperFindMany(...a) },
    legacyLeague: { findMany: vi.fn().mockResolvedValue([]) },
    legacyTournament: { findMany: (...a: unknown[]) => legacyTournamentFindMany(...a) },
    redraftSeason: { groupBy: vi.fn().mockResolvedValue([]) },
    leagueSeason: { groupBy: vi.fn().mockResolvedValue([]) },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    appUser: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))

import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import {
  isTournamentHubRow,
  resolvesToLeagueRecord,
  shouldFetchLeagueScopedData,
} from '@/lib/dashboard/league-card-fetch-policy'

type BoardRow = Record<string, unknown>

const nativeLeague = {
  id: 'league-uuid-1',
  userId: 'user-1',
  name: 'Dynasty Warlords',
  sport: 'NFL',
  leagueVariant: null,
  platform: 'sleeper',
  platformLeagueId: '111111111111111111',
  leagueSize: 12,
  season: 2026,
  status: 'in_season',
  settings: null,
  redraftMembers: [],
  teams: [],
  rosters: [],
}

const tournament = {
  id: 'tournament-uuid-1',
  name: 'AllFantasy Kickoff Classic',
  sport: 'NFL',
  season: 2026,
  status: 'active',
  settings: { participantPoolSize: 48 },
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-20T00:00:00Z'),
  leagues: [{ leagueId: 'league-uuid-1' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindMany.mockResolvedValue([nativeLeague])
  sleeperFindMany.mockResolvedValue([])
  legacyTournamentFindMany.mockResolvedValue([tournament])
})

describe('dashboard league list — tournament rows carry their own id space', () => {
  it('emits a tournament row that still claims hasUnifiedRecord, so the flag alone cannot gate it', async () => {
    const { leagues } = await getDashboardLeagueListForUser('user-1')
    const row = (leagues as BoardRow[]).find((l) => l.id === 'tournament-uuid-1')

    expect(row).toBeDefined()
    // Documenting the trap, not endorsing it: the board and league-list-destination read this flag as
    // "opens to something real", and a tournament does — at /tournament/[id], not /league/[id].
    expect(row?.hasUnifiedRecord).toBe(true)
    expect(row?.unifiedLeagueId).toBe('tournament-uuid-1')
    expect(row?.navigationLeagueId).toBe('tournament-uuid-1')
  })

  it('tags every row with the table its id came from', async () => {
    const { leagues } = await getDashboardLeagueListForUser('user-1')
    const byId = new Map((leagues as BoardRow[]).map((l) => [l.id as string, l]))

    expect(byId.get('tournament-uuid-1')?.kind).toBe('tournament')
    expect(byId.get('league-uuid-1')?.kind).toBe('league')
  })

  it('keeps tournament ids out of anything that resolves against the leagues table', async () => {
    const { leagues } = await getDashboardLeagueListForUser('user-1')
    const rows = leagues as BoardRow[]

    // The filter every consumer now applies before a prisma.league query.
    const resolvable = rows.filter((r) => resolvesToLeagueRecord(r)).map((r) => r.id)

    expect(resolvable).toEqual(['league-uuid-1'])
    // The pre-fix filter, kept here to show it is not equivalent — it would let the tournament through.
    expect(rows.filter((r) => r.hasUnifiedRecord !== false).map((r) => r.id)).toContain('tournament-uuid-1')
  })

  it('still lets the tournament reach the board, so /tournament/[id] keeps its entry point', async () => {
    const { leagues } = await getDashboardLeagueListForUser('user-1')

    // The fix is a discriminator, not an exclusion: /api/league/list is where the dashboard board
    // gets its tournament hub tile (league-list-destination.ts routes it on `league_variant`).
    const row = (leagues as BoardRow[]).find((l) => l.id === 'tournament-uuid-1')
    expect(row?.league_variant).toBe('tournament_hub')
    expect(row?.platform).toBe('allfantasy')
  })
})

describe('resolvesToLeagueRecord', () => {
  it('rejects both id-space escapes and nothing else', () => {
    expect(resolvesToLeagueRecord({ kind: 'tournament', hasUnifiedRecord: true })).toBe(false)
    expect(resolvesToLeagueRecord({ hasUnifiedRecord: false })).toBe(false)

    expect(resolvesToLeagueRecord({ kind: 'league', hasUnifiedRecord: true })).toBe(true)
    // Absent flags mean "real league", matching shouldFetchLeagueScopedData's own default.
    expect(resolvesToLeagueRecord({})).toBe(true)
  })

  it('falls back to league_variant for rows built before `kind` existed', () => {
    // Safe because no `League` row is ever written with leagueVariant 'tournament_hub' — the only
    // tournament variant on a real league row is 'tournament_mode'.
    expect(isTournamentHubRow({ league_variant: 'tournament_hub' })).toBe(true)
    expect(isTournamentHubRow({ leagueVariant: 'tournament_hub' })).toBe(true)
    expect(isTournamentHubRow({ leagueVariant: 'tournament_mode' })).toBe(false)
    expect(resolvesToLeagueRecord({ league_variant: 'tournament_hub', hasUnifiedRecord: true })).toBe(false)
  })

  it('stops MyLeagueCard firing league-scoped fetches for a tournament hub', () => {
    // /api/league/detail 404s for a LegacyTournament id for exactly the reason it does for a legacy row.
    expect(shouldFetchLeagueScopedData({ kind: 'tournament', hasUnifiedRecord: true })).toBe(false)
  })
})

/**
 * Source-level ratchet, in the same spirit as `sleeper-import-rank-only-contract.test.ts`.
 *
 * The predicate is easy to get right once and easy to lose: the natural thing to write at each of
 * these call sites is `hasUnifiedRecord === true` / `!== false`, which reads correct and silently
 * readmits every tournament. Pinning the call sites to the shared predicate is what stops the bug
 * from growing back one component at a time.
 */
import fs from 'node:fs'
import path from 'node:path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

describe('id-resolution call sites use the shared predicate, not the raw flag', () => {
  const gated: Array<[string, string]> = [
    ['lib/core-app/dash34.ts', 'the ranker fans roster/injury/matchup reads over these rows'],
    ['lib/core-app/myLeagues.ts', 'My Leagues tiers'],
    ['lib/shared-services/league-hub/LeaguePortfolioService.ts', 'canonical league id for the OS modules'],
    ['app/core/[[...screen]]/page.tsx', 'the /core rail and every per-screen loader'],
    ['app/players/[slug]/page.tsx', 'league-scoped player context'],
    ['app/commissioner-hub/page.tsx', 'commissioner health tiles'],
    ['app/manager-hub/page.tsx', 'Manager OS league scope'],
    ['app/fantasy-os/page.tsx', 'executive gateway league list'],
    ['app/api/decision-os/commissioner-command-center/route.ts', 'Commissioner OS aggregation'],
    ['app/api/decision-os/manager-command-center/route.ts', 'Manager OS aggregation'],
    ['app/api/start-sit/leagues/route.ts', 'Start/Sit picker'],
    ['app/trade-evaluator/page.tsx', 'linked-league membership gate'],
    ['components/dashboard/nocturne/NocturneDashboard.tsx', 'Live/History scope + team panel'],
    ['components/dashboard/adaptive/AdaptiveDashboard.tsx', 'unified flag + UserLeague mapping'],
    ['components/chimmy/ChimmyChatShell.tsx', 'Chimmy grounds on the leagues table'],
    ['components/WaiverAISuggestions.tsx', 'leagueId posts to /api/waiver-ai-suggest'],
    ['app/trade-finder/page.tsx', '/api/league/roster + /api/trade-partner-match'],
    ['components/dashboard/FinalDashboardClient.tsx', 'firstLeague seeds every quick-action href'],
    ['components/league-creation-wizard/LeagueSourceSection.tsx', 'copy-from-league source list'],
    ['app/career-share/page.tsx', 'first league is auto-selected and POSTed as leagueId'],
    ['app/legacy/page.tsx', 'feeds MockDraftSimulatorClient, which fetches /api/leagues/<id>/roster-config'],
  ]

  it.each(gated)('%s gates on resolvesToLeagueRecord (%s)', (file) => {
    expect(read(file)).toContain('resolvesToLeagueRecord')
  })

  const droppers: Array<[string, string]> = [
    ['app/waiver-ai/page.tsx', 'rosterLeagueId feeds /api/league/roster'],
    ['app/power-rankings/page.tsx', 'picker entry would be dead'],
    ['app/season-strategy/page.tsx', 'picker entry would be dead'],
    ['components/mock-draft/MockDraftSleeperRoomClient.tsx', 'picker entry would be dead'],
  ]

  it.each(droppers)('%s drops tournament rows from its picker (%s)', (file) => {
    expect(read(file)).toContain('isTournamentHubRow')
  })

  it('LeagueSyncDashboard opens rows through the destination resolver, not a raw /league/ push', () => {
    // `/league/${unifiedLeagueId}` is a 404 for a tournament — resolveLeagueHomeHrefFromListRow is
    // the only thing that knows it opens at /tournament/[id].
    expect(read('app/components/LeagueSyncDashboard.tsx')).toContain('resolveLeagueHomeHrefFromListRow')
  })
  it('DashboardShell.mapLeague carries the markers instead of dropping them', () => {
    /*
     * This mapper prefers `navigationLeagueId`/`unifiedLeagueId` for `id` — for a tournament row all
     * three are the same `LegacyTournament` key. It must not drop the row (the board renders a
     * tournament tile deliberately), so it has to TAG it, or every downstream consumer is blind.
     */
    const src = read('app/dashboard/DashboardShell.tsx')
    expect(src).toContain('hasUnifiedRecord: raw.hasUnifiedRecord === true')
    expect(src).toContain("raw.kind === 'tournament'")
  })

  it('AdaptiveDashboard withholds the synthetic provider id from the rankings engine', () => {
    // Tournaments fabricate `platformLeagueId: `tournament-<id>`` — a second id space, matching no
    // `legacyLeague.sleeperLeagueId`. The `unified` flag describes `leagues` and cannot catch it.
    expect(read('components/dashboard/adaptive/AdaptiveDashboard.tsx')).toContain('isTournamentHubRow')
  })
})
