import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  leagues: vi.fn(),
  platforms: vi.fn(),
  team: vi.fn(),
  identities: vi.fn(),
  injuries: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.platforms } } }))
vi.mock('@/lib/chimmy/tools/leagueByName', () => ({ listMemberLeagues: h.leagues }))
vi.mock('@/lib/ai-payload/resolveAiTeamContext', () => ({ resolveAiTeamContext: h.team }))
vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({
  resolveRosterPlayerIdentities: h.identities,
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injuries }))

import { buildMyRosterInjuriesContext } from '@/lib/chimmy/tools/myRosterInjuriesTool'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

const NOW = Date.now()
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000)

function ref(playerId: string, name: string | null, extra: Record<string, unknown> = {}) {
  return { playerId, name, position: 'RB', team: 'KC', injuryStatus: null, ...extra }
}

function team(parts: { starters?: unknown[]; bench?: unknown[]; injuredReserve?: unknown[]; taxi?: unknown[] }) {
  return { starters: [], bench: [], injuredReserve: [], taxi: [], ...parts }
}

function fact(status: string, hours: number, extra: Record<string, unknown> = {}) {
  return {
    playerName: 'x',
    status,
    type: null,
    description: null,
    date: hoursAgo(hours),
    week: null,
    source: 'rolling_insights',
    fetchedAt: hoursAgo(1),
    reportedAt: hoursAgo(hours),
    ageHours: hours,
    fetchAgeHours: 1,
    stale: hours > 36,
    ...extra,
  }
}

function injuryResult(byName: Record<string, ReturnType<typeof fact>>, extra: Record<string, unknown> = {}) {
  return {
    byPlayer: new Map(Object.entries(byName).map(([n, f]) => [normalizeMatchName(n), f])),
    ambiguous: [],
    newestFetchedAt: hoursAgo(1),
    feedStale: false,
    coverage: { sourceAvailable: true, reason: null },
    ...extra,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.platforms.mockResolvedValue([
    { id: 'L1', platform: 'sleeper' },
    { id: 'L2', platform: 'espn' },
  ])
  h.identities.mockResolvedValue(new Map())
  h.injuries.mockResolvedValue(injuryResult({}))
})

describe('buildMyRosterInjuriesContext', () => {
  it('reads only the authorized selected roster and treats Best Ball injuries as depth concerns', async () => {
    h.leagues.mockResolvedValue([
      { id: 'L1', name: 'Best Ball dynasty', sport: 'NFL', season: 2026 },
      { id: 'L2', name: 'Another league', sport: 'NFL', season: 2026 },
    ])
    h.platforms.mockResolvedValue([{ id: 'L1', platform: 'sleeper', leagueType: 'dynasty', settings: { best_ball: 1 } }])
    h.team.mockResolvedValue(team({ starters: [ref('1', 'Omar Cooper', { position: 'WR', team: 'NYJ' }), ref('0', null, { position: null })] }))
    h.injuries.mockResolvedValue(injuryResult({ 'Omar Cooper': fact('IR', 4) }))
    const result = await buildMyRosterInjuriesContext({ userId: 'u1', leagueId: 'L1' })
    expect(h.team).toHaveBeenCalledTimes(1)
    expect(h.team.mock.calls[0][0].leagueId).toBe('L1')
    expect(result).toContain('SELECTED-LEAGUE INJURY CHECK')
    expect(h.identities).not.toHaveBeenCalled()
    expect(result).not.toContain('could not be identified by name')
    expect(result).toContain('Omar Cooper WR NYJ: IR')
    expect(result).toContain('AUTOMATIC BEST BALL LINEUP')
    expect(result).toContain('not requests for manual starter swaps')
    expect(result).not.toContain('ROSTER PLACEMENT:')
    expect(result).not.toContain('Another league')
  })
  it('does not read an unlisted selected league or substitute another roster', async () => {
    h.leagues.mockResolvedValue([{ id: 'L1', name: 'My league', sport: 'NFL', season: 2026 }])
    const result = await buildMyRosterInjuriesContext({ userId: 'u1', leagueId: 'private-league' })
    expect(result).toContain('No authorized current-season roster')
    expect(h.team).not.toHaveBeenCalled()
    expect(h.injuries).not.toHaveBeenCalled()
  })
  it('refuses without a signed-in user', async () => {
    const out = await buildMyRosterInjuriesContext({ userId: '' })
    expect(out).toMatch(/cannot tell who is signed in/)
    expect(h.leagues).not.toHaveBeenCalled()
  })

  it('says "no leagues", never "nobody is hurt", when there are none', async () => {
    h.leagues.mockResolvedValue([])
    const out = await buildMyRosterInjuriesContext({ userId: 'u1' })
    expect(out).toMatch(/NO leagues on file/)
    expect(out).toMatch(/not a claim that nobody is hurt/)
  })

  /*
   * The core case the audit found broken: a player on a Sleeper roster AND an ESPN roster.
   * The ESPN ids are unnamed by the roster reader (it only speaks Sleeper), so the any-platform
   * resolver has to name them — or the ESPN league silently reports nobody hurt.
   */
  it('names non-Sleeper rosters, groups a player across leagues, and flags an Out STARTER', async () => {
    h.leagues.mockResolvedValue([
      { id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026 },
      { id: 'L2', name: 'Work League', sport: 'NFL', season: 2026 },
    ])
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) =>
      leagueId === 'L1'
        ? team({ starters: [ref('4034', 'Christian McCaffrey')], bench: [ref('6794', 'Justin Jefferson', { position: 'WR', team: 'MIN' })] })
        : team({ starters: [ref('3916387', null)] }),
    )
    h.identities.mockResolvedValue(
      new Map([['3916387', { name: 'Christian McCaffrey', position: 'RB', team: 'SF' }]]),
    )
    h.injuries.mockResolvedValue(
      injuryResult({
        'Christian McCaffrey': fact('Out', 4, { type: 'Achilles' }),
        'Justin Jefferson': fact('Questionable', 24 * 5),
      }),
    )

    const out = await buildMyRosterInjuriesContext({ userId: 'u1' })

    expect(h.identities).toHaveBeenCalledWith('espn', 'NFL', ['3916387'])
    const lines = out.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(2)
    expect(out).toContain('CURRENT INJURY COUNTS: 2 distinct players')
    expect(out).toContain('RB: 1; WR: 1')
    /* The mocked prisma has no sportsGame, so the schedule read fails: unverified, never "not started". */
    expect(out).toContain('does not verify provider lock timing')
    expect(out).toContain('Christian McCaffrey (KBFL, Work League) — KICKOFF UNVERIFIED')
    expect(out).not.toContain('— NOT STARTED')
    expect(out).toContain('Stored starter placement is not proof a replacement is still allowed')
    expect(out).not.toContain('Lead with these')
    /* Most serious first, and one line for McCaffrey even though he is on two rosters. */
    expect(lines[0]).toContain('Christian McCaffrey')
    expect(lines[0]).toContain('Out')
    expect(lines[0]).toContain('KBFL (STARTING)')
    expect(lines[0]).toContain('Work League (STARTING)')
    expect(lines[0]).toMatch(/reported \d{4}-\d{2}-\d{2}\]/)
    expect(lines[1]).toContain('Justin Jefferson')
    expect(lines[1]).toContain('MAY BE OUT OF DATE')
    expect(out).toMatch(/ROSTER PLACEMENT: 1 player\(s\) listed Out\/IR are among stored STARTERS: Christian McCaffrey \(KBFL, Work League\)/)
    /* One injury lookup per distinct player, not per roster spot. */
    expect(h.injuries.mock.calls[0][0].players).toHaveLength(2)
  })

  it('reads the current season only', async () => {
    h.leagues.mockResolvedValue([
      { id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026 },
      { id: 'OLD', name: 'KBFL', sport: 'NFL', season: 2025 },
    ])
    h.team.mockResolvedValue(team({ starters: [ref('1', 'Somebody')] }))
    await buildMyRosterInjuriesContext({ userId: 'u1' })
    expect(h.team).toHaveBeenCalledTimes(1)
    expect(h.team.mock.calls[0][0].leagueId).toBe('L1')
  })

  it('keeps an undated Sleeper feed status rather than dropping a real Out, and says it is undated', async () => {
    h.leagues.mockResolvedValue([{ id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026 }])
    h.team.mockResolvedValue(team({ bench: [ref('9', 'Nick Chubb', { injuryStatus: 'Out' })] }))
    const out = await buildMyRosterInjuriesContext({ userId: 'u1' })
    expect(out).toContain('Nick Chubb')
    expect(out).toContain('Sleeper player feed, undated')
  })

  it('reports every gap that could hide an injury', async () => {
    h.leagues.mockResolvedValue([
      { id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026 },
      { id: 'L2', name: 'Unclaimed', sport: 'NFL', season: 2026 },
      { id: 'L3', name: 'Cream Bowl', sport: 'NCAAF', season: 2026 },
    ])
    h.team.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
      if (leagueId === 'L2') return null
      if (leagueId === 'L3') return team({ starters: [ref('c1', 'Arch Manning', { position: 'QB', team: 'TEX' })] })
      return team({ starters: [ref('1', 'Josh Allen', { position: 'QB', team: 'BUF' }), ref('2', null)] })
    })
    h.injuries.mockImplementation(async ({ sport }: { sport: string }) =>
      sport === 'NCAAF'
        ? injuryResult({}, { coverage: { sourceAvailable: false, reason: 'No live college injury source.' } })
        : injuryResult({}, { ambiguous: ['Josh Allen'], feedStale: true, newestFetchedAt: hoursAgo(72) }),
    )

    const out = await buildMyRosterInjuriesContext({ userId: 'u1' })

    expect(out).toMatch(/1 league\(s\) have no claimed or synced team.*Unclaimed.*NOT a finding that those rosters are healthy/)
    expect(out).toMatch(/1 rostered player\(s\) could not be identified by name/)
    expect(out).toMatch(/REFUSED rather than guessed \(Josh Allen\)/)
    expect(out).toMatch(/no injury source exists for: NCAAF: No live college injury source/)
    expect(out).toMatch(/injury feed is behind for NFL/)
    expect(out).toMatch(/the true list can only be LONGER/)
  })

  it('says "no reported injuries", not "healthy", when nothing is found', async () => {
    h.leagues.mockResolvedValue([{ id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026 }])
    h.team.mockResolvedValue(team({ starters: [ref('1', 'Somebody')] }))
    const out = await buildMyRosterInjuriesContext({ userId: 'u1' })
    expect(out).toMatch(/no reported injuries/)
    expect(out).toMatch(/NOT "everyone is healthy"/)
    expect(out).not.toMatch(/^- /m)
  })

  it('limits to one sport when asked', async () => {
    h.leagues.mockResolvedValue([
      { id: 'L1', name: 'KBFL', sport: 'NFL', season: 2026 },
      { id: 'L9', name: 'Hoops', sport: 'NBA', season: 2026 },
    ])
    h.team.mockResolvedValue(team({ starters: [ref('1', 'Somebody')] }))
    await buildMyRosterInjuriesContext({ userId: 'u1', sport: 'nba' })
    expect(h.team).toHaveBeenCalledTimes(1)
    expect(h.team.mock.calls[0][0].leagueId).toBe('L9')
  })
})

it('reports two injured tight ends among six designations rather than repeating old depth counts', async () => {
  h.leagues.mockResolvedValue([{ id: 'L1', name: 'Best Ball', sport: 'NFL', season: 2026 }])
  h.platforms.mockResolvedValue([{ id: 'L1', platform: 'sleeper', settings: { best_ball: 1 } }])
  const designated = [['Caleb Williams','QB'],['DJ Giddens','RB'],['Jeremy McNichols','RB'],['Omar Cooper','WR'],['Dallas Goedert','TE'],['Mason Taylor','TE']] as const
  h.team.mockResolvedValue(team({ bench: designated.map(([name, position], i) => ref(String(i + 1), name, { position })) }))
  h.injuries.mockResolvedValue(injuryResult(Object.fromEntries(designated.map(([name]) => [name, fact('Out', 4)]))))
  const out = await buildMyRosterInjuriesContext({ userId: 'u1', leagueId: 'L1' })
  expect(out).toContain('CURRENT INJURY COUNTS: 6 distinct players')
  expect(out).toContain('QB: 1; RB: 2; TE: 2; WR: 1')
  expect(out).toContain('No report does not mean healthy or available')
  expect(h.injuries).toHaveBeenCalledTimes(1)
})
it('excludes roster activity states from both injury facts and feed fallback while retaining a real IR', async () => {
  h.leagues.mockResolvedValue([{ id: 'L1', name: 'My league', sport: 'NFL', season: 2026 }])
  const tokens = ['ACT', 'INACT', 'Active', 'NA']
  const entries = tokens.flatMap((status) => [ref(`feed-${status}`, `Feed ${status}`, { injuryStatus: status }), ref(`canonical-${status}`, `Canonical ${status}`)])
  h.team.mockResolvedValue(team({ bench: [...entries, ref('real-ir', 'Real Injury', { injuryStatus: 'IR' })] }))
  h.injuries.mockResolvedValue(injuryResult(Object.fromEntries(tokens.map((status) => [`Canonical ${status}`, fact(status, 4)]))))
  const out = await buildMyRosterInjuriesContext({ userId: 'u1', leagueId: 'L1' })
  expect(out).toContain('CURRENT INJURY COUNTS: 1 distinct players')
  const findings = out.split('\n').filter((line) => line.startsWith('- '))
  expect(findings).toHaveLength(1)
  expect(findings[0]).toContain('Real Injury RB KC: IR')
})
