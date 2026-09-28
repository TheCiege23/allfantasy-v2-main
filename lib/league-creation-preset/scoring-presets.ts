/**
 * Data-driven scoring presets for concept-first league creation.
 * Maps a stable preset id → scoring string / scoringSettings / superflex flags consumed by POST /api/league/create.
 */

import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import { isFootballLike } from '@/lib/create-league-v2/state'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'

export type ScoringPresetOption = {
  id: string
  label: string
  hint: string
}

export type PresetCtx = {
  leagueType: LeagueTypeId
  sport: SupportedSport
  idpSelected: boolean
}

type PresetRule = {
  id: string
  label: string
  hint: string
  /** Return true when this preset row applies to the current concept + sport + modifiers. */
  matches: (ctx: PresetCtx) => boolean
  /** Build API-facing scoring + scoringSettings (merged into wizard payload). */
  build: (ctx: PresetCtx) => {
    scoring: string
    scoringSettings: Record<string, unknown>
    isSuperflex: boolean
  }
}

const pprMap = { standard: 0, half: 0.5, full: 1 } as const

function fbPreset(
  id: string,
  label: string,
  hint: string,
  opts: {
    ppr: keyof typeof pprMap
    superflex?: boolean
    tePremium?: boolean
    tePremiumMultiplier?: number
  },
): PresetRule {
  return {
    id,
    label,
    hint,
    matches: (ctx) =>
      isFootballLike(ctx.sport) &&
      !ctx.idpSelected &&
      [
        'redraft',
        'dynasty',
        'keeper',
        'best_ball',
        'guillotine',
        'survivor',
        'tournament',
        'devy',
        'c2c',
        'zombie',
        'salary_cap',
        'big_brother',
      ].includes(ctx.leagueType),
    build: () => {
      const pprValue = pprMap[opts.ppr]
      const scoring = opts.ppr === 'full' ? 'ppr' : opts.ppr === 'half' ? 'half_ppr' : 'standard'
      return {
        scoring,
        isSuperflex: opts.superflex ?? false,
        scoringSettings: {
          source: 'af',
          ppr: pprValue,
          superflex: opts.superflex ?? false,
          tePremium: opts.tePremium ?? false,
          tePremiumMultiplier: opts.tePremium ? opts.tePremiumMultiplier ?? 1.5 : 1,
        },
      }
    },
  }
}

function ncaafPreset(
  id: string,
  label: string,
  hint: string,
  opts: {
    ppr: keyof typeof pprMap
  },
): PresetRule {
  return {
    id,
    label,
    hint,
    matches: (ctx) =>
      ctx.sport === 'NCAAF' &&
      !ctx.idpSelected &&
      [
        'redraft',
        'dynasty',
        'keeper',
        'best_ball',
        'guillotine',
        'survivor',
        'tournament',
        'devy',
        'c2c',
        'salary_cap',
        'big_brother',
      ].includes(ctx.leagueType),
    build: () => {
      const pprValue = pprMap[opts.ppr]
      const scoring = opts.ppr === 'full' ? 'ppr' : opts.ppr === 'half' ? 'half_ppr' : 'standard'
      return {
        scoring,
        isSuperflex: false,
        scoringSettings: {
          source: 'af',
          preset: id,
          ppr: pprValue,
          superflex: false,
          tePremium: false,
          tePremiumMultiplier: 1,
          scoringFormat: `${scoring}_college`,
        },
      }
    },
  }
}

const RULES: PresetRule[] = [
  ncaafPreset('ncaaf_standard', 'College Standard', 'No PPR for college football.', { ppr: 'standard' }),
  ncaafPreset('ncaaf_standard_college', 'College Standard', 'No PPR for college football.', { ppr: 'standard' }),
  ncaafPreset('ncaaf_half_ppr', 'College Half PPR', '0.5 per reception for college football.', { ppr: 'half' }),
  ncaafPreset('ncaaf_half_ppr_college', 'College Half PPR', '0.5 per reception for college football.', { ppr: 'half' }),
  ncaafPreset('ncaaf_ppr', 'College Full PPR', '1.0 per reception for college football.', { ppr: 'full' }),
  ncaafPreset('ncaaf_ppr_college', 'College Full PPR', '1.0 per reception for college football.', { ppr: 'full' }),
  fbPreset('fb_std', 'Standard', 'No PPR classic yardage + TD scoring.', { ppr: 'standard' }),
  fbPreset('fb_ppr', 'Full PPR', '1.0 per reception, WR/TE friendly.', { ppr: 'full' }),
  fbPreset('fb_standard', 'Standard', 'No PPR — classic yardage + TD scoring.', { ppr: 'standard' }),
  fbPreset('fb_half_ppr', 'Half PPR', '0.5 per reception — balanced modern default.', { ppr: 'half' }),
  fbPreset('fb_full_ppr', 'Full PPR', '1.0 per reception — WR/TE friendly.', { ppr: 'full' }),
  fbPreset('fb_te_premium', 'TE Premium', 'Half PPR + boosted TE scoring.', {
    ppr: 'half',
    tePremium: true,
    tePremiumMultiplier: 1.5,
  }),
  fbPreset('fb_superflex', 'Superflex', 'Start 2 QBs — superflex scoring defaults.', { ppr: 'half', superflex: true }),
  fbPreset('fb_2qb', '2QB style', 'Emphasizes QB depth (same superflex slot model).', { ppr: 'half', superflex: true }),
  {
    id: 'fb_idp',
    label: 'IDP balanced',
    hint: 'Individual defensive players with balanced scoring.',
    matches: (ctx) => ctx.idpSelected && supportsIdpLeagueSport(ctx.sport),
    build: () => ({
      scoring: 'IDP',
      isSuperflex: false,
      scoringSettings: {
        source: 'af',
        preset: 'idp_balanced',
        ppr: 0.5,
        superflex: false,
        tePremium: false,
        tePremiumMultiplier: 1,
      },
    }),
  },
  // Non-football: sport-native “points” presets (stored as default + preset key for downstream settings).
  {
    id: 'fb_idp_ppr',
    label: 'IDP balanced',
    hint: 'Individual defensive players with balanced scoring.',
    matches: (ctx) => ctx.idpSelected && supportsIdpLeagueSport(ctx.sport),
    build: () => ({
      scoring: 'IDP',
      isSuperflex: false,
      scoringSettings: {
        source: 'af',
        preset: 'idp_balanced',
        ppr: 0.5,
        superflex: false,
        tePremium: false,
        tePremiumMultiplier: 1,
      },
    }),
  },
  {
    id: 'fb_idp_balanced',
    label: 'IDP balanced',
    hint: 'Individual defensive players with balanced scoring.',
    matches: (ctx) => ctx.idpSelected && supportsIdpLeagueSport(ctx.sport),
    build: () => ({
      scoring: 'IDP',
      isSuperflex: false,
      scoringSettings: {
        source: 'af',
        preset: 'idp_balanced',
        ppr: 0.5,
        superflex: false,
        tePremium: false,
        tePremiumMultiplier: 1,
      },
    }),
  },
  {
    id: 'idp_balanced',
    label: 'IDP balanced',
    hint: 'Individual defensive players with balanced scoring.',
    matches: (ctx) => ctx.idpSelected && supportsIdpLeagueSport(ctx.sport),
    build: () => ({
      scoring: 'IDP',
      isSuperflex: false,
      scoringSettings: {
        source: 'af',
        preset: 'idp_balanced',
        ppr: 0.5,
        superflex: false,
        tePremium: false,
        tePremiumMultiplier: 1,
      },
    }),
  },
  ...(
    [
      { sport: 'NBA' as const, id: 'nba_points', label: 'Points (classic)', hint: 'Fantasy points from NBA stats.' },
      { sport: 'NCAAB' as const, id: 'ncaab_points', label: 'Points (classic)', hint: 'Fantasy points from college hoops.' },
      { sport: 'MLB' as const, id: 'mlb_points', label: 'Points (classic)', hint: 'Fantasy points from MLB counting stats.' },
      { sport: 'NHL' as const, id: 'nhl_points', label: 'Points (classic)', hint: 'Fantasy points from NHL stats.' },
      { sport: 'SOCCER' as const, id: 'soc_points', label: 'Points (classic)', hint: 'Fantasy points from fixtures.' },
    ] as const
  ).map(
    (row): PresetRule => ({
      id: row.id,
      label: row.label,
      hint: row.hint,
      matches: (ctx) => ctx.sport === row.sport && !ctx.idpSelected,
      build: () => ({
        scoring: 'default',
        isSuperflex: false,
        scoringSettings: {
          preset: row.id,
          source: 'af',
          scoringMode: 'points',
        },
      }),
    }),
  ),
  // NBA H2H-category presets. Matchups are resolved per category (PTS, REB,
  // AST, STL, BLK, TO, FG%, FT%, optional 3PM) instead of by summed points.
  // Standings track category wins/losses. Category-mode leagues still share
  // the same stat ingestion (PlayerGameStat.normalizedStatMap) — the branch
  // happens in the weekly processor once Turn 3 lands.
  {
    id: 'nba_9cat',
    label: '9-cat H2H',
    hint: 'Head-to-head categories: PTS, REB, AST, STL, BLK, TO, FG%, FT%, 3PM.',
    matches: (ctx) => ctx.sport === 'NBA' && !ctx.idpSelected,
    build: () => ({
      scoring: 'default',
      isSuperflex: false,
      scoringSettings: {
        preset: 'nba_9cat',
        source: 'af',
        scoringMode: 'h2h_category',
        categoryPresetId: 'nba_9cat',
      },
    }),
  },
  {
    id: 'nba_8cat',
    label: '8-cat H2H',
    hint: 'Head-to-head categories: PTS, REB, AST, STL, BLK, TO, FG%, FT% (no 3PM).',
    matches: (ctx) => ctx.sport === 'NBA' && !ctx.idpSelected,
    build: () => ({
      scoring: 'default',
      isSuperflex: false,
      scoringSettings: {
        preset: 'nba_8cat',
        source: 'af',
        scoringMode: 'h2h_category',
        categoryPresetId: 'nba_8cat',
      },
    }),
  },
]

export function listScoringPresetOptions(ctx: PresetCtx): ScoringPresetOption[] {
  const out: ScoringPresetOption[] = []
  for (const rule of RULES) {
    if (rule.matches(ctx)) {
      out.push({ id: rule.id, label: rule.label, hint: rule.hint })
    }
  }
  return dedupeById(out)
}

function dedupeById(rows: ScoringPresetOption[]): ScoringPresetOption[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}

export function getDefaultScoringPresetId(ctx: PresetCtx): string {
  const opts = listScoringPresetOptions(ctx)
  if (opts.length === 0) return ''
  if (ctx.idpSelected) {
    const balanced = opts.find((o) => o.id === 'idp_balanced')
    if (balanced) return balanced.id
    const fbBalanced = opts.find((o) => o.id === 'fb_idp_balanced')
    if (fbBalanced) return fbBalanced.id
    const idp = opts.find((o) => o.id === 'fb_idp')
    if (idp) return idp.id
  }
  if (ctx.sport === 'NCAAF') {
    const collegeHalf = opts.find((o) => o.id === 'ncaaf_half_ppr')
    if (collegeHalf) return collegeHalf.id
  }
  const half = opts.find((o) => o.id === 'fb_half_ppr')
  return half?.id ?? opts[0]!.id
}

export function resolveScoringPresetId(presetId: string, ctx: PresetCtx): string {
  if (presetId && isScoringPresetValidForContext(presetId, ctx)) {
    return presetId
  }
  return getDefaultScoringPresetId(ctx)
}

export function findScoringPresetRule(presetId: string): PresetRule | undefined {
  return RULES.find((r) => r.id === presetId)
}

/**
 * Points per reception a football preset scores (0, 0.5 or 1), or `null` for a preset that is not
 * football or does not exist. The preset builders ignore their context for this value.
 */
export function receptionPointsForScoringPresetId(presetId: string | null | undefined): number | null {
  if (!presetId) return null
  const rule = findScoringPresetRule(presetId)
  if (!rule) return null
  const ppr = rule.build({ leagueType: 'redraft', sport: 'NFL', idpSelected: false }).scoringSettings.ppr
  return typeof ppr === 'number' && Number.isFinite(ppr) ? ppr : null
}

export function buildScoringFromPresetId(presetId: string, ctx: PresetCtx): {
  scoring: string
  scoringSettings: Record<string, unknown>
  isSuperflex: boolean
} {
  const rule = findScoringPresetRule(presetId)
  if (!rule || !rule.matches(ctx)) {
    const fallback = getDefaultScoringPresetId(ctx)
    const fb = findScoringPresetRule(fallback)
    if (fb && fb.matches(ctx)) return fb.build(ctx)
    return {
      scoring: 'half_ppr',
      isSuperflex: false,
      scoringSettings: { source: 'af', ppr: 0.5, superflex: false, tePremium: false, tePremiumMultiplier: 1 },
    }
  }
  return rule.build(ctx)
}

export function isScoringPresetValidForContext(presetId: string, ctx: PresetCtx): boolean {
  const rule = findScoringPresetRule(presetId)
  return Boolean(rule && rule.matches(ctx))
}
