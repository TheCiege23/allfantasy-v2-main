import { beforeEach, describe, expect, it, vi } from 'vitest'

/** GET lists NBA/NHL/MLB dynasty format presets; PUT `{ sportPresetId }` applies one and nothing else. */
const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  apply: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    dynastyLeagueConfig: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(async () => null),
  getDynastyRosterPresets: vi.fn(() => [{ id: 'dynasty_1qb' }]),
  getDynastyScoringPresets: vi.fn(() => [{ id: 'dynasty_standard' }]),
  getDynastyPlayoffPresets: vi.fn(() => []),
  upsertDynastyConfig: m.upsert,
  getDraftOrderAuditLog: vi.fn(async () => []),
  ROOKIE_PICK_ORDER_METHODS: [],
}))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({ checkDynastyLotteryEligibility: vi.fn(async () => ({ eligible: false })) }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn(async () => null),
  setDraftOrderModeAndLotteryConfig: vi.fn(),
}))
vi.mock('@/lib/dynasty-core/applyDynastySportPreset', async (orig) => ({
  ...(await orig<typeof import('@/lib/dynasty-core/applyDynastySportPreset')>()),
  applyDynastySportPresetToLeague: m.apply,
}))

import { GET, PUT } from '@/app/api/leagues/[leagueId]/dynasty-settings/handler'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const get = () => GET(new Request('http://x') as any, ctx)
const put = (body: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) as any, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  m.apply.mockResolvedValue({ ok: true, presetId: 'nba_dynasty_points_deep', slots: { BN: 12 } })
})

describe('dynasty-settings — sport format presets', () => {
  it('GET lists the NBA formats, marks them editable before the draft, and still hides football ones', async () => {
    m.leagueFindUnique.mockResolvedValue({ sport: 'NBA', isDynasty: true, leagueVariant: null, status: null, lifecycleState: 'setup', settings: { dynasty_sport_preset_id: 'nba_dynasty_points_taxi' } })
    const json = await (await get()).json()
    expect(json.presets.sportFormats.map((p: { id: string }) => p.id)).toEqual(['nba_dynasty_points_taxi', 'nba_dynasty_points_compact', 'nba_dynasty_points_deep'])
    expect(json.presets.roster).toEqual([])
    expect(json.presets.scoring).toEqual([])
    expect(json.sportFormatPreset).toEqual({ current: 'nba_dynasty_points_taxi', editable: true })
  })

  it('GET: not editable once drafting; NFL gets no sport formats', async () => {
    m.leagueFindUnique.mockResolvedValue({ sport: 'NBA', isDynasty: true, leagueVariant: null, status: 'drafting', lifecycleState: 'setup', settings: {} })
    expect((await (await get()).json()).sportFormatPreset.editable).toBe(false)
    m.leagueFindUnique.mockResolvedValue({ sport: 'NFL', isDynasty: true, leagueVariant: null, status: null, lifecycleState: 'setup', settings: {} })
    const nfl = await (await get()).json()
    expect(nfl.presets.sportFormats).toEqual([])
    expect(nfl.presets.roster).toEqual([{ id: 'dynasty_1qb' }])
  })

  it('PUT sportPresetId applies the preset and writes nothing else', async () => {
    m.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NBA', isDynasty: true, leagueVariant: null, settings: {} })
    const res = await put({ sportPresetId: 'nba_dynasty_points_deep' })
    expect(res.status).toBe(200)
    expect(m.apply).toHaveBeenCalledWith('L1', 'nba_dynasty_points_deep', 'commish')
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('PUT passes the refusal through', async () => {
    m.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NBA', isDynasty: true, leagueVariant: null, settings: {} })
    m.apply.mockResolvedValue({ ok: false, status: 409, error: 'Dynasty format presets can only be applied before the draft.' })
    const res = await put({ sportPresetId: 'nba_dynasty_points_deep' })
    expect(res.status).toBe(409)
  })
})
