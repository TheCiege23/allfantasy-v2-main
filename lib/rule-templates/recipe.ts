/**
 * Rule templates library (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 11) — the template "recipe".
 *
 * Templates already existed (`LeagueTemplate`, "Save as template" in league settings), but the payload
 * was the legacy wizard's shape plus a raw copy of the whole `League.settings` blob, and "Use template"
 * opened `/create-league?template=…`, which nothing read. The live create wizard (V2) was never wired.
 *
 * ⚠ A TEMPLATE IS A RECIPE OF RULES, NOT A COPY OF A LEAGUE. It records the choices a commissioner
 * makes when creating a league — format, team count, scoring preset, draft type, median game, the
 * dynasty and keeper rules — read from the columns and config rows the create pipeline itself writes.
 * Starting from one rebuilds wizard state and runs it through the SAME validation the import path
 * uses (`createStateFromImportedLeague`), so a template can only ever produce a league the wizard
 * could have produced by hand: an option that is not valid for the sport is dropped, never forced.
 *
 * ⚠ AND NOTHING OF THE SOURCE LEAGUE TRAVELS. No name, invite, dues, ratings, chat, roster, lottery
 * result or draft date is in a recipe. That is why a recipe can be shared publicly when the legacy
 * settings copy could not.
 */

import { createStateFromImportedLeague } from '@/lib/create-league-v2/import-template'
import type { CreateLeagueV2State, DynastyRookieOrderMethod, KeeperSetupState } from '@/lib/create-league-v2/state'

export type DynastyRecipe = {
  regularSeasonLength?: number
  rookieDraftOrderMethod?: DynastyRookieOrderMethod
  rookieDraftRounds?: number
  rookieDraftType?: 'linear' | 'snake' | 'auction'
  taxiSlotCount?: number
  taxiEligibilityYears?: number
  futurePickTradeYears?: number
  waiverType?: 'faab' | 'rolling' | 'reverse_standings'
  faabBudget?: number
}

export type KeeperRecipe = Partial<Pick<KeeperSetupState, 'keeperMaxKeepers' | 'keeperMaxYears' | 'keeperRoundPenalty' | 'keeperWaiverAllowed' | 'keeperEligibilityRule'>>

export type TemplateRecipe = {
  v: 2
  sport: string
  leagueType: string | null
  leagueVariant: string | null
  teamCount: number | null
  scoringPresetId: string | null
  draftType: string | null
  medianGame: boolean
  dynasty: DynastyRecipe | null
  keeper: KeeperRecipe | null
}

const ROOKIE_ORDER = new Set<DynastyRookieOrderMethod>(['reverse_standings', 'max_pf', 'lottery', 'weighted_lottery', 'commissioner'])
const WAIVER = new Set(['faab', 'rolling', 'reverse_standings'])
const ELIGIBILITY = new Set(['any', 'drafted_only', 'no_waivers'])

/** A whole number in range, or undefined — out-of-range values are dropped, never clamped into something else. */
const intIn = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined

const compact = <T extends Record<string, unknown>>(o: T): T | null => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
  return Object.keys(out).length ? out : null
}

export type RecipeSource = {
  sport: string
  leagueType: string | null
  leagueVariant: string | null
  leagueSize: number | null
  scoringPresetId: string | null
  medianGame: boolean | null
  draftType: string | null
  dynastyConfig: {
    regularSeasonWeeks: number
    rookiePickOrderMethod: string
    rookieDraftRounds: number
    rookieDraftType: string
    taxiSlots: number
    taxiEligibilityYears: number
    futurePicksYearsOut: number
  } | null
  waiver: { waiverType: string | null; faabBudget: number | null } | null
  keeper: {
    keeperCount: number | null
    keeperMaxYears: number | null
    keeperRoundPenalty: number | null
    keeperWaiverAllowed: boolean | null
    keeperEligibilityRule: string | null
  } | null
}

/** Read a league's rules into a recipe. Pure: the caller loads the rows. */
export function recipeFromLeague(src: RecipeSource): TemplateRecipe {
  const type = String(src.leagueType ?? '').toLowerCase()
  const d = src.dynastyConfig
  const dynasty = d
    ? compact<DynastyRecipe>({
        regularSeasonLength: intIn(d.regularSeasonWeeks, 8, 18),
        rookieDraftOrderMethod: ROOKIE_ORDER.has(d.rookiePickOrderMethod as DynastyRookieOrderMethod) ? (d.rookiePickOrderMethod as DynastyRookieOrderMethod) : undefined,
        rookieDraftRounds: intIn(d.rookieDraftRounds, 1, 10),
        rookieDraftType: d.rookieDraftType === 'linear' || d.rookieDraftType === 'snake' || d.rookieDraftType === 'auction' ? d.rookieDraftType : undefined,
        taxiSlotCount: intIn(d.taxiSlots, 0, 10),
        taxiEligibilityYears: intIn(d.taxiEligibilityYears, 1, 3),
        futurePickTradeYears: intIn(d.futurePicksYearsOut, 1, 5),
        waiverType: src.waiver?.waiverType && WAIVER.has(src.waiver.waiverType) ? (src.waiver.waiverType as DynastyRecipe['waiverType']) : undefined,
        faabBudget: intIn(src.waiver?.faabBudget, 0, 10000),
      })
    : null
  const k = type === 'keeper' ? src.keeper : null
  const keeper = k
    ? compact<KeeperRecipe>({
        keeperMaxKeepers: intIn(k.keeperCount, 0, 15),
        keeperMaxYears: intIn(k.keeperMaxYears, 0, 10),
        keeperRoundPenalty: intIn(k.keeperRoundPenalty, 0, 5),
        keeperWaiverAllowed: typeof k.keeperWaiverAllowed === 'boolean' ? k.keeperWaiverAllowed : undefined,
        keeperEligibilityRule: k.keeperEligibilityRule && ELIGIBILITY.has(k.keeperEligibilityRule) ? (k.keeperEligibilityRule as KeeperRecipe['keeperEligibilityRule']) : undefined,
      })
    : null
  return {
    v: 2,
    sport: String(src.sport),
    leagueType: src.leagueType,
    leagueVariant: src.leagueVariant,
    teamCount: src.leagueSize,
    scoringPresetId: src.scoringPresetId,
    draftType: src.draftType,
    medianGame: src.medianGame === true,
    dynasty,
    keeper,
  }
}

export function readRecipe(payload: unknown): TemplateRecipe | null {
  const r = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).recipe : null
  if (!r || typeof r !== 'object') return null
  const x = r as Partial<TemplateRecipe>
  return x.v === 2 && typeof x.sport === 'string' ? (x as TemplateRecipe) : null
}

/**
 * Templates saved before recipes existed carry only the legacy wizard fields. They still start a
 * league — with the core choices — rather than failing.
 */
export function recipeFromLegacyPayload(payload: unknown): TemplateRecipe | null {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!p || typeof p.sport !== 'string') return null
  return {
    v: 2,
    sport: p.sport,
    leagueType: typeof p.leagueType === 'string' ? p.leagueType : null,
    leagueVariant: typeof p.leagueVariant === 'string' ? p.leagueVariant : null,
    teamCount: typeof p.teamCount === 'number' ? p.teamCount : null,
    scoringPresetId: typeof p.scoringPreset === 'string' ? p.scoringPreset : null,
    draftType: typeof p.draftType === 'string' ? p.draftType : null,
    medianGame: false,
    dynasty: null,
    keeper: null,
  }
}

/**
 * Wizard state for a new league from a recipe. The core goes through the import path's validation;
 * the dynasty and keeper rules are laid on top only when the validated format is that format.
 */
export function stateFromRecipe(recipe: TemplateRecipe): CreateLeagueV2State {
  const base = createStateFromImportedLeague({
    name: null,
    sport: recipe.sport,
    leagueType: recipe.leagueType,
    leagueVariant: recipe.leagueVariant,
    leagueSize: recipe.teamCount,
    scoringPresetId: recipe.scoringPresetId,
    draftType: recipe.draftType,
  })
  const state: CreateLeagueV2State = {
    ...base,
    // The new league gets its own name: smart defaults fill it until the commissioner types one.
    name: '',
    nameTouched: false,
    medianGame: recipe.medianGame,
  }
  const dynastyLike = ['dynasty', 'devy', 'c2c', 'keeper'].includes(String(state.leagueType))
  if (recipe.dynasty && dynastyLike) state.dynasty = { ...state.dynasty, ...recipe.dynasty }
  if (recipe.keeper && state.leagueType === 'keeper') state.keeper = { ...state.keeper, ...recipe.keeper }
  return state
}

const TYPE_LABEL: Record<string, string> = { redraft: 'Redraft', dynasty: 'Dynasty', keeper: 'Keeper', best_ball: 'Best ball', bestball: 'Best ball', guillotine: 'Guilly', devy: 'Devy', c2c: 'C2C', survivor: 'Survivor', salary_cap: 'Salary cap' }
const ORDER_LABEL: Record<DynastyRookieOrderMethod, string> = { reverse_standings: 'reverse standings', max_pf: 'reverse max PF', lottery: 'weighted lottery', weighted_lottery: 'weighted lottery', commissioner: 'commissioner-set' }

/** Short tags for a library card: what the league plays like, in a glance. */
export function describeRecipe(recipe: TemplateRecipe): string[] {
  const type = String(recipe.leagueType ?? 'redraft').toLowerCase()
  const tags = [recipe.sport, TYPE_LABEL[type] ?? type]
  if (String(recipe.leagueVariant ?? '').toLowerCase().includes('idp')) tags.push('IDP')
  if (recipe.teamCount) tags.push(`${recipe.teamCount} teams`)
  const preset = String(recipe.scoringPresetId ?? '').toLowerCase()
  if (preset.includes('superflex') || preset.includes('sf')) tags.push('Superflex')
  if (preset.includes('te_prem') || preset.includes('tep')) tags.push('TE premium')
  if (preset.includes('half')) tags.push('Half PPR')
  else if (preset.includes('ppr')) tags.push('PPR')
  if (recipe.draftType && recipe.draftType !== 'snake') tags.push(`${recipe.draftType} draft`)
  if (recipe.medianGame) tags.push('Median game')
  if (recipe.dynasty?.rookieDraftOrderMethod) tags.push(`Rookie order: ${ORDER_LABEL[recipe.dynasty.rookieDraftOrderMethod]}`)
  if (recipe.dynasty?.waiverType === 'faab') tags.push(recipe.dynasty.faabBudget != null ? `FAAB $${recipe.dynasty.faabBudget}` : 'FAAB')
  if (recipe.dynasty?.taxiSlotCount) tags.push(`${recipe.dynasty.taxiSlotCount} taxi`)
  if (recipe.keeper?.keeperMaxKeepers != null) tags.push(`${recipe.keeper.keeperMaxKeepers} keepers`)
  return tags
}

// ── Sharing ──────────────────────────────────────────────────────────────────

export type ShareMeta = { public: boolean; uses: number; usedBy: string[] }
export const USED_BY_MAX = 500

export function readShare(payload: unknown): ShareMeta {
  const s = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).share : null
  const x = s && typeof s === 'object' ? (s as Partial<ShareMeta>) : {}
  return {
    public: x.public === true,
    uses: typeof x.uses === 'number' && x.uses >= 0 ? Math.floor(x.uses) : 0,
    usedBy: Array.isArray(x.usedBy) ? x.usedBy.filter((u): u is string => typeof u === 'string') : [],
  }
}

/** Count a start from this template once per person; the owner's own starts do not count. */
export function recordUse(share: ShareMeta, userId: string, ownerId: string): ShareMeta | null {
  if (userId === ownerId || share.usedBy.includes(userId)) return null
  return { ...share, uses: share.uses + 1, usedBy: [...share.usedBy, userId].slice(-USED_BY_MAX) }
}
