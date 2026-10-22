// @vitest-environment node
/**
 * Player news is bound to ONE player, and routed by HIS team — never by the news row's `team` tag.
 *
 * Measured on production 2026-10-11: for NFL names that map to exactly one player, the row's tag
 * disagreed with the player's canonical team on 804 of 2,077 tagged `newsapi_everything` rows (447
 * high impact), because the extractor tags whatever club the article names. "Burrow throws 4 TDs…
 * Bengals beat Dolphins" was stored as Ja'Marr Chase / MIA — and that one row was DROPPED for every
 * manager rostering Chase and SENT to Dolphins followers.
 *
 * The registry, roster and follow rows below mirror production (sleeper ids included).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Pim = { id: string; canonicalName: string; normalizedName: string; position: string; currentTeam: string; sleeperId: string }
type RosterRow = { playerId: string; playerName: string; team: string | null; sport: string; roster: { ownerId: string; leagueId: string } }
type FollowRow = { user_id: string; sleeper_id: string | null; name: string; position: string | null; team: string | null }

const REGISTRY: Pim[] = [
  { id: 'pim-chase', canonicalName: "Ja'Marr Chase", normalizedName: "ja'marr chase", position: 'WR', currentTeam: 'CIN', sleeperId: '7564' },
  { id: 'pim-allen-qb', canonicalName: 'Josh Allen', normalizedName: 'josh allen', position: 'QB', currentTeam: 'BUF', sleeperId: '4984' },
  { id: 'pim-allen-dl', canonicalName: 'Josh Allen', normalizedName: 'josh allen', position: 'DL', currentTeam: 'JAX', sleeperId: '5840' },
  { id: 'pim-ward', canonicalName: 'Cameron Ward', normalizedName: 'cameron ward', position: 'QB', currentTeam: 'TEN', sleeperId: '12522' },
  // Production holds this QB twice; the twin without a Sleeper id must not read as a namesake.
  { id: 'pim-penix', canonicalName: 'Michael Penix Jr.', normalizedName: 'michael penix', position: 'QB', currentTeam: 'ATL', sleeperId: '11559' },
  { id: 'pim-penix-dup', canonicalName: 'Michael Penix JR', normalizedName: 'michael penix', position: 'QB', currentTeam: 'ATL', sleeperId: '' },
  { id: 'pim-randolph', canonicalName: 'Keith Randolph Jr.', normalizedName: 'keith randolph', position: 'DL', currentTeam: 'GB', sleeperId: '12042' },
]

const h = vi.hoisted(() => ({
  news: [] as Array<Record<string, unknown>>,
  roster: [] as RosterRow[],
  follows: [] as FollowRow[],
  dispatch: vi.fn(),
  resolveNewsTeam: vi.fn(),
  teamFollowers: vi.fn(),
}))

/** `contains`, case-insensitive — what the Prisma `mode: 'insensitive'` filter does. */
const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: async () => h.news, updateMany: async () => ({ count: 1 }) },
    // Honours the OR the binding sends, so a lookup that asks the wrong question finds nothing.
    playerIdentityMap: {
      findMany: async ({ where }: { where: { sport: string; sleeperId?: { in: string[] }; OR?: Array<Record<string, { contains?: string; in?: string[] }>> } }) =>
        REGISTRY.filter((p) =>
          where.sport === 'NFL' &&
          (where.sleeperId ? where.sleeperId.in.includes(p.sleeperId) : false ||
          (where.OR ?? []).some((c) =>
            (c.canonicalName?.contains != null && has(p.canonicalName, c.canonicalName.contains)) ||
            (c.normalizedName?.in != null && c.normalizedName.in.includes(p.normalizedName)),
          )),
        ),
    },
    // Rows whose name contains any of the spellings asked for (OR), or the single `contains` the
    // pre-fix lookup used — so a reverted lookup still returns its candidates and the GATE is tested.
    redraftRosterPlayer: {
      findMany: async ({ where }: { where: { OR?: Array<{ playerName: { contains: string } }>; playerName?: { contains?: string; equals?: string } } }) => {
        if (where.playerName?.equals != null) return h.roster.filter((r) => r.playerName.toLowerCase() === where.playerName!.equals!.toLowerCase())
        const needles = where.OR ? where.OR.map((c) => c.playerName.contains) : [where.playerName!.contains!]
        return h.roster.filter((r) => needles.some((n) => has(r.playerName, n)))
      },
    },
    $queryRaw: async () => h.follows,
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: () => 'injury' }))
vi.mock('@/lib/follows/teamFollows', () => ({ listFollowerIdsForTeam: h.teamFollowers }))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({
  resolveNewsTeam: h.resolveNewsTeam,
  withinTeamFollowDailyCap: async (ids: string[]) => ids,
}))
vi.mock('@/lib/notifications/playerNewsRepeatGuard', () => ({
  alreadyToldAbout: async () => new Set<string>(),
  recordToldAbout: async () => undefined,
}))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { listFollowerIdsForPlayerIdentity } from '@/lib/follows/playerFollows'
import { resolveNewsPlayerBinding } from '@/lib/notifications/newsPlayerBinding'

const story = (id: string, playerName: string, team: string | null, headline: string) => ({
  id, sport: 'NFL', playerName, team, headline, body: null, impact: 'high',
})
const roster = (ownerId: string, playerId: string, playerName: string, team: string): RosterRow => ({
  playerId, playerName, team, sport: 'NFL', roster: { ownerId, leagueId: `lg-${ownerId}` },
})
const calls = () => h.dispatch.mock.calls.map((c) => c[0] as { userIds: string[]; category: string; meta: Record<string, unknown> })
const told = () => calls().flatMap((p) => p.userIds)
const toldUnder = (category: string) => calls().filter((p) => p.category === category).flatMap((p) => p.userIds)

const TEAM_FANS: Record<string, string[]> = {
  ATL: ['falcons-fan'], CIN: ['bengals-fan'], MIA: ['dolphins-fan'], BUF: ['bills-fan'], JAX: ['jaguars-fan'], TEN: ['titans-fan'], GB: ['packers-fan'],
}

beforeEach(() => {
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
  // The real resolver maps a team string onto a followable team; for these clubs that is the code.
  h.resolveNewsTeam.mockReset()
  h.resolveNewsTeam.mockImplementation(async (_s: string, team: string | null) => (team && TEAM_FANS[team.trim().toUpperCase()] ? team.trim().toUpperCase() : null))
  h.teamFollowers.mockReset()
  h.teamFollowers.mockImplementation(async (_s: string, abbr: string) => TEAM_FANS[abbr] ?? [])
  h.follows = []
  h.roster = [
    roster('chase-mgr', '7564', "Ja'Marr Chase", 'CIN'),
    roster('allen-qb-mgr', '4984', 'Josh Allen', 'BUF'),
    roster('allen-dl-mgr', '5840', 'Josh Allen', 'JAX'),
  ]
})

describe('a story tagged with the OPPONENT', () => {
  it("🛑 Chase tagged MIA still reaches Chase's rostered managers", async () => {
    h.news = [story('n-chase', "Ja'Marr Chase", 'MIA', 'Burrow throws 4 TDs, Chase scores twice as Bengals beat Dolphins')]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('injury_alerts')).toEqual(['chase-mgr'])
  })

  it('🛑 …goes to BENGALS followers, and never to Dolphins followers', async () => {
    h.news = [story('n-chase', "Ja'Marr Chase", 'MIA', 'Burrow throws 4 TDs, Chase scores twice as Bengals beat Dolphins')]
    await dispatchPendingPlayerNewsNotifications()
    expect(h.teamFollowers).toHaveBeenCalledWith('NFL', 'CIN')
    expect(h.teamFollowers).not.toHaveBeenCalledWith('NFL', 'MIA')
    expect(told()).not.toContain('dolphins-fan')
    expect(toldUnder('followed_teams')).toEqual(['bengals-fan'])
  })

  it("the alert's own team is the player's, not the tag", async () => {
    h.news = [story('n-chase', "Ja'Marr Chase", 'MIA', 'Chase (ankle) limited Wednesday')]
    await dispatchPendingPlayerNewsNotifications()
    expect(calls().length).toBeGreaterThan(0)
    for (const p of calls()) expect(p.meta.team).toBe('CIN')
  })
})

describe('a name that is two players', () => {
  it('🛑 tagged with neither of their teams: nobody is told, and it is not team-routed', async () => {
    h.news = [story('n-allen', 'Josh Allen', 'MIA', 'Allen sacked four times as Dolphins hold on')]
    h.follows = [{ user_id: 'qb-fan', sleeper_id: '4984', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills' }]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.teamFollowers).not.toHaveBeenCalled()
    expect(out).toMatchObject({ unboundPlayer: 1, notified: 0 })
  })

  it('🛑 untagged: neither namesake\'s managers are told', async () => {
    h.news = [story('n-allen', 'Josh Allen', null, 'Allen (ankle) questionable for Sunday')]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(told()).not.toContain('allen-qb-mgr')
    expect(told()).not.toContain('allen-dl-mgr')
    expect(out.unboundPlayer).toBe(1)
  })

  it("tagged with ONE of their teams: that player's managers only — and still not team-routed", async () => {
    h.news = [story('n-allen', 'Josh Allen', 'JAX', "Jaguars' Josh Allen (knee) ruled out")]
    h.roster.push(
      // An ESPN-id roster of the QB: only his club tells him apart from the DL.
      roster('allen-qb-mgr-espn', '3918298', 'Josh Allen', 'BUF'),
      // The QB's own Sleeper id under a stale club: only the id tells him apart.
      roster('allen-qb-mgr-stale', '4984', 'Josh Allen', 'JAX'),
    )
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('injury_alerts')).toEqual(['allen-dl-mgr'])
    expect(h.teamFollowers).not.toHaveBeenCalled()
  })
})

describe('a player the registry holds twice', () => {
  it('🛑 is one player, not two namesakes: his managers and his team hear an opponent-tagged story', async () => {
    h.roster.push(roster('penix-mgr', '11559', 'Michael Penix Jr.', 'ATL'))
    h.news = [story('n-penix', 'Michael Penix Jr.', 'TB', 'Penix throws three picks as Buccaneers rout Falcons')]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('injury_alerts')).toEqual(['penix-mgr'])
    expect(toldUnder('followed_teams')).toEqual(['falcons-fan'])
    expect(out.unboundPlayer).toBe(0)
  })
})

describe('a spelling the registry does not hold', () => {
  it('"Cam Ward" binds to Cameron Ward through the rosters\' Sleeper id — his managers and team are told', async () => {
    h.roster.push(roster('ward-mgr', '12522', 'Cam Ward', 'TEN'))
    h.news = [story('n-ward', 'Cam Ward', 'HOU', 'Cam Ward (shoulder) limited as Titans prep for Texans')]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('injury_alerts')).toEqual(['ward-mgr'])
    expect(toldUnder('followed_teams')).toEqual(['titans-fan'])
  })

  it("🛑 a roster id from another namespace never binds a story to an unrelated player", async () => {
    // Production: a rostered "Derrick Henry" carries 12042, which is Keith Randolph Jr.'s Sleeper id.
    h.roster.push(roster('henry-mgr', '12042', 'Derrick Henry', 'BAL'))
    h.news = [story('n-henry', 'Derrick Henry', 'BAL', 'Derrick Henry (ankle) questionable')]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(told()).not.toContain('packers-fan')
    expect(out.unboundPlayer).toBe(1)
  })
})

describe('🛑 a follow is keyed on the Sleeper id, not the name', () => {
  it("a QB Josh Allen follow (sleeper 4984) is NOT told the Jaguars DL's news", async () => {
    h.follows = [{ user_id: 'qb-fan', sleeper_id: '4984', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills' }]
    h.news = [story('n-dl', 'Josh Allen', 'JAX', "Jaguars' Josh Allen (knee) ruled out")]
    await dispatchPendingPlayerNewsNotifications()
    expect(told()).not.toContain('qb-fan')
  })

  it("…and IS told the QB's news", async () => {
    h.follows = [{ user_id: 'qb-fan', sleeper_id: '4984', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills' }]
    h.news = [story('n-qb', 'Josh Allen', 'BUF', 'Bills QB Josh Allen (hand) ruled out for Sunday')]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_players')).toEqual(['qb-fan'])
  })
})

describe('listFollowerIdsForPlayerIdentity', () => {
  async function bound(team: string) {
    const b = await resolveNewsPlayerBinding('NFL', 'Josh Allen', team)
    if (b.kind !== 'resolved') throw new Error(`expected a binding, got ${b.kind}`)
    return b
  }

  it('🛑 a follow carrying another player\'s Sleeper id is never this player, whatever its name', async () => {
    h.follows = [
      { user_id: 'qb-fan', sleeper_id: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF' },
      { user_id: 'dl-fan', sleeper_id: '5840', name: 'Josh Allen', position: 'DL', team: 'JAX' },
      // The QB's id under a snapshot that would verify as the DL by name — the id must win.
      { user_id: 'stale-qb-fan', sleeper_id: '4984', name: 'Josh Allen', position: null, team: 'Jacksonville Jaguars' },
    ]
    const dl = await bound('JAX')
    expect(await listFollowerIdsForPlayerIdentity('NFL', { identity: dl.identity, candidates: dl.candidates })).toEqual(['dl-fan'])
    const qb = await bound('BUF')
    expect(await listFollowerIdsForPlayerIdentity('NFL', { identity: qb.identity, candidates: qb.candidates })).toEqual(['qb-fan', 'stale-qb-fan'])
  })

  it('🛑 a name-only follow is resolved by its own snapshot, and refused when that is ambiguous', async () => {
    h.follows = [
      { user_id: 'named-qb-fan', sleeper_id: null, name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills' },
      { user_id: 'named-unknown-fan', sleeper_id: null, name: 'Josh Allen', position: null, team: null },
    ]
    const qb = await bound('BUF')
    expect(await listFollowerIdsForPlayerIdentity('NFL', { identity: qb.identity, candidates: qb.candidates })).toEqual(['named-qb-fan'])
    const dl = await bound('JAX')
    expect(await listFollowerIdsForPlayerIdentity('NFL', { identity: dl.identity, candidates: dl.candidates })).toEqual([])
  })
})
