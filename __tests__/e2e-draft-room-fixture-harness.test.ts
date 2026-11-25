// @vitest-environment node
/**
 * /e2e/draft-room-fixture renders the real live draft room from SAMPLE data with no database.
 * It must never serve in production, and its fixture must describe a coherent room.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/security/requestNonce', () => ({ getRequestNonce: async () => 'test-nonce' }))
// The room itself is a 5,000-line client tree; this test is about the page, not the room.
vi.mock('@/app/e2e/draft-room-fixture/DraftRoomFixtureHarnessClient', () => ({ default: () => null }))

import DraftRoomFixturePage from '@/app/e2e/draft-room-fixture/page'
import {
  FIXTURE_LEAGUE_ID,
  buildFixtureSnapshot,
  fixtureApiResponses,
  fixturePoolEntries,
} from '@/app/e2e/draft-room-fixture/fixtures'

afterEach(() => vi.unstubAllEnvs())

type El = { type: unknown; props: Record<string, unknown> }
const childrenOf = (el: unknown) => (el as El).props.children as El[]

describe('/e2e/draft-room-fixture', () => {
  it('404s in a production build (its own guard, beside app/e2e/layout.tsx)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(DraftRoomFixturePage()).rejects.toThrow()
  })

  it('in development, emits the nonce-carrying fetch stub BEFORE the room', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const [script, room] = childrenOf(await DraftRoomFixturePage())
    expect(script.type).toBe('script')
    expect(script.props.nonce).toBe('test-nonce')
    const code = (script.props.dangerouslySetInnerHTML as { __html: string }).__html
    expect(code).toContain(`/api/leagues/${FIXTURE_LEAGUE_ID}/`)
    // Unknown same-origin API calls are refused rather than passed to a route that reads the DB.
    expect(code).toContain('status: 404')
    const snap = room.props.initialSnapshot as ReturnType<typeof buildFixtureSnapshot>
    expect(snap.leagueId).toBe(FIXTURE_LEAGUE_ID)
  })

  it('puts the viewer on the clock at 2.04, after 13 made picks, with snake order respected', () => {
    const snap = buildFixtureSnapshot(Date.UTC(2026, 8, 1))
    expect(snap.picks).toHaveLength(13)
    expect(snap.currentPick?.pickLabel).toBe('2.04')
    expect(snap.currentPick?.rosterId).toBe(snap.currentUserRosterId)
    // Round 2 runs backwards: 2.01 belongs to the team that picked 1.10.
    const p = (label: string) => snap.picks.find((x) => x.pickLabel === label)!
    expect(p('2.01').rosterId).toBe(p('1.10').rosterId)
    // Nobody drafted is still in the pool.
    const drafted = new Set(snap.picks.map((x) => x.playerName))
    expect(fixturePoolEntries().some((e) => drafted.has(e.name))).toBe(false)
  })

  it('answers the session endpoint with the same snapshot it seeds', () => {
    const fx = fixtureApiResponses(Date.UTC(2026, 8, 1))
    expect((fx.league['draft/session'] as { session: unknown }).session).toEqual(fx.snapshot)
  })
})
