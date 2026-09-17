/**
 * What kind of league is this, and where does your team sit in it — for the portfolio filters,
 * the distribution bars and the action ranking.
 *
 * PURE: no prisma, no clock. Every rule here reuses the module that already owns it rather than
 * re-deriving it, because each of those rules has a recorded way of being wrong:
 *
 *   - FORMAT    `readFormatRules` — the only reader that handles `keeperCount` defaulting to 3
 *               (an untouched default is NOT a keeper league) and the concept alias tags that
 *               flatten KOTH/IDP onto "redraft" and pirate/royal onto "dynasty".
 *   - SCORING   `scoringRulesFrom` + `scoringFormatFromRec` — reception bands off the league's own
 *               rulebook. `League.scoringPresetId` is NOT read: on staging every Sleeper league
 *               says `fb_half_ppr`, including the 203 whose `rec` is 1.
 *   - IDP       `hasIdpScoring` — bare `sack`/`int` are team-defence defaults every league ships,
 *               so they are not evidence; only defender-only keys are.
 *   - STAGE     `resolveLeagueStage` — the platform's `status` wins over `lifecycleState`, which
 *               defaults to `in_season` on every import.
 */

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { readConceptAliasTags } from '@/lib/league-contract/conceptAliasTags'
import { scoringFormatFromRec, scoringRulesFrom } from '@/lib/decision-os/trade/scoringContextFromWorld'
import { hasIdpScoring } from './scoringNotes'
import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { isIdpLeagueVariant } from './idpLeagueVariant'
import { leagueVariantFor } from './valueBook'
import { resolveLeagueStage } from '@/lib/league-stage/leagueStage'
import type {
  CompetitiveStatus,
  FormatFamily,
  PortfolioStage,
  ScoringKind,
  StatusSource,
} from './portfolioInsightsTypes'

export type ClassifiableLeague = {
  leagueType?: string | null
  isDynasty?: boolean | null
  keeperCount?: number | null
  keeperCostSystem?: string | null
  keeperRoundPenalty?: number | null
  settings?: unknown
  leagueVariant?: string | null
  bestBallMode?: boolean | null
  status?: string | null
  lifecycleState?: string | null
}

export type LeagueFormatFacts = {
  concept: string
  family: FormatFamily
  bestBall: boolean
  idp: boolean
  superflex: boolean
  scoring: ScoringKind | null
  tePremium: boolean
  stage: PortfolioStage
}

/**
 * Concept → family.
 *
 * ⚠ DEVY, C2C AND PIRATE ARE DYNASTY. They carry players across seasons, which is the property
 * the filter is asking about — `careerLedger.normalizeLeagueType` folds devy and c2c the same way.
 * Guillotine and king-of-the-hill are one-season games, so they are redraft. Zombie, survivor and
 * tournament vary by league and are left as `other` rather than guessed.
 */
const FAMILY: Record<string, FormatFamily> = {
  dynasty: 'dynasty',
  devy: 'dynasty',
  c2c: 'dynasty',
  pirate: 'dynasty',
  keeper: 'keeper',
  redraft: 'redraft',
  guillotine: 'redraft',
  king_of_the_hill: 'redraft',
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function stageOf(league: { status?: string | null; lifecycleState?: string | null }): PortfolioStage {
  const raw = resolveLeagueStage(league)
  if (!raw) return 'unknown'
  if (raw === 'drafting' || raw === 'draft') return 'drafting'
  if (raw === 'pre_draft' || raw === 'predraft' || raw === 'setup') return 'pre_draft'
  if (raw === 'complete' || raw === 'completed' || raw === 'season_over' || raw === 'archived') return 'complete'
  if (raw === 'in_season' || raw === 'inseason' || raw === 'active' || raw === 'playoffs' || raw === 'post_draft') {
    return 'in_season'
  }
  return 'unknown'
}

export function classifyLeagueFormat(league: ClassifiableLeague): LeagueFormatFacts {
  const rules = readFormatRules({
    leagueType: league.leagueType,
    isDynasty: league.isDynasty,
    keeperCount: league.keeperCount,
    keeperCostSystem: league.keeperCostSystem,
    keeperRoundPenalty: league.keeperRoundPenalty,
    aliasTags: readConceptAliasTags(league.settings),
    settings: league.settings,
  })
  const concept = String(rules.concept)
  const aliasIdp = readConceptAliasTags(league.settings).some((t) => String(t).toLowerCase() === 'idp')
  const rulebook = scoringRulesFrom(league.settings)
  const rec = num(rulebook?.rec)
  const tep = num(rulebook?.bonus_rec_te)

  return {
    concept,
    family: FAMILY[concept] ?? 'other',
    bestBall: isBestBallLeague(league.leagueVariant ?? null, league.bestBallMode ?? null),
    idp: hasIdpScoring(rulebook) || isIdpLeagueVariant(league.leagueVariant ?? null) || aliasIdp,
    superflex: leagueVariantFor(league.settings, league.leagueType ?? null).superflex,
    scoring: scoringFormatFromRec(rec) ?? null,
    tePremium: tep != null && tep > 0,
    stage: stageOf(league),
  }
}

/** Human labels, used by the screen and the tests alike so the two cannot drift. */
export const FAMILY_LABEL: Record<FormatFamily, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
  other: 'Other formats',
}

export const SCORING_LABEL: Record<ScoringKind, string> = {
  ppr: 'PPR',
  half_ppr: 'Half PPR',
  standard: 'Standard',
}

export const STATUS_LABEL: Record<CompetitiveStatus, string> = {
  contender: 'Contender',
  middle: 'Middle of the pack',
  rebuild: 'Rebuilding',
  unknown: 'Not enough to say',
}

export const STAGE_LABEL: Record<PortfolioStage, string> = {
  drafting: 'Drafting',
  pre_draft: 'Pre-draft',
  in_season: 'In season',
  complete: 'Season over',
  unknown: 'Stage unknown',
}

type Third = -1 | 0 | 1

/**
 * Top third → +1, bottom third → −1. `position` is 1-based; `of` is how many were ranked.
 *
 * ⚠ FEWER THAN FOUR RANKED IS NOT A LEAGUE. A 3-team split has no middle worth naming and a
 * two-team "bottom third" is just last place, so both return null rather than a confident tier.
 */
export function thirdOf(position: number | null, of: number | null): Third | null {
  if (position == null || of == null || of < 4 || position < 1 || position > of) return null
  const pct = (position - 1) / (of - 1)
  if (pct <= 1 / 3) return 1
  if (pct >= 2 / 3) return -1
  return 0
}

/** Games that make a standing mean something. Before this, `currentRank` is a draft slot or a seed. */
export const MIN_GAMES_FOR_STANDING = 2

export function competitiveStatus(input: {
  declared: 'contender' | 'rebuilder' | null
  record: { wins: number; losses: number; ties: number } | null
  rank: number | null
  teamCount: number | null
  rosterValueRank: number | null
  valuedTeams: number | null
}): { status: CompetitiveStatus; source: StatusSource | null } {
  /*
   * ⚠ WHAT YOU SAID WINS, BECAUSE IT IS THE ONLY SIGNAL THAT KNOWS YOUR INTENT. A 2-6 team whose
   * manager is trading for picks is rebuilding whatever its roster value says, and a manager who
   * told Chimmy "I'm contending" wants contender advice even in a slow start.
   */
  if (input.declared === 'contender') return { status: 'contender', source: 'you' }
  if (input.declared === 'rebuilder') return { status: 'rebuild', source: 'you' }

  const games = input.record ? input.record.wins + input.record.losses + input.record.ties : 0
  const standing = games >= MIN_GAMES_FOR_STANDING ? thirdOf(input.rank, input.teamCount) : null
  /*
   * ⚠ A VALUE RANK NEEDS MOST OF THE LEAGUE PRICED. Ranking your roster against two others
   * because nine rosters had no priced players would call a mid team a contender.
   */
  const enoughValued =
    input.valuedTeams != null && input.teamCount != null && input.valuedTeams >= Math.ceil(input.teamCount / 2)
  const value = enoughValued ? thirdOf(input.rosterValueRank, input.valuedTeams) : null

  if (standing == null && value == null) return { status: 'unknown', source: null }
  const sum = (standing ?? 0) + (value ?? 0)
  const status: CompetitiveStatus = sum > 0 ? 'contender' : sum < 0 ? 'rebuild' : 'middle'
  const source: StatusSource =
    standing != null && value != null ? 'standings_and_value' : standing != null ? 'standings' : 'roster_value'
  return { status, source }
}

export const STATUS_SOURCE_LABEL: Record<StatusSource, string> = {
  you: 'you told Chimmy',
  standings: 'from the standings',
  roster_value: 'from roster value',
  standings_and_value: 'from standings and roster value',
}
