import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PUT /api/commissioner/leagues/[leagueId]/scoring-type — switching scoring type / editing the
 * category list after creation. The real lifecycle chain runs (settingsLifecycleGate →
 * leagueActionGate → leagueLifecycleService) against a mocked league row, as in
 * settings-editors-lifecycle-gate.test.ts.
 */

const h = vi.hoisted(() => ({
  leagueRow: {} as Record<string, unknown>,
  leagueUpdate: vi.fn(),
  seasonRow: null as null | { id: string; season: number; currentWeek: number },
  lastFinalMatchupWeek: null as null | number,
  lastFinalTeamWeek: null as null | number,
  logAction: vi.fn(async () => undefined),
  publish: vi.fn(async () => undefined),
  recalc: vi.fn(async () => ({ updated: 0, incomplete: 0, summaries: [] })),
  standings: vi.fn(async () => ({})),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => h.leagueRow),
      findFirst: vi.fn(async () => h.leagueRow),
      update: vi.fn(async (args: { data: { settings: Record<string, unknown> } }) => {
        h.leagueUpdate(args)
        h.leagueRow = { ...h.leagueRow, settings: args.data.settings }
        return h.leagueRow
      }),
    },
    draftSession: { findFirst: vi.fn(async () => null) },
    redraftSeason: { findFirst: vi.fn(async () => h.seasonRow) },
    redraftMatchup: { findFirst: vi.fn(async () => (h.lastFinalMatchupWeek == null ? null : { week: h.lastFinalMatchupWeek })) },
    teamWeekResult: { findFirst: vi.fn(async () => (h.lastFinalTeamWeek == null ? null : { week: h.lastFinalTeamWeek })) },
  },
}))
vi.mock('@/server/services/permissionService', () => ({
  isHeadCommissioner: vi.fn(async () => true),
  isElevatedCommissioner: vi.fn(async () => true),
  canViewLeague: vi.fn(async () => true),
  canDestructiveCommissionerAction: vi.fn(async () => true),
}))
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: h.publish }))
vi.mock('@/lib/tournament/seasonDraftReleaseGate', () => ({ hasSeasonDraftRelease: vi.fn(async () => false) }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ recalculateMatchupsForSeasonWeek: h.recalc }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: h.standings }))

import { GET, PUT } from '@/app/api/commissioner/leagues/[leagueId]/scoring-type/route'
import { groupSettingsChanges } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine } from '@/lib/league-rules-explainer/render'
import { translations } from '@/lib/i18n/translations'

const MLB_POINTS = { scoring_mode: 'points', unrelated: 'kept' }
const NBA_CATS = { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'each' }

function setLeague(sport: string, lifecycleState: string | null, settings: Record<string, unknown>) {
  h.leagueRow = {
    id: 'L1', userId: 'u1', sport, season: 2026, lifecycleState, locked: false, emergencyPaused: false,
    status: null, settings, lifecycleMetadata: null,
  }
}

function put(body: unknown) {
  const req = new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) })
  return PUT(req, { params: Promise.resolve({ leagueId: 'L1' }) })
}

const saved = () =>
  (h.leagueUpdate.mock.calls.at(-1)?.[0] as { data: { settings: Record<string, any> } } | undefined)?.data.settings

beforeEach(() => {
  h.leagueUpdate.mockReset()
  h.logAction.mockClear()
  h.publish.mockClear()
  h.recalc.mockClear()
  h.standings.mockClear()
  h.seasonRow = null
  h.lastFinalMatchupWeek = null
  h.lastFinalTeamWeek = null
})

describe('validation: 400 before anything is asked or written', () => {
  const cases: Array<[string, string, Record<string, unknown>, Record<string, unknown>, string]> = [
    ['unknown category', 'MLB', MLB_POINTS, { mode: 'h2h_category', presetId: 'mlb_5x5', categoryIds: ['hr', 'nba_pts'] }, 'unknown_category'],
    ['duplicate category', 'MLB', MLB_POINTS, { mode: 'h2h_category', presetId: 'mlb_5x5', categoryIds: ['hr', 'r', 'hr'] }, 'duplicate_category'],
    ['empty category list', 'NBA', NBA_CATS, { categoryIds: [] }, 'invalid_category_list'],
    ['category list that is not an array', 'NBA', NBA_CATS, { categoryIds: 'nba_pts' }, 'invalid_category_list'],
    ['a type the sport cannot score (NCAAB roto)', 'NCAAB', { scoring_mode: 'points' }, { mode: 'roto' }, 'unsupported_scoring_mode'],
    ['NBA roto on an 8-cat set (roto is 9-cat only)', 'NBA', NBA_CATS, { mode: 'roto', presetId: 'nba_8cat_standard' }, 'unsupported_category_preset'],
    ['categories for a points-only sport (NFL)', 'NFL', { scoring_mode: 'points' }, { mode: 'h2h_category', presetId: 'mlb_5x5' }, 'unsupported_scoring_mode'],
    ['a preset from another sport', 'NBA', NBA_CATS, { presetId: 'mlb_5x5' }, 'unsupported_category_preset'],
    ['a record mode that does not fit the type', 'MLB', MLB_POINTS, { mode: 'roto', presetId: 'mlb_5x5', recordMode: 'each' }, 'unsupported_record_mode'],
  ]
  for (const [name, sport, settings, body, code] of cases) {
    it(`${name} → 400 ${code}, even in_season without confirmation`, async () => {
      setLeague(sport, 'in_season', settings)
      const res = await put(body)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { code?: string }).code).toBe(code)
      expect(h.leagueUpdate).not.toHaveBeenCalled()
    })
  }
})

describe('lifecycle gate and data rule', () => {
  it('pre_draft: points → H2H categories applies at once, no history, no prompt, defaults stored as preset', async () => {
    setLeague('MLB', 'pre_draft', MLB_POINTS)
    const res = await put({ mode: 'h2h_category', presetId: 'mlb_5x5' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json).toMatchObject({ ok: true, changed: true, effectiveFromWeek: null })
    expect(json.current.categoryIds).toEqual(['r', 'hr', 'rbi', 'sb', 'avg', 'w', 'sv', 'k', 'era', 'whip'])
    expect(saved()).toEqual({
      scoring_mode: 'h2h_category', category_preset_id: 'mlb_5x5', category_record_mode: 'most', category_ids: null, unrelated: 'kept',
    })
    expect(h.logAction).not.toHaveBeenCalled()
  })

  it('in_season without the flag: 409 mid_season_confirmation_required, nothing written', async () => {
    setLeague('NBA', 'in_season', NBA_CATS)
    const res = await put({ mode: 'points' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code?: string }).code).toBe('mid_season_confirmation_required')
    expect(h.leagueUpdate).not.toHaveBeenCalled()
  })

  for (const state of ['drafting', 'archived']) {
    it(`${state}: refused even when confirmed`, async () => {
      setLeague('NBA', state, NBA_CATS)
      const res = await put({ mode: 'points', confirmMidSeasonChange: true })
      expect(res.status).toBe(409)
      expect(((await res.json()) as { code?: string }).code).toBe('LIFECYCLE_BLOCKED')
      expect(h.leagueUpdate).not.toHaveBeenCalled()
    })
  }

  it('in_season, confirmed: applies from the week after the last final week, audited, announced, that week re-scored', async () => {
    setLeague('NBA', 'in_season', NBA_CATS)
    h.seasonRow = { id: 's1', season: 2026, currentWeek: 6 }
    h.lastFinalMatchupWeek = 5
    h.lastFinalTeamWeek = 4
    const res = await put({ categoryIds: ['nba_pts', 'nba_reb', 'nba_3pm'], confirmMidSeasonChange: true })
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json).toMatchObject({ changed: true, effectiveFromWeek: 6 })
    expect(json.current.categoryIds).toEqual(['nba_pts', 'nba_reb', 'nba_3pm'])
    const s = saved()!
    expect(s.category_ids).toEqual(['nba_pts', 'nba_reb', 'nba_3pm'])
    expect(s.scoring_type_history).toEqual([
      expect.objectContaining({
        season: 2026,
        effectiveFromWeek: 6,
        changedBy: 'u1',
        previous: { mode: 'h2h_category', presetId: 'nba_9cat', recordMode: 'each', categoryIds: null },
      }),
    ])
    // The confirmation flag is never stored.
    expect(s).not.toHaveProperty('confirmMidSeasonChange')
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'settings_mid_season_change' }))
    await vi.waitFor(() => expect(h.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'settings_changed' })))
    await vi.waitFor(() => expect(h.standings).toHaveBeenCalledWith('s1', 6))
    expect(h.recalc).toHaveBeenCalledWith('s1', 6)
  })

  it('confirmed, nothing final yet: no history, the new type covers every week', async () => {
    setLeague('NBA', 'post_draft', NBA_CATS)
    h.seasonRow = { id: 's1', season: 2026, currentWeek: 0 }
    const res = await put({ mode: 'points', confirmMidSeasonChange: true })
    expect(res.status).toBe(200)
    expect(saved()).not.toHaveProperty('scoring_type_history')
    expect(saved()).toMatchObject({ scoring_mode: 'points', category_preset_id: null, category_ids: null })
    expect(h.recalc).not.toHaveBeenCalled()
  })

  it('roto cannot be switched into, or its categories edited, mid-season — even confirmed', async () => {
    setLeague('MLB', 'in_season', MLB_POINTS)
    const into = await put({ mode: 'roto', presetId: 'mlb_5x5', confirmMidSeasonChange: true })
    expect(into.status).toBe(409)
    expect(((await into.json()) as { code?: string }).code).toBe('roto_locked_mid_season')
    setLeague('MLB', 'playoffs', { scoring_mode: 'roto', category_preset_id: 'mlb_5x5', category_record_mode: 'roto' })
    const cats = await put({ categoryIds: ['hr', 'r'], confirmMidSeasonChange: true })
    expect(cats.status).toBe(409)
    expect(h.leagueUpdate).not.toHaveBeenCalled()
  })

  it('roto is an ordinary change in the offseason', async () => {
    setLeague('MLB', 'offseason', MLB_POINTS)
    const res = await put({ mode: 'roto', presetId: 'mlb_6x6' })
    expect(res.status).toBe(200)
    expect(saved()).toMatchObject({ scoring_mode: 'roto', category_preset_id: 'mlb_6x6', category_record_mode: 'roto' })
  })

  it('an unchanged request writes nothing and records nothing', async () => {
    setLeague('NBA', 'in_season', NBA_CATS)
    const res = await put({ mode: 'h2h_category', presetId: 'nba_9cat', confirmMidSeasonChange: true })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { changed?: boolean }).changed).toBe(false)
    expect(h.leagueUpdate).not.toHaveBeenCalled()
    expect(h.logAction).not.toHaveBeenCalled()
  })

  it('a non-commissioner is refused', async () => {
    setLeague('NBA', 'pre_draft', NBA_CATS)
    h.leagueRow.userId = 'someone-else'
    const res = await put({ mode: 'points' })
    expect(res.status).toBe(403)
  })
})

describe('the "What changed" card', () => {
  type Pub = { eventType: string; skipNotifications?: boolean; meta?: { ruleChanges?: Array<{ key: string; before: unknown; after: unknown }> } }
  const cardEvents = () => (h.publish.mock.calls as unknown as Array<[Pub]>).map((c) => c[0]).filter((e) => e.meta?.ruleChanges)
  const render = (changes: Array<{ key: string; before: unknown; after: unknown }>, lang: 'en' | 'es') => {
    const [group] = groupSettingsChanges([{ id: 'e1', createdAt: '2026-10-29T12:00:00.000Z', actorUserId: 'u1', changes }], { sport: 'MLB' })
    return (group?.lines ?? []).map((l) => renderChangeLine(l, (k) => translations[lang][k] ?? k, lang)).join(' ')
  }

  it('a switch publishes one silent card with the scoring type and category results it changed', async () => {
    setLeague('MLB', 'pre_draft', MLB_POINTS)
    await put({ mode: 'h2h_category', presetId: 'mlb_5x5' })
    const cards = cardEvents()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ eventType: 'settings_changed', skipNotifications: true })
    expect(cards[0]!.meta!.ruleChanges).toEqual([
      { key: 'scoringMode', before: 'points', after: 'h2h_category' },
      { key: 'categoryRecordMode', before: null, after: 'most' },
    ])
    const en = render(cards[0]!.meta!.ruleChanges!, 'en')
    const es = render(cards[0]!.meta!.ruleChanges!, 'es')
    expect(en).toMatch(/^Scoring type: /)
    expect(es).toMatch(/^Tipo de puntuación: /)
    expect(es).not.toMatch(/waiver/i)
  })

  it('back to points: the category results line goes with it', async () => {
    setLeague('NBA', 'pre_draft', NBA_CATS)
    await put({ mode: 'points' })
    expect(cardEvents()[0]!.meta!.ruleChanges).toEqual([
      { key: 'scoringMode', before: 'h2h_category', after: 'points' },
      { key: 'categoryRecordMode', before: 'each', after: null },
    ])
  })

  it('a category-list edit that keeps the type and results publishes no card', async () => {
    setLeague('NBA', 'pre_draft', NBA_CATS)
    await put({ mode: 'h2h_category', presetId: 'nba_8cat' })
    expect(saved()).toBeTruthy()
    expect(cardEvents()).toEqual([])
  })

  it('an unchanged request publishes no card', async () => {
    setLeague('NBA', 'in_season', NBA_CATS)
    await put({ mode: 'h2h_category', presetId: 'nba_9cat', confirmMidSeasonChange: true })
    expect(cardEvents()).toEqual([])
  })
})

describe('GET', () => {
  it('describes the current type and what the sport can switch to', async () => {
    setLeague('MLB', 'in_season', MLB_POINTS)
    const res = await GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ leagueId: 'L1' }) })
    const json = (await res.json()) as Record<string, any>
    expect(json.current).toMatchObject({ mode: 'points', categoryIds: [] })
    expect(json.options.modes).toEqual(['points', 'h2h_category', 'roto'])
    expect(json.options.presets.map((p: { id: string }) => p.id)).toEqual(['mlb_5x5', 'mlb_6x6'])
    expect(json.options.catalog.map((c: { id: string }) => c.id)).toContain('hld')
  })

  it('NFL offers points only', async () => {
    setLeague('NFL', 'in_season', { scoring_mode: 'points' })
    const res = await GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ leagueId: 'L1' }) })
    expect(((await res.json()) as Record<string, any>).options.modes).toEqual(['points'])
  })
})
