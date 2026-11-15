// @vitest-environment node
/**
 * The pasted-league route and the two gates it has to get through — the import routes' provider
 * gate and the commissioner gate. Real handlers, real store logic, an in-memory cache table, and the
 * AI extraction stubbed (its parsing is covered in yahoo-snapshot-model.test.ts).
 *
 * What must hold:
 *   - only allowlisted users can use any of it, and a refused request never reaches the AI;
 *   - snapshots are per user: one user's `yahoo-snapshot:<id>` is invisible to another;
 *   - the import routes let a SNAPSHOT through, never a Yahoo API league;
 *   - a full import of a pasted league requires the commissioner's recorded confirmation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  store: new Map<string, { data: unknown; expiresAt: Date }>(),
  requireVerifiedUser: vi.fn(),
  extract: vi.fn(),
  assertGate: vi.fn(),
}))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => <T>(handler: T) => handler }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) => h.store.get(where.cacheKey) ?? null,
      upsert: async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        h.store.set(where.cacheKey, { data: JSON.parse(JSON.stringify(create.data)), expiresAt: create.expiresAt })
      },
      deleteMany: async ({ where }: { where: { cacheKey: string } }) => {
        h.store.delete(where.cacheKey)
      },
    },
  },
}))
vi.mock('@/lib/league-import/yahoo/snapshot/extractYahooSnapshotPage', async (orig) => ({
  ...(await orig<typeof import('@/lib/league-import/yahoo/snapshot/extractYahooSnapshotPage')>()),
  extractYahooSnapshotPage: h.extract,
}))

const OWNER = 'aaaaaaaa-0000-4000-8000-00000000beef'
const OTHER = 'bbbbbbbb-0000-4000-8000-00000000cafe'
const LEAGUE_URL = 'https://football.fantasysports.yahoo.com/f1/987654'
const ENDPOINT = 'http://localhost:3000/api/leagues/import/yahoo-snapshot'

const settingsPage = {
  kind: 'settings',
  leagueName: 'Sunday Funday',
  numTeams: 2,
  rosterPositions: [{ position: 'QB', count: 1 }],
  scoring: [{ group: 'offense', name: 'Passing Yards', points: 0.04 }],
}
const standingsPage = {
  kind: 'standings',
  teams: [
    { rank: 1, teamName: 'Turf Toe', wins: 1, losses: 0 },
    { rank: 2, teamName: 'Punt Club', wins: 0, losses: 1 },
  ],
}

function signedIn(userId: string) {
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId, profile: {} })
}

function postPage(fields: Record<string, string | File>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return createMockNextRequest(ENDPOINT, { method: 'POST', body: form })
}

async function route() {
  return import('@/app/api/leagues/import/yahoo-snapshot/route')
}

let savedEnv: string | undefined
beforeEach(() => {
  savedEnv = process.env.YAHOO_PREVIEW_USER_IDS
  process.env.YAHOO_PREVIEW_USER_IDS = `${OWNER},${OTHER}`
  delete process.env.YAHOO_SNAPSHOT_IMPORT_OPEN
  h.store.clear()
  h.requireVerifiedUser.mockReset()
  h.extract.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.YAHOO_PREVIEW_USER_IDS
  else process.env.YAHOO_PREVIEW_USER_IDS = savedEnv
  vi.restoreAllMocks()
})

describe('who may use it', () => {
  it('tells a user outside the rollout it is off, with a 200 so the panel just hides', async () => {
    signedIn('cccccccc-0000-4000-8000-000000000000')
    const { GET } = await route()
    const res = await GET(createMockNextRequest(`${ENDPOINT}?league=${encodeURIComponent(LEAGUE_URL)}`) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('refuses a POST from outside the rollout without spending an AI call', async () => {
    signedIn('cccccccc-0000-4000-8000-000000000000')
    const { POST } = await route()
    const res = await POST(postPage({ league: LEAGUE_URL, text: 'League Settings ...' }) as never)
    expect(res.status).toBe(403)
    expect(h.extract).not.toHaveBeenCalled()
  })

  it('YAHOO_SNAPSHOT_IMPORT_OPEN=1 opens it to any signed-in user', async () => {
    process.env.YAHOO_SNAPSHOT_IMPORT_OPEN = '1'
    signedIn('cccccccc-0000-4000-8000-000000000000')
    const { GET } = await route()
    expect(await (await GET(createMockNextRequest(ENDPOINT) as never)).json()).toEqual({ enabled: true })
  })
})

describe('building a snapshot', () => {
  it('folds pages in until the checklist is ready', async () => {
    signedIn(OWNER)
    const { GET, POST } = await route()

    const first = await GET(createMockNextRequest(`${ENDPOINT}?league=${encodeURIComponent(LEAGUE_URL)}`) as never)
    const firstBody = await first.json()
    expect(firstBody.sourceId).toBe('yahoo-snapshot:987654')
    expect(firstBody.checklist.ready).toBe(false)

    h.extract.mockResolvedValueOnce({ status: 'ok', page: settingsPage })
    const a = await (await POST(postPage({ league: LEAGUE_URL, text: 'settings page text' }) as never)).json()
    expect(a.page).toBe('settings')
    expect(a.checklist.missing).toEqual(['Standings'])

    h.extract.mockResolvedValueOnce({ status: 'ok', page: standingsPage })
    const b = await (await POST(postPage({ league: '987654', text: 'standings page text' }) as never)).json()
    expect(b.checklist.ready).toBe(true)
    expect(b.checklist.teams.map((t: { name: string }) => t.name)).toEqual(['Turf Toe', 'Punt Club'])
    expect(h.extract).toHaveBeenCalledWith({ text: 'standings page text' })
  })

  it('keeps one user\'s snapshot invisible to another', async () => {
    signedIn(OWNER)
    const { GET, POST } = await route()
    h.extract.mockResolvedValueOnce({ status: 'ok', page: settingsPage })
    await POST(postPage({ league: LEAGUE_URL, text: 'x' }) as never)

    signedIn(OTHER)
    const other = await (await GET(createMockNextRequest(`${ENDPOINT}?league=987654`) as never)).json()
    expect(other.checklist.settings).toBe(false)
    expect([...h.store.keys()]).toEqual([`yahoo-snapshot:v1:${OWNER}:987654`])
  })

  it('DELETE starts over', async () => {
    signedIn(OWNER)
    const { POST, DELETE } = await route()
    h.extract.mockResolvedValueOnce({ status: 'ok', page: settingsPage })
    await POST(postPage({ league: LEAGUE_URL, text: 'x' }) as never)
    expect(h.store.size).toBe(1)
    await DELETE(createMockNextRequest(`${ENDPOINT}?league=987654`, { method: 'DELETE' }) as never)
    expect(h.store.size).toBe(0)
  })

  it.each([
    [{ league: 'https://basketball.fantasysports.yahoo.com/nba/1', text: 'x' }, 400],
    [{ league: LEAGUE_URL }, 400],
    [{ league: LEAGUE_URL, text: 'x'.repeat(200_001) }, 413],
  ])('rejects a bad request before any AI call (%#)', async (fields, status) => {
    signedIn(OWNER)
    const { POST } = await route()
    const res = await POST(postPage(fields as Record<string, string>) as never)
    expect(res.status).toBe(status)
    expect(h.extract).not.toHaveBeenCalled()
  })

  it('refuses a screenshot that is not an image', async () => {
    signedIn(OWNER)
    const { POST } = await route()
    const file = new File(['%PDF-1.7'], 'page.pdf', { type: 'application/pdf' })
    const res = await POST(postPage({ league: LEAGUE_URL, image: file }) as never)
    expect(res.status).toBe(415)
    expect(h.extract).not.toHaveBeenCalled()
  })

  it.each([
    [{ status: 'unrecognized', reason: 'This is the matchup page.' }, 422, /matchup page/],
    [{ status: 'invalid' }, 422, /Ctrl\+A/],
    [{ status: 'unavailable' }, 503, /unavailable/],
  ])('explains an unusable read and stores nothing (%#)', async (result, status, message) => {
    signedIn(OWNER)
    const { POST } = await route()
    h.extract.mockResolvedValueOnce(result)
    const res = await POST(postPage({ league: LEAGUE_URL, text: 'x' }) as never)
    expect(res.status).toBe(status)
    expect((await res.json()).error).toMatch(message)
    expect(h.store.size).toBe(0)
  })
})

describe('the import routes let a snapshot through — and only a snapshot', () => {
  beforeEach(() => {
    vi.doMock('@/lib/league-import/commissionerGate', () => ({
      // Reaching the commissioner gate at all proves the provider gate let the request through.
      assertImportCommissioner: h.assertGate.mockResolvedValue({ ok: false, reason: 'REACHED_COMMISSIONER_GATE' }),
      attestationFromRequestBody: () => undefined,
      gateAllowsCommissionerConfirm: () => false,
    }))
  })
  afterEach(() => {
    vi.doUnmock('@/lib/league-import/commissionerGate')
  })

  async function preview(sourceId: string) {
    vi.resetModules()
    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      createMockNextRequest('http://localhost:3000/api/leagues/import/preview', {
        method: 'POST',
        body: { provider: 'yahoo', sourceId },
      }) as never,
    )
    return { status: res.status, body: await res.json() }
  }

  it('an allowlisted user\'s snapshot reaches the commissioner gate', async () => {
    signedIn(OWNER)
    const r = await preview('yahoo-snapshot:987654')
    expect(r.body.error).toBe('REACHED_COMMISSIONER_GATE')
  })

  it('a Yahoo API league is still refused as coming soon, even for that user', async () => {
    signedIn(OWNER)
    const r = await preview('nfl.l.987654')
    expect(r.body.code).toBe('coming_soon')
  })

  it('a snapshot from a user outside the rollout is refused as coming soon', async () => {
    signedIn('cccccccc-0000-4000-8000-000000000000')
    const r = await preview('yahoo-snapshot:987654')
    expect(r.body.code).toBe('coming_soon')
  })
})

describe('commissioner gate for a pasted league', () => {
  async function gate() {
    vi.resetModules()
    vi.doMock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn() }))
    return import('@/lib/league-import/commissionerGate')
  }

  async function seed(userId: string) {
    const { saveYahooSnapshot } = await import('@/lib/league-import/yahoo/snapshot/yahooSnapshotStore')
    const { emptyYahooSnapshot } = await import('@/lib/league-import/yahoo/snapshot/yahooSnapshotTypes')
    await saveYahooSnapshot(userId, { ...emptyYahooSnapshot('987654'), settings: settingsPage as never })
  }

  it('lets the paster preview, but a full import needs their confirmation', async () => {
    await seed(OWNER)
    const { assertImportCommissioner } = await gate()
    const args = { appUserId: OWNER, provider: 'yahoo' as const, sourceLeagueId: 'yahoo-snapshot:987654' }

    expect((await assertImportCommissioner(args)).ok).toBe(true)

    const unconfirmed = await assertImportCommissioner({ ...args, requireCommissioner: true })
    expect(unconfirmed).toMatchObject({ ok: false, requiresAttestation: true })

    const confirmed = await assertImportCommissioner({
      ...args,
      requireCommissioner: true,
      attestation: { accepted: true, confirmedProvider: 'yahoo', confirmedSourceLeagueId: 'yahoo-snapshot:987654' },
    })
    expect(confirmed).toMatchObject({ ok: true, verification: 'attestation' })
  })

  it('refuses a confirmation made for a different league', async () => {
    await seed(OWNER)
    const { assertImportCommissioner } = await gate()
    const r = await assertImportCommissioner({
      appUserId: OWNER,
      provider: 'yahoo',
      sourceLeagueId: 'yahoo-snapshot:987654',
      requireCommissioner: true,
      attestation: { accepted: true, confirmedProvider: 'yahoo', confirmedSourceLeagueId: 'yahoo-snapshot:111' },
    })
    expect(r.ok).toBe(false)
  })

  it('another user\'s snapshot id is simply not found', async () => {
    await seed(OWNER)
    const { assertImportCommissioner } = await gate()
    const r = await assertImportCommissioner({ appUserId: OTHER, provider: 'yahoo', sourceLeagueId: 'yahoo-snapshot:987654' })
    expect(r).toMatchObject({ ok: false, notFound: true })
  })
})
