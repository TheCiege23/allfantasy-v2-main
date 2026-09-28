/** Audit characterization: passing assertions reproduce gaps, not release acceptance. No database writes. */
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE, getDefaultDynastySetup } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { getDraftTypeOptions, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import { buildFullNflScoringConfig } from '@/lib/nfl-scoring/NflScoringPresets'
import { getDefaultScoringPresetId, listScoringPresetOptions } from '@/lib/league-creation-preset/scoring-presets'

const db = vi.hoisted(() => ({ league: { findFirst: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const body = {
  concept: 'redraft', sport: 'NFL', teamCount: 12, draftType: 'snake',
  scoringPreset: 'fb_half_ppr', leagueName: 'Audit League', timezone: 'America/New_York',
  conceptSetup: { draftDate: '2026-10-01', draftTime: '20:00', draftTimezone: 'America/New_York', visibility: 'public' },
} as const

function txMock() {
  const models: Record<string, any> = {}
  let counter = 0
  return new Proxy(models, { get(target, model: string) {
    return target[model] ??= {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (args: any) => ({ ...args.data, id: `${model}-${++counter}`, token: 'audit-token' })),
      createMany: vi.fn().mockResolvedValue({ count: 12 }),
      upsert: vi.fn().mockResolvedValue({ id: 'audit' }),
    }
  } })
}

describe('2026-09-19 league audit reproductions', () => {
  // ✅ FIXED 2026-09-24. The reproduction is INVERTED rather than deleted, so the audit's
  // finding stays legible and the fix stays guarded.
  //
  // The gap: `dynasty.draftMode` defaulted to `'scheduled'` while `draftDateUtc` defaulted to
  // empty, and NOTHING IN THE UI SET EITHER. `draftDateUtc` appeared in exactly two places in
  // the codebase — that default and the validator that rejected it — so the message ("set a
  // startup draft date/time, or switch draft mode to Offline") named two controls that do not
  // exist and the form could never be completed. Production agreed: 165 dynasty leagues, every
  // one an import, zero created natively.
  //
  // The default is now `'offline'`. The RULE is unchanged, and the second half pins that.
  it('no longer blocks dynasty on a date no screen can set', () => {
    const base = {
      ...DEFAULT_V2_STATE, leagueType: 'dynasty' as const, name: body.leagueName,
      sport: 'NFL' as const, draftType: 'snake' as const, scoringPresetId: 'fb_half_ppr',
      draftDate: body.conceptSetup.draftDate, draftTime: body.conceptSetup.draftTime,
      timezone: body.timezone, dynasty: getDefaultDynastySetup('NFL', 'snake'),
    }

    const issues = analyzeCreateLeagueCompletion(base)
    expect(issues.map(x => x.code)).not.toContain('dynasty_draft_date')
    expect(issues.map(x => x.code)).not.toContain('draft_date_required')

    // Still fires for anyone who does choose a scheduled startup.
    const scheduled = analyzeCreateLeagueCompletion({
      ...base,
      dynasty: { ...base.dynasty, draftMode: 'scheduled', draftDateUtc: '' },
    })
    expect(scheduled.map(x => x.code)).toContain('dynasty_draft_date')
  })

  // PARTIALLY FIXED 2026-09-19. The missing scheduled timestamp is resolved:
  // the transaction now converts the wizard's local date/time/zone through
  // `toUtc` and persists `LeagueSettings.draftDateUtc` (DST-correct coverage in
  // `league-create-audit-fixes-20260919.test.ts`).
  //
  // ✅ FIXED 2026-09-24 — the public-visibility disagreement is closed and this
  // is INVERTED rather than deleted. The listing was activated while
  // `RedraftLeagueExtendedSettings.isPublic` stayed false (that flag only
  // consulted best-ball visibility), and `league_privacy_visibility` — what
  // discovery and the privacy resolver read — was never written at all.
  it('schedules the draft, and public visibility records agree', async () => {
    const tx = txMock()
    const engine = runPresetEngine({ ...body, commissionerId: 'audit-user' })
    await createCanonicalLeagueInTransaction(tx as any, 'audit-user', body as any, engine)
    // 2026-10-01 20:00 in America/New_York is EDT (UTC-4).
    expect(tx.leagueSettings.create.mock.calls[0][0].data.draftDateUtc?.toISOString())
      .toBe('2026-10-02T00:00:00.000Z')
    expect(tx.redraftLeagueExtendedSettings.create.mock.calls[0][0].data.isPublic).toBe(true)
    expect(tx.findLeagueListing.upsert.mock.calls[0][0].create.isActive).toBe(true)
    const leagueData = tx.league.create.mock.calls[0][0].data
    expect(leagueData.settings.league_privacy_visibility).toBe('public')
    // The `/join?code=` link the league page shows after create must resolve: the code the
    // validator matches (`settings.inviteCode`) is the invite row's token.
    expect(leagueData.settings.inviteCode).toBe(tx.leagueInvite.create.mock.calls[0][0].data.token)
    expect(tx.draftSession.create.mock.calls[0][0].data.teamCount).toBe(12)
    expect(tx.roster.create).toHaveBeenCalledTimes(12)
  })

  it('reproduces advanced superflex/IDP flags not changing the resolved roster', () => {
    const ordinary = runPresetEngine({ ...body, commissionerId: 'audit-user' })
    const advanced = runPresetEngine({ ...body, commissionerId: 'audit-user',
      conceptSetup: { ...body.conceptSetup, advancedSetup: { superflex: true, idp: true, tePremium: true } },
    })
    expect(advanced.settingsSnapshot.rosterSettings).toEqual(ordinary.settingsSnapshot.rosterSettings)
    expect(advanced.settingsSnapshot.scoringSettings).toEqual(ordinary.settingsSnapshot.scoringSettings)
    expect(advanced.formatResolution.modifiers).toEqual(ordinary.formatResolution.modifiers)
  })

  it('rejects an invalid IANA timezone at create validation', () => {
    expect(validateCreatePayload({ ...body, timezone: 'Not/AZone' }).ok).toBe(false)
  })

  it('preserves explicit no-review as instant approval', async () => {
    const tx = txMock()
    const engine = runPresetEngine({ ...body, commissionerId: 'audit-user' })
    await createCanonicalLeagueInTransaction(tx as any, 'audit-user', { ...body, tradeReviewMode: 'none' } as any, engine)
    expect(tx.redraftLeagueExtendedSettings.create.mock.calls[0][0].data.commissionerTradeReviewType).toBe('instant')
  })

  it('records effective NFL draft and manager menus for every concept', () => {
    const matrix = LEAGUE_CREATE_OPTIONS_CATALOG_V1.concepts.map(c => ({
      concept: c.id,
      drafts: getDraftTypeOptions(c.id as any, 'NFL').map(x => x.id),
      counts: getTeamCountOptions('NFL', c.id as any),
      serverCounts: LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport[c.id]?.NFL,
    }))
    console.log('AUDIT_NFL_MATRIX', JSON.stringify(matrix))
    expect(matrix).toHaveLength(12)
  })

  // ✅ FIXED 2026-09-24: the bootstrap now seeds the chosen preset (see
  // `create-league-v2/bootstrap-seeds-chosen-scoring.test.ts`, which drives it). This case still
  // feeds the OLD seed by hand, so it keeps documenting what an `af_default` store does to a
  // Full-PPR league — the state every NFL league created before the fix is in.
  it('reproduces full-PPR creation being scored with the bootstrap half-PPR default', async () => {
    const engine = runPresetEngine({ ...body, scoringPreset: 'fb_ppr', commissionerId: 'audit-user' })
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: {
      ...engine.settingsSnapshot,
      nfl_scoring_config: { presetKey: 'af_default', rules: buildFullNflScoringConfig('af_default') },
    } })
    const score = await calculateScoreFromSportConfig('audit', 'receiver', 1, { rec: 2 }, 'WR')
    console.log('AUDIT_FULL_PPR_TWO_RECEPTIONS_EXPECTED_2_ACTUAL', score)
    expect(score).toBe(1)
  })

  // FIXED 2026-09-19: this reproduced a two-manager league receiving four
  // playoff places. `createCanonicalLeagueInTransaction` now clamps the bracket
  // to the manager count at the point of persistence. Kept as a regression
  // guard rather than deleted, so the defect cannot return silently.
  // Full coverage lives in `league-create-audit-fixes-20260919.test.ts`.
  it('no longer gives a two-manager league four playoff places', async () => {
    const tx = txMock()
    const small = { ...body, teamCount: 2 }
    expect(validateCreatePayload(small).ok).toBe(true)
    await createCanonicalLeagueInTransaction(tx as any, 'audit-user', small as any,
      runPresetEngine({ ...small, commissionerId: 'audit-user' }))
    expect(tx.league.create.mock.calls[0][0].data.playoffTeams).toBe(2)
  })

  it('reproduces soccer needing a pipeline absent from the simple wizard', () => {
    expect(DEFAULT_V2_STATE.soccerPipeline).toBeNull()
    const result = validateCreatePayload({ ...body, sport: 'SOCCER',
      scoringPreset: getDefaultScoringPresetId({ leagueType: 'redraft', sport: 'SOCCER', idpSelected: false }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some(e => e.path === 'soccerPipeline')).toBe(true)
  })

  it('reproduces scoring menu choices outside the server allowlist', () => {
    const options = listScoringPresetOptions({ leagueType: 'redraft', sport: 'NFL', idpSelected: false })
    const allowed = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedScoringPresetsByConceptSport.redraft.NFL!
    const invalid = options.filter(x => !allowed.includes(x.id)).map(x => x.id)
    console.log('AUDIT_SCORING_MENU_OUTSIDE_ALLOWLIST', invalid)
    expect(invalid.length).toBeGreaterThan(0)
  })
})
