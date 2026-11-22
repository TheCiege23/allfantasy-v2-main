/**
 * Devy / C2C college rounds — the shared normaliser (lib/draft-defaults/draftRoundList.ts), the settings
 * hub's write and read through it, validateLeagueSettings' draft-type check for devy / C2C leagues, and
 * the pick check left unchanged for a valid config. The three save routes are covered in
 * ./devy-c2c-round-validation-routes.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  prisma: {
    league: { findUnique: vi.fn(async () => ({ leagueSize: 12, settings: {} })) },
    draftSession: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({ timerMode: 'per_pick' })),
  updateDraftUISettings: vi.fn(),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({ rounds: 15, draft_type: 'snake' })),
}))

import { MAX_DRAFT_ROUNDS, emptyCollegeRoundsError, sanitizeRoundList } from '@/lib/draft-defaults/draftRoundList'
import { getDraftVariantSettings, updateDraftVariantSettings } from '@/lib/draft-defaults/DraftVariantSettingsHub'
import { validateLeagueSettings } from '@/lib/league-settings-validation'
import { validateC2CEligibilityAsync, validateDevyEligibilityAsync } from '@/lib/live-draft-engine/PickValidation'

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { id: 'S', status: 'pre_draft', rounds: 15, draftType: 'snake', keeperConfig: null, devyConfig: null, c2cConfig: null, auctionBudgetPerTeam: null }
  m.prisma.draftSession.findFirst.mockImplementation(async () => (m.session ? { ...structuredClone(m.session), picks: [] } : null))
  m.prisma.draftSession.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const { version: _v, updatedAt: _u, ...rest } = data
    m.session = { ...m.session!, ...structuredClone(rest) }
    return m.session
  })
})

describe('sanitizeRoundList — the one round-list normaliser', () => {
  it('🛑 whole rounds 1..maxRound, each once, ascending', () => {
    expect(sanitizeRoundList([12, 3, 12, 7, 3], 15)).toEqual([3, 7, 12])
  })

  it('🛑 out-of-range and fractional entries are DROPPED, never clamped or rounded into a round', () => {
    // The old hub clamp turned 0 into round 1, 99 into 50, and 2.5 into 3 — rounds nobody listed.
    expect(sanitizeRoundList([0, -1, 16, 99, 2.5, 4], 15)).toEqual([4])
  })

  it('a numeric string from a form field becomes the number (so the engine’s includes matches); junk is dropped', () => {
    expect(sanitizeRoundList(['3', ' 5 ', '', 'abc', '2.5', null, undefined, true, false, {}, [], NaN, Infinity], 15)).toEqual([3, 5])
  })

  it('no / invalid round count falls back to the hard ceiling', () => {
    expect(MAX_DRAFT_ROUNDS).toBe(50)
    expect(sanitizeRoundList([1, 50, 51])).toEqual([1, 50])
    expect(sanitizeRoundList([1, 50, 51], 0)).toEqual([1, 50])
    expect(sanitizeRoundList([1, 50, 51], Number.NaN)).toEqual([1, 50])
    expect(sanitizeRoundList([1, 50, 51], 80)).toEqual([1, 50])
  })

  it('not an array is no rounds', () => {
    expect(sanitizeRoundList(undefined, 15)).toEqual([])
    expect(sanitizeRoundList('1,2', 15)).toEqual([])
  })

  it('the refusal names the valid range and the way out', () => {
    expect(emptyCollegeRoundsError('devy', 12)).toBe('Devy rounds are on but no valid round is listed. Add at least one round from 1 to 12, or turn devy rounds off.')
    expect(emptyCollegeRoundsError('c2c', 12)).toContain('C2C college rounds')
  })
})

describe('the settings hub writes and reads through it', () => {
  it('🛑 a Settings › Draft write stores the normalised list, bounded by the session’s round count', async () => {
    m.session = { ...m.session!, rounds: 12 }
    await updateDraftVariantSettings('L', {
      sessionVariant: { devyConfig: { enabled: true, devyRounds: [12, 13, 2.5, 11, 11, 0] }, c2cConfig: { enabled: true, collegeRounds: [3, 1, '2' as unknown as number] } },
    })
    expect(m.session!.devyConfig).toEqual({ enabled: true, devyRounds: [11, 12] })
    expect(m.session!.c2cConfig).toEqual({ enabled: true, collegeRounds: [1, 2, 3] })
  })

  it('off still stores no rounds (unchanged)', async () => {
    await updateDraftVariantSettings('L', { sessionVariant: { devyConfig: { enabled: false, devyRounds: [1, 2] } } })
    expect(m.session!.devyConfig).toEqual({ enabled: false, devyRounds: [] })
  })

  it('the read shows only the rounds the pick check can reach', async () => {
    m.session = { ...m.session!, rounds: 12, devyConfig: { enabled: true, devyRounds: [12, 11, 14, 2.5] } }
    const v = await getDraftVariantSettings('L')
    expect(v.sessionVariant?.devyConfig).toEqual({ enabled: true, devyRounds: [11, 12] })
  })
})

describe('validateLeagueSettings — devy / C2C draft types', () => {
  const devy = { league_type: 'devy', league_variant: 'devy_dynasty', devy_slots: 6, devyConfig: { enabled: true, devyRounds: [1, 2] } }
  const c2c = { league_type: 'c2c', league_variant: 'merged_devy_c2c', c2c_college_roster_size: 20, c2cConfig: { enabled: true, collegeRounds: [1, 2] } }

  it('🛑 the saved engine core (snake / linear / auction) is valid for a devy and a C2C league', () => {
    for (const base of [devy, c2c]) {
      for (const draft_type of ['snake', 'linear', 'auction']) {
        const r = validateLeagueSettings({ ...base, draft_type, auction_budget_per_team: 200 })
        expect(r.errors, `${base.league_type} ${draft_type}`).toEqual([])
      }
    }
  })

  it('the specialty ids stay valid, and a type the format does not offer is still refused', () => {
    expect(validateLeagueSettings({ ...devy, draft_type: 'devy_snake' }).valid).toBe(true)
    expect(validateLeagueSettings({ ...c2c, draft_type: 'c2c_linear' }).valid).toBe(true)
    expect(validateLeagueSettings({ ...devy, draft_type: 'c2c_snake' }).errors).toContain('c2c_snake draft is not valid for devy leagues.')
    expect(validateLeagueSettings({ ...devy, draft_type: 'zebra' }).errors).toContain('zebra draft is not valid for devy leagues.')
  })

  it('other formats are untouched: a zombie league still refuses linear', () => {
    expect(validateLeagueSettings({ league_type: 'zombie', draft_type: 'linear' }).errors).toContain('linear draft is not valid for zombie leagues.')
  })

  it('🛑 on with an empty list is still refused (the shared rule on Settings › Draft)', () => {
    const r = validateLeagueSettings({ ...devy, draft_type: 'snake', devyConfig: { enabled: true, devyRounds: [] } })
    expect(r.errors.some((e) => e.includes('at least one devy round'))).toBe(true)
  })
})

describe('the pick check is unchanged for a valid config', () => {
  // A devy-eligible college player, a graduated pro, and a player with no devy record.
  const db = {
    devyPlayer: {
      findFirst: vi.fn(async (args: { where: { graduatedToNFL?: boolean; OR: Array<{ normalizedName?: string }> } }) => {
        const name = args.where.OR[0]?.normalizedName
        const row = name === 'college kid' ? { graduatedToNFL: false } : name === 'grad pro' ? { graduatedToNFL: true } : null
        if (!row) return null
        if (args.where.graduatedToNFL === false && row.graduatedToNFL) return null
        return row
      }),
    },
  }
  const players = ['College Kid', 'Grad Pro', 'Vet Pro']

  it('🛑 the same verdicts for the raw valid list and its normalised form, round by round (devy and C2C)', async () => {
    const raw = [11, 12]
    const normalised = sanitizeRoundList(raw, 12)
    expect(normalised).toEqual(raw)
    for (let round = 1; round <= 12; round++) {
      for (const playerName of players) {
        const a = await validateDevyEligibilityAsync({ currentRound: round, playerName, devyConfig: { enabled: true, devyRounds: raw } }, db)
        const b = await validateDevyEligibilityAsync({ currentRound: round, playerName, devyConfig: { enabled: true, devyRounds: normalised } }, db)
        expect(b, `devy r${round} ${playerName}`).toEqual(a)
        const c = await validateC2CEligibilityAsync({ currentRound: round, playerName, c2cConfig: { enabled: true, collegeRounds: raw } }, db)
        const d = await validateC2CEligibilityAsync({ currentRound: round, playerName, c2cConfig: { enabled: true, collegeRounds: normalised } }, db)
        expect(d, `c2c r${round} ${playerName}`).toEqual(c)
      }
    }
  })

  it('a devy round takes the college player and refuses the pro; any other round the reverse', async () => {
    const cfg = { enabled: true, devyRounds: [11, 12] }
    expect((await validateDevyEligibilityAsync({ currentRound: 12, playerName: 'College Kid', devyConfig: cfg }, db)).valid).toBe(true)
    expect((await validateDevyEligibilityAsync({ currentRound: 12, playerName: 'Vet Pro', devyConfig: cfg }, db)).valid).toBe(false)
    expect((await validateDevyEligibilityAsync({ currentRound: 3, playerName: 'College Kid', devyConfig: cfg }, db)).valid).toBe(false)
    expect((await validateDevyEligibilityAsync({ currentRound: 3, playerName: 'Vet Pro', devyConfig: cfg }, db)).valid).toBe(true)
  })

  it('why "on, no rounds" is refused: the pick check then refuses the college player in EVERY round', async () => {
    for (let round = 1; round <= 12; round++) {
      expect((await validateDevyEligibilityAsync({ currentRound: round, playerName: 'College Kid', devyConfig: { enabled: true, devyRounds: [] } }, db)).valid).toBe(false)
      expect((await validateC2CEligibilityAsync({ currentRound: round, playerName: 'College Kid', c2cConfig: { enabled: true, collegeRounds: [] } }, db)).valid).toBe(false)
    }
  })
})
