/**
 * Layered football scoring (NFL / NCAAF): base PPR × TE premium × QB slot format.
 * Composite preset ids are stable wire keys for POST /api/leagues `scoringPreset`.
 */

import type { SupportedSport } from '@/lib/create-league-v2/state'
import { isFootballLike } from '@/lib/create-league-v2/state'

export type FootballBaseScoringMode = 'standard' | 'half_ppr' | 'full_ppr'
export type FootballLineupFormatMode = 'one_qb' | 'superflex' | 'two_qb'

const LEGACY_MAP: Record<
  string,
  { base: FootballBaseScoringMode; tePremium: boolean; lineup: FootballLineupFormatMode }
> = {
  fb_standard: { base: 'standard', tePremium: false, lineup: 'one_qb' },
  fb_half_ppr: { base: 'half_ppr', tePremium: false, lineup: 'one_qb' },
  fb_full_ppr: { base: 'full_ppr', tePremium: false, lineup: 'one_qb' },
  fb_ppr: { base: 'full_ppr', tePremium: false, lineup: 'one_qb' },
  fb_te_premium: { base: 'half_ppr', tePremium: true, lineup: 'one_qb' },
  fb_superflex: { base: 'half_ppr', tePremium: false, lineup: 'superflex' },
  fb_2qb: { base: 'half_ppr', tePremium: false, lineup: 'two_qb' },
  ncaaf_half_ppr: { base: 'half_ppr', tePremium: false, lineup: 'one_qb' },
  ncaaf_ppr: { base: 'full_ppr', tePremium: false, lineup: 'one_qb' },
}

/** Regex: fb_standard_one_qb | fb_half_ppr_te_premium_superflex */
const COMPOSITE_RE =
  /^fb_(standard|half_ppr|full_ppr)(_te_premium)?_(one_qb|superflex|two_qb)$/

export function buildFootballCompositePresetId(
  base: FootballBaseScoringMode,
  tePremium: boolean,
  lineup: FootballLineupFormatMode,
): string {
  const baseSeg = base === 'standard' ? 'standard' : base === 'half_ppr' ? 'half_ppr' : 'full_ppr'
  const teSeg = tePremium ? '_te_premium' : ''
  return `fb_${baseSeg}${teSeg}_${lineup}`
}

export function parseFootballCompositePresetId(
  id: string,
): { base: FootballBaseScoringMode; tePremium: boolean; lineup: FootballLineupFormatMode } | null {
  const m = id.match(COMPOSITE_RE)
  if (!m) return null
  const baseRaw = m[1]
  const tePremium = Boolean(m[2])
  const lineupRaw = m[3]
  const base: FootballBaseScoringMode =
    baseRaw === 'standard' ? 'standard' : baseRaw === 'half_ppr' ? 'half_ppr' : 'full_ppr'
  const lineup: FootballLineupFormatMode =
    lineupRaw === 'superflex' ? 'superflex' : lineupRaw === 'two_qb' ? 'two_qb' : 'one_qb'
  return { base, tePremium, lineup }
}

export function migrateLegacyFootballPresetId(presetId: string): {
  base: FootballBaseScoringMode
  tePremium: boolean
  lineup: FootballLineupFormatMode
} {
  const parsed = parseFootballCompositePresetId(presetId)
  if (parsed) return parsed
  const legacy = LEGACY_MAP[presetId]
  if (legacy) return legacy
  return { base: 'half_ppr', tePremium: false, lineup: 'one_qb' }
}

/** Every composite id shipped to catalog / validation allowlists. */
export function allFootballCompositePresetIds(): string[] {
  const bases: FootballBaseScoringMode[] = ['standard', 'half_ppr', 'full_ppr']
  const lineups: FootballLineupFormatMode[] = ['one_qb', 'superflex', 'two_qb']
  const out: string[] = []
  for (const b of bases) {
    for (const te of [false, true]) {
      for (const l of lineups) {
        out.push(buildFootballCompositePresetId(b, te, l))
      }
    }
  }
  return out
}

export function formatFootballScoringSummary(state: {
  sport: SupportedSport
  idpSelected: boolean
  footballBaseScoring: FootballBaseScoringMode
  footballTePremium: boolean
  footballLineupFormat: FootballLineupFormatMode
}): string {
  if (!isFootballLike(state.sport) || state.idpSelected) return ''

  const baseLabel =
    state.footballBaseScoring === 'standard'
      ? 'Standard'
      : state.footballBaseScoring === 'half_ppr'
        ? 'Half PPR'
        : 'Full PPR'

  const parts: string[] = [baseLabel]
  if (state.footballTePremium) parts.push('TE Premium')

  if (state.footballLineupFormat === 'superflex') parts.push('Superflex')
  else if (state.footballLineupFormat === 'two_qb') parts.push('2QB')
  else parts.push('1QB')

  return parts.join(' + ')
}
