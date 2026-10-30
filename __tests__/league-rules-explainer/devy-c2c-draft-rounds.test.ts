/**
 * Devy and C2C draft rounds in the rules popup's Draft section (2026-10-29): which rounds of the main
 * draft take only college players, as the pick check enforces them (lib/live-draft-engine/
 * PickValidation.ts, from DraftSession.devyConfig / c2cConfig) — not as a settings label reads. English
 * and Spanish, nothing raw on screen, devy / C2C leagues only, and a "What changed" card for each save
 * that moves them: the draft room's devy / C2C config PATCHes and Settings › Draft (sessionVariant).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'
import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { draftRulesFromInputs, ruleSnapshotFromLeague, type DraftRuleInputs, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import type { RuleSection, RuleSnapshot } from '@/lib/league-rules-explainer/types'

type Db = { league: Record<string, unknown>; session: Record<string, unknown> | null; ls: Record<string, unknown> | null }

const m = vi.hoisted(() => {
  const state: { db: Db; lsFails: boolean } = { db: { league: {}, session: null, ls: null }, lsFails: false }
  return {
    state,
    publish: vi.fn(async (_input: unknown) => undefined),
    prisma: {
      league: { findUnique: vi.fn(async () => structuredClone(state.db.league)) },
      leagueSettings: {
        findUnique: vi.fn(async () => {
          if (state.lsFails) throw new Error('read failed')
          return state.db.ls ? structuredClone(state.db.ls) : null
        }),
      },
      draftSession: {
        findFirst: vi.fn(async () => (state.db.session ? structuredClone(state.db.session) : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const { version: _v, updatedAt: _u, ...rest } = data
          state.db.session = { ...(state.db.session ?? {}), ...structuredClone(rest) }
          return state.db.session
        }),
      },
    },
  }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/live-draft-engine/DraftSessionService')>()),
  buildSessionSnapshot: vi.fn(async () => ({ id: 'S' })),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({ draft_type: 'snake', rounds: 12, timer_seconds: 90, third_round_reversal: false, autopick_behavior: 'queue-first' })),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    timerMode: 'per_pick', slowDraftPauseWindow: null, allowPicksDuringOvernightPause: false, autoPickEnabled: true,
    orphanTeamAiManagerEnabled: false, orphanDrafterMode: 'cpu',
  })),
}))

import { PATCH as devyPatch } from '@/app/api/leagues/[leagueId]/draft/devy/config/route'
import { PATCH as c2cPatch } from '@/app/api/leagues/[leagueId]/draft/c2c/config/route'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
const render = (sections: RuleSection[], lang: 'en' | 'es') =>
  sections.flatMap((s) => [renderRuleText(s.title, t(lang), lang), ...s.lines.map((l) => renderRuleText(l.text, t(lang), lang))])
function expectClean(lines: string[], lang: 'en' | 'es') {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\.|\{\{|\}\}|[{}"[\]]|undefined|null|NaN|\[object/)
    if (lang === 'es') expect(l.toLowerCase(), l).not.toContain('waiver')
  }
}

const inputs = (over: Partial<DraftRuleInputs> = {}): DraftRuleInputs => ({
  sessionLabel: null, sessionStatus: 'pre_draft', draftType: 'snake', rounds: 12, pickSeconds: 90, thirdRoundReversal: false,
  timerMode: 'per_pick', pauseWindow: null, picksDuringPause: false, autoPickEnabled: true, cpuAutoPick: true,
  autopickBehavior: 'queue-first', orderMethod: 'manual', auction: null, startAt: null, autostart: false,
  orphanEnabled: false, orphanMode: 'cpu', ...over,
})
const rounds = (devy: unknown, c2c: unknown = null, applies = true) => ({ collegeRounds: { applies, devy, c2c } })

const DEVY: RulesLeagueRow = { platform: 'allfantasy', sport: 'NFL', leagueType: 'devy', leagueVariant: 'devy_dynasty', isDynasty: true, leagueSize: 12, settings: {} }
const C2C: RulesLeagueRow = { ...DEVY, leagueType: 'c2c', leagueVariant: 'merged_devy_c2c' }
const draftSection = (row: RulesLeagueRow, draft: Partial<RuleSnapshot>, lang: 'en' | 'es' = 'en') =>
  render(explainLeagueRules({ ...ruleSnapshotFromLeague(row), ...draft }).filter((x) => x.id === 'draft'), lang)
const fromInputs = (over: Partial<DraftRuleInputs>) => draftRulesFromInputs(inputs(over))

describe('draftRulesFromInputs — the college rounds the pick check enforces', () => {
  it('devy rounds: sorted, repeats dropped, and only whole rounds the draft has (Array.includes on the round)', () => {
    const r = fromInputs(rounds({ enabled: true, devyRounds: [12, 11, 11, '10', 2.5, 0, 13] }))
    expect(r.draftDevyRounds).toEqual([11, 12])
    expect(r.draftCollegeRounds).toBeNull()
  })

  it('C2C rounds are checked INSTEAD of devy rounds when both are on', () => {
    const r = fromInputs(rounds({ enabled: true, devyRounds: [1, 2] }, { enabled: true, collegeRounds: [1, 2, 3, 4, 5, 6] }))
    expect(r).toMatchObject({ draftDevyRounds: null, draftCollegeRounds: [1, 2, 3, 4, 5, 6] })
  })

  it('on with no listed round is a real rule — every college player is refused — so it reads as []', () => {
    expect(fromInputs(rounds({ enabled: true, devyRounds: [] })).draftDevyRounds).toEqual([])
    expect(fromInputs(rounds({ enabled: true })).draftDevyRounds).toEqual([])
    expect(fromInputs(rounds(null, { enabled: true, collegeRounds: 'all' })).draftCollegeRounds).toEqual([])
  })

  it('off, an auction (the auction engine never runs the check), or not a devy / C2C league: no rule', () => {
    const off = { draftDevyRounds: null, draftCollegeRounds: null }
    expect(fromInputs(rounds({ enabled: false, devyRounds: [11, 12] }))).toMatchObject(off)
    expect(fromInputs({ draftType: 'auction', auction: { budget: 200, minBid: 1 }, ...rounds({ enabled: true, devyRounds: [11, 12] }) })).toMatchObject(off)
    expect(fromInputs(rounds({ enabled: true, devyRounds: [11, 12] }, null, false))).toMatchObject(off)
    expect(fromInputs(rounds(null, null))).toMatchObject(off)
  })

  it('a caller that passes no session config states nothing (the keys are absent, so nothing diffs)', () => {
    const r = fromInputs({})
    expect('draftDevyRounds' in r).toBe(false)
    expect('draftCollegeRounds' in r).toBe(false)
  })

  it('a dynasty rookie draft carries no college rounds (createNextLeagueDraft copies them onto standard drafts only)', () => {
    expect(fromInputs({ sessionLabel: 'rookie', ...rounds({ enabled: true, devyRounds: [1] }) })).toEqual({})
  })
})

describe('the Draft section, English and Spanish', () => {
  it('devy rounds, one and several, with a run of three or more read as a range', () => {
    const en = draftSection(DEVY, fromInputs(rounds({ enabled: true, devyRounds: [1, 2, 3, 4, 7] })))
    expect(en).toContain('Rounds 1–4 and 7 are devy rounds: only college players can be picked in them. Every other round is for pro players only.')
    const one = draftSection(DEVY, fromInputs(rounds({ enabled: true, devyRounds: [12] })))
    expect(one).toContain('Round 12 is a devy round: only a college player can be picked in it. Every other round is for pro players only.')
    const two = draftSection(DEVY, fromInputs(rounds({ enabled: true, devyRounds: [11, 12] })))
    expect(two).toContain('Rounds 11 and 12 are devy rounds: only college players can be picked in them. Every other round is for pro players only.')
    const es = draftSection(DEVY, fromInputs(rounds({ enabled: true, devyRounds: [1, 2, 3, 4, 7] })), 'es')
    expect(es).toContain('Las rondas 1–4 y 7 son rondas devy: en ellas solo se pueden elegir jugadores universitarios. Todas las demás rondas son solo para jugadores profesionales.')
    for (const [lines, lang] of [[en, 'en'], [one, 'en'], [two, 'en'], [es, 'es']] as const) expectClean(lines, lang)
  })

  it('C2C college rounds, every round, and no round', () => {
    const c2c = draftSection(C2C, fromInputs(rounds(null, { enabled: true, collegeRounds: [1, 2, 3, 4, 5, 6] })))
    expect(c2c).toContain('Rounds 1–6 are college rounds: only college players can be picked in them. Every other round is for pro players only.')
    const all = draftSection(C2C, fromInputs({ rounds: 3, ...rounds(null, { enabled: true, collegeRounds: [3, 1, 2] }) }))
    expect(all).toContain('Every round is a college round: only college players can be picked in this draft.')
    const none = draftSection(DEVY, fromInputs(rounds({ enabled: true, devyRounds: [] })))
    expect(none).toContain('No round is a devy round, so college players cannot be picked in this draft: every round is for pro players only.')
    const es = draftSection(C2C, fromInputs(rounds(null, { enabled: true, collegeRounds: [5] })), 'es')
    expect(es).toContain('La ronda 5 es una ronda universitaria: en ella solo se puede elegir a un jugador universitario. Todas las demás rondas son solo para jugadores profesionales.')
    const esNone = draftSection(C2C, fromInputs(rounds(null, { enabled: true, collegeRounds: [] })), 'es')
    expect(esNone).toContain('Ninguna ronda es universitaria, así que en este draft no se pueden elegir jugadores universitarios: todas las rondas son solo para jugadores profesionales.')
    for (const [lines, lang] of [[c2c, 'en'], [all, 'en'], [none, 'en'], [es, 'es'], [esNone, 'es']] as const) expectClean(lines, lang)
  })

  it('an unknown stored value is omitted, never shown raw', () => {
    const base = fromInputs(rounds({ enabled: true, devyRounds: [11, 12] }))
    for (const bad of [['11'], [0], [1.5], 'rounds 11-12', { r: 11 }]) {
      const lines = draftSection(DEVY, { ...base, draftDevyRounds: bad as never })
      expect(lines.join(' ')).not.toMatch(/devy round|college player/i)
      expectClean(lines, 'en')
    }
  })

  it('no college-round line when the rule is off', () => {
    const lines = draftSection(DEVY, fromInputs(rounds({ enabled: false, devyRounds: [11, 12] })))
    expect(lines.join(' ')).not.toMatch(/devy round|college/i)
    expect(lines.length).toBeGreaterThan(1) // the rest of the Draft section is still there
  })
})

describe('"What changed" lines', () => {
  const line = (key: 'draftDevyRounds' | 'draftCollegeRounds', before: unknown, after: unknown, lang: 'en' | 'es' = 'en') => {
    const l = explainRuleChange({ key, before, after })
    return l ? renderChangeLine(l, t(lang), lang) : null
  }

  it('each key, English and Spanish', () => {
    expect(line('draftDevyRounds', [11, 12], [10, 11, 12])).toBe(
      'Devy rounds: Rounds 11 and 12 → Rounds 10–12 — only college players can be picked in rounds 10–12, and every other round is for pro players only.',
    )
    expect(line('draftCollegeRounds', [1, 2, 3, 4, 5, 6], [6])).toBe(
      'College rounds: Rounds 1–6 → Round 6 — only a college player can be picked in round 6, and every other round is for pro players only.',
    )
    expect(line('draftDevyRounds', [11, 12], [])).toBe('Devy rounds: Rounds 11 and 12 → No rounds — college players can no longer be picked in this draft.')
    expect(line('draftCollegeRounds', [5], null)).toBe('College rounds: Round 5 → Off — no round is set aside for college players any more.')
    const es = [
      line('draftDevyRounds', [11, 12], [10, 11, 12], 'es'),
      line('draftCollegeRounds', null, [1, 2], 'es'),
      line('draftDevyRounds', [11], [], 'es'),
      line('draftCollegeRounds', [5], null, 'es'),
    ]
    expect(es[0]).toBe(
      'Rondas devy: Rondas 11 y 12 → Rondas 10–12 — en las rondas 10–12 solo se pueden elegir jugadores universitarios, y todas las demás rondas son solo para jugadores profesionales.',
    )
    expect(es[1]).toMatch(/^Rondas universitarias: Desactivado → Rondas 1 y 2/)
    expectClean(es.map((s) => s ?? 'null'), 'es')
  })

  it('an unknown value on either side drops the line', () => {
    expect(explainRuleChange({ key: 'draftDevyRounds', before: ['11'], after: [12] })).toBeNull()
    expect(explainRuleChange({ key: 'draftCollegeRounds', before: [1], after: 'all' })).toBeNull()
  })

  it('a reordered or repeated list is not a change', () => {
    expect(diffRuleSnapshots({ draftDevyRounds: [11, 12] }, { draftDevyRounds: [11, 12] })).toEqual([])
    expect(explainRuleChange({ key: 'draftDevyRounds', before: [12, 11], after: [11, 12, 12] })).toBeNull()
  })
})

/* ------------------------------------------------------------------ save paths */

const devyLeague = () => ({
  id: 'L', platform: 'allfantasy', sport: 'NFL', leagueType: 'devy', leagueVariant: 'devy_dynasty', isDynasty: true,
  survivorMode: false, guillotineMode: false, bestBallMode: false, settings: {}, dynastyConfig: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.state.lsFails = false
  m.state.db = {
    league: devyLeague(),
    session: {
      id: 'S', status: 'pre_draft', draftType: 'snake', rounds: 12, timerSeconds: 90, thirdRoundReversal: false,
      auctionBudgetPerTeam: null, cpuAutoPick: true, draftModeLabel: null,
      devyConfig: { enabled: true, devyRounds: [11, 12] }, c2cConfig: null,
    },
    ls: {
      draftDateUtc: null, autostart: false, cpuAutoPick: true, draftType: 'snake', rounds: 12,
      pickTimerPreset: '90s', pickTimerCustomValue: null, draftOrderMethod: 'manual',
    },
  }
})

const req = (path: string, body: unknown) => createMockNextRequest(`http://x/api/leagues/L/draft/${path}/config`, { method: 'PATCH', body }) as never
const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const published = () => (m.publish.mock.calls[0]?.[0] ?? null) as { skipNotifications?: boolean; meta: Record<string, unknown> } | null

describe('PATCH /draft/devy/config → one silent "What changed" card', () => {
  it('publishes the devy rounds before and after, from the session the pick check reads', async () => {
    expect((await devyPatch(req('devy', { enabled: true, devyRounds: [10, 11, 12] }), ctx)).status).toBe(200)
    expect(m.publish).toHaveBeenCalledTimes(1)
    const ev = published()!
    expect(ev.skipNotifications).toBe(true)
    expect(ev.meta.section).toBe('draft')
    expect(ev.meta.ruleChanges).toEqual([{ key: 'draftDevyRounds', before: [11, 12], after: [10, 11, 12] }])
  })

  it('turning devy rounds off reads as Off', async () => {
    await devyPatch(req('devy', { enabled: false, devyRounds: [] }), ctx)
    expect(published()!.meta.ruleChanges).toEqual([{ key: 'draftDevyRounds', before: [11, 12], after: null }])
  })

  it('a save of the same rounds publishes nothing', async () => {
    expect((await devyPatch(req('devy', { enabled: true, devyRounds: [12, 11] }), ctx)).status).toBe(200)
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('a league that is not devy / C2C never gets a card for it', async () => {
    m.state.db.league = { ...devyLeague(), leagueType: 'redraft', leagueVariant: null, isDynasty: false }
    await devyPatch(req('devy', { enabled: true, devyRounds: [10] }), ctx)
    expect(m.publish).not.toHaveBeenCalled()
    expect(m.state.db.session!.devyConfig).toEqual({ enabled: true, devyRounds: [10] }) // the save still happened
  })

  it('a failed read never fails the save, and publishes nothing', async () => {
    m.state.lsFails = true
    const res = await devyPatch(req('devy', { enabled: true, devyRounds: [10] }), ctx)
    expect(res.status).toBe(200)
    expect(m.state.db.session!.devyConfig).toEqual({ enabled: true, devyRounds: [10] })
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('a failed publish never fails the save', async () => {
    m.publish.mockRejectedValueOnce(new Error('fanout down'))
    const res = await devyPatch(req('devy', { enabled: true, devyRounds: [10] }), ctx)
    expect(res.status).toBe(200)
    expect(m.publish).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /draft/c2c/config → one silent "What changed" card', () => {
  beforeEach(() => {
    m.state.db.league = { ...devyLeague(), leagueType: 'c2c', leagueVariant: 'merged_devy_c2c' }
    m.state.db.session = { ...m.state.db.session!, c2cConfig: { enabled: true, collegeRounds: [1, 2, 3, 4, 5, 6] } }
  })

  it('publishes the college rounds before and after', async () => {
    expect((await c2cPatch(req('c2c', { enabled: true, collegeRounds: [1, 2, 3] }), ctx)).status).toBe(200)
    expect(m.publish).toHaveBeenCalledTimes(1)
    expect(published()!.skipNotifications).toBe(true)
    expect(published()!.meta.ruleChanges).toEqual([{ key: 'draftCollegeRounds', before: [1, 2, 3, 4, 5, 6], after: [1, 2, 3] }])
  })

  it('switching C2C rounds off hands the pick check back to the devy rounds — both moves, one card', async () => {
    await c2cPatch(req('c2c', { enabled: false, collegeRounds: [] }), ctx)
    expect(m.publish).toHaveBeenCalledTimes(1)
    expect(published()!.meta.ruleChanges).toEqual([
      { key: 'draftDevyRounds', before: null, after: [11, 12] },
      { key: 'draftCollegeRounds', before: [1, 2, 3, 4, 5, 6], after: null },
    ])
  })

  it('a save of the same rounds publishes nothing; a failed read never fails the save', async () => {
    await c2cPatch(req('c2c', { enabled: true, collegeRounds: [1, 2, 3, 4, 5, 6] }), ctx)
    expect(m.publish).not.toHaveBeenCalled()
    m.state.lsFails = true
    expect((await c2cPatch(req('c2c', { enabled: true, collegeRounds: [1] }), ctx)).status).toBe(200)
    expect(m.state.db.session!.c2cConfig).toEqual({ enabled: true, collegeRounds: [1] })
    expect(m.publish).not.toHaveBeenCalled()
  })
})
