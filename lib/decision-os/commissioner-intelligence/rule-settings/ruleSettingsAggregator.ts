/**
 * Commissioner Intelligence Platform — Phase 6: Rule / Settings aggregator.
 *
 * Pure, deterministic. Given a league's NORMALIZED settings (+ per-sport
 * defaults), it returns the display-only `CommissionerRuleSettingsV1`. No I/O,
 * no Prisma, no LLM. It DESCRIBES configuration and flags only OBJECTIVE
 * inconsistencies — it never judges the rules or recommends changes. All
 * thresholds are documented constants.
 */

import {
  COMMISSIONER_RULE_SETTINGS_VERSION,
  type CommissionerRuleSettingsV1,
  type Complexity,
  type LeagueFormat,
  type PlayoffConfiguration,
  type RuleSettingsInput,
  type TransactionPolicy,
} from './types'

const STANDARD_PLAYOFF_SIZES = new Set([2, 4, 6, 8, 10, 12, 14, 16])

// ── advanced-flag derivation (case-insensitive; deterministic) ───────────────
interface AdvancedFlags {
  superflex: boolean
  idp: boolean
  tePremium: boolean
  keeper: boolean
  dynasty: boolean
  devy: boolean
  c2c: boolean
  salaryCap: boolean
}

function deriveFlags(input: RuleSettingsInput): AdvancedFlags {
  const slotKeys = Object.keys(input.starterSlots ?? {}).map((k) => k.trim().toUpperCase())
  const lt = String(input.leagueType ?? '').toLowerCase()

  const superflex = slotKeys.some((k) => k === 'SF' || k === 'SUPERFLEX' || k === 'SUPER_FLEX')
  const idp =
    lt.includes('idp') ||
    slotKeys.some((k) => k.includes('IDP') || k === 'DL' || k === 'LB' || k === 'DB' || k === 'EDGE')

  // TE premium: a TE position multiplier > 1, or a preset id that names it.
  const posMult = asRecord(asRecord(input.scoringRules)?.positionMultipliers)
  const teMult = Number(posMult?.TE ?? posMult?.te)
  const fmt = String(input.scoringFormat ?? '').toLowerCase()
  const tePremium = (Number.isFinite(teMult) && teMult > 1) || fmt.includes('tep') || fmt.includes('te_prem')

  return {
    superflex,
    idp,
    tePremium,
    keeper: lt.includes('keeper'),
    dynasty: lt.includes('dynasty'),
    devy: lt.includes('devy') || (input.devyCollegeSlots ?? 0) > 0,
    c2c: lt.includes('c2c') || lt.includes('couch'),
    salaryCap: lt.includes('salary') || lt.includes('auction'),
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function countTrue(...vals: boolean[]): number {
  return vals.filter(Boolean).length
}
function normFmt(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

// ── classifiers ──────────────────────────────────────────────────────────────
function classify(input: RuleSettingsInput, flags: AdvancedFlags) {
  const d = input.defaults
  const rosterDiffers =
    (d?.benchSlots != null && input.benchSlots !== d.benchSlots) ||
    (d?.irSlots != null && input.irSlots !== d.irSlots) ||
    (d?.starterCount != null && Object.values(input.starterSlots ?? {}).reduce((a, b) => a + b, 0) !== d.starterCount) ||
    input.taxiSlots > 0
  const scoringDiffers = !!input.scoringFormat && !!d?.scoringFormat && normFmt(input.scoringFormat) !== normFmt(d.scoringFormat)
  const playoffDiffers = input.playoffTeams != null && d?.playoffTeams != null && input.playoffTeams !== d.playoffTeams
  const waiverDiffers = !!input.waiverType && !!d?.waiverType && input.waiverType.toLowerCase() !== d.waiverType.toLowerCase()

  const advancedCount = countTrue(flags.superflex, flags.idp, flags.tePremium, flags.keeper, flags.dynasty, flags.devy, flags.c2c, flags.salaryCap)

  const reviewed =
    (!!input.tradeReviewMode && /commission|vote|review|approv/i.test(input.tradeReviewMode)) ||
    (input.tradeReviewHours != null && input.tradeReviewHours > 0)
  const restricted = reviewed && input.tradeDeadlineWeek != null

  const leagueFormat: LeagueFormat = !input.hasSettings
    ? 'unknown'
    : advancedCount >= 2
      ? 'advanced'
      : advancedCount === 1 || rosterDiffers || scoringDiffers || playoffDiffers || waiverDiffers || reviewed
        ? 'custom'
        : 'standard'

  const rosterAdvanced = countTrue(flags.superflex, flags.idp, flags.devy, input.taxiSlots > 0)
  const rosterComplexity: Complexity = !input.hasSettings
    ? 'unknown'
    : rosterAdvanced >= 2
      ? 'complex'
      : rosterAdvanced === 1 || rosterDiffers
        ? 'moderate'
        : 'simple'

  const scoringMode = String(input.scoringMode ?? '').toLowerCase()
  const scoringComplexity: Complexity = !input.hasSettings
    ? 'unknown'
    : flags.idp || (scoringMode !== '' && scoringMode !== 'points')
      ? 'complex'
      : flags.tePremium || scoringDiffers
        ? 'moderate'
        : 'simple'

  const transactionPolicy: TransactionPolicy = !input.hasSettings ? 'unknown' : restricted ? 'restricted' : reviewed ? 'reviewed' : 'open'

  // Playoff: needs_review ONLY for an objective, deterministic inconsistency —
  // playoff teams cannot exceed the number of teams. (Do NOT flag playoffStartWeek
  // relative to regular-season length: playoffs legitimately start afterward.)
  const playoffInconsistent = input.leagueTeamCount != null && input.playoffTeams != null && input.playoffTeams > input.leagueTeamCount
  const playoffOdd = input.playoffTeams != null && !STANDARD_PLAYOFF_SIZES.has(input.playoffTeams)
  const playoffCustom = playoffDiffers || playoffOdd || (!!input.playoffSeedingRule && input.playoffSeedingRule.toLowerCase() !== 'default')
  const playoffConfiguration: PlayoffConfiguration =
    !input.hasSettings || input.playoffTeams == null ? 'unknown' : playoffInconsistent ? 'needs_review' : playoffCustom ? 'custom' : 'standard'

  return { leagueFormat, rosterComplexity, scoringComplexity, transactionPolicy, playoffConfiguration, reviewed, playoffInconsistent }
}

// ── neutral highlights + summary (describe, never judge) ─────────────────────
function scoringLabel(input: RuleSettingsInput): string | null {
  if (String(input.scoringMode ?? '').toLowerCase() === 'h2h_category') return 'Category scoring'
  if (String(input.scoringMode ?? '').toLowerCase() === 'roto') return 'Roto scoring'
  const f = normFmt(input.scoringFormat)
  if (f.includes('halfppr')) return 'Half-PPR scoring'
  if (f.includes('ppr')) return 'PPR scoring'
  if (f.includes('standard')) return 'Standard scoring'
  return input.scoringFormat ? `${input.scoringFormat} scoring` : null
}
function waiverLabel(input: RuleSettingsInput): string | null {
  const w = String(input.waiverType ?? '').toLowerCase()
  if (!w) return null
  if (w.includes('faab')) return 'FAAB waivers'
  if (w.includes('rolling')) return 'Rolling waivers'
  if (w.includes('reverse')) return 'Reverse-standings waivers'
  if (w.includes('fcfs')) return 'First-come waivers'
  return `${input.waiverType} waivers`
}
function buildHighlights(input: RuleSettingsInput, flags: AdvancedFlags, reviewed: boolean): string[] {
  const h: string[] = []
  if (input.leagueTeamCount != null) h.push(`${input.leagueTeamCount}-team league`)
  const s = scoringLabel(input)
  if (s) h.push(s)
  const w = waiverLabel(input)
  if (w) h.push(w)
  if (flags.dynasty) h.push('Dynasty league')
  else if (flags.keeper) h.push('Keeper league')
  if (flags.superflex) h.push('Superflex')
  if (flags.tePremium) h.push('TE premium')
  if (flags.idp) h.push('IDP')
  if (flags.devy) h.push('Devy')
  if (flags.c2c) h.push('College-to-couch')
  if (flags.salaryCap) h.push('Salary cap')
  if (reviewed) h.push(input.tradeReviewHours != null && input.tradeReviewHours > 0 ? `Reviewed trade process (${input.tradeReviewHours}h)` : 'Reviewed trade process')
  if (input.playoffTeams != null) h.push(`${input.playoffTeams} playoff teams`)
  return h.slice(0, 6)
}
function formatWord(f: LeagueFormat): string {
  if (f === 'advanced') return 'an advanced configuration'
  if (f === 'custom') return 'a custom configuration'
  if (f === 'standard') return 'a standard configuration'
  return 'a configuration'
}

export function aggregateCommissionerRuleSettings(
  input: RuleSettingsInput,
  now: Date = new Date(),
): CommissionerRuleSettingsV1 {
  const flags = deriveFlags(input)
  const c = classify(input, flags)
  const highlights = input.hasSettings ? buildHighlights(input, flags, c.reviewed) : []

  const caveats: string[] = []
  if (!input.hasSettings) {
    caveats.push("This league's settings aren't available to summarize yet.")
  } else if (input.source === 'defaults') {
    caveats.push('Some values fall back to the format default (no league-configured value found).')
  }
  if (c.playoffInconsistent) {
    caveats.push('Playoff team count exceeds the number of teams — worth a look.')
  }

  const summary = !input.hasSettings
    ? "This league's configuration isn't available to summarize yet."
    : highlights.length > 0
      ? `This league uses ${formatWord(c.leagueFormat)}. It includes ${joinList(highlights.slice(0, 3))}.`
      : `This league uses ${formatWord(c.leagueFormat)}.`

  return {
    version: COMMISSIONER_RULE_SETTINGS_VERSION,
    derivedAt: now.toISOString(),
    leagueFormat: c.leagueFormat,
    rosterComplexity: c.rosterComplexity,
    scoringComplexity: c.scoringComplexity,
    transactionPolicy: c.transactionPolicy,
    playoffConfiguration: c.playoffConfiguration,
    settingsHighlights: highlights,
    caveats,
    summary,
    source: input.source,
  }
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
