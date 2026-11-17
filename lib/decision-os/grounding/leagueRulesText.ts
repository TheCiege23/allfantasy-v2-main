import type { CanonicalLeagueRules } from '@/lib/league-runtime/canonicalLeagueRules'

/**
 * THE LEAGUE RULES, AS LINES CHIMMY CAN QUOTE (League OS, 2026-11-16 re-score item 5).
 *
 * 🛑 THE SLICE WAS IN THE PACKET AND NONE OF IT REACHED THE PROMPT. `serialize.ts`'s generic `renderObject` prints
 * a nested object as the word "present", and every field of `CanonicalLeagueRules` that matters is nested — so the
 * prompt read `scoring: present`, `waivers: present`, `trades: present`, and Chimmy guessed PPR, the trade
 * deadline and the FAAB budget from the league's name. This renders the typed ruleset field by field.
 *
 * ⚠ "NOT ON FILE" IS NOT "NONE". A null deadline in an imported league means the importer did not bring one, not
 * that the league has no deadline — so a null prints as not on file, and the model is told not to fill it in.
 *
 * PURE: no IO, no clock. Bounded: the scoring list is capped and its remainder counted.
 */

const MAX_SCORING_RULES = 30

export function isCanonicalLeagueRules(v: unknown): v is CanonicalLeagueRules {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return o.version === 1 && !!o.general && !!o.scoring && !!o.waivers && !!o.trades && !!o.roster && !!o.playoffs
}

const NOT_ON_FILE = 'not on file'
const num = (n: number | null | undefined, unit = '') => (typeof n === 'number' && Number.isFinite(n) ? `${fmt(n)}${unit}` : NOT_ON_FILE)
const text = (s: string | null | undefined) => (typeof s === 'string' && s.trim() ? s.trim() : NOT_ON_FILE)
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "QB, RB×2, WR×3, TE, FLEX" from a slot list; null when the starters are not a list of slot names. */
export function describeStarters(starters: unknown): string | null {
  let slots: string[] | null = null
  if (Array.isArray(starters) && starters.every((s) => typeof s === 'string')) slots = starters as string[]
  else if (starters && typeof starters === 'object' && !Array.isArray(starters)) {
    // A count map: { QB: 1, RB: 2, ... }.
    const entries = Object.entries(starters as Record<string, unknown>).filter(([, n]) => typeof n === 'number' && (n as number) > 0)
    if (entries.length) return entries.map(([k, n]) => ((n as number) > 1 ? `${k}×${n}` : k)).join(', ')
  }
  if (!slots || slots.length === 0) return null
  const order: string[] = []
  const count = new Map<string, number>()
  for (const raw of slots) {
    const s = raw.trim().toUpperCase()
    if (!s || s === 'BN' || s === 'BENCH' || s === 'IR' || s === 'TAXI') continue
    if (!count.has(s)) order.push(s)
    count.set(s, (count.get(s) ?? 0) + 1)
  }
  return order.length ? order.map((s) => (count.get(s)! > 1 ? `${s}×${count.get(s)}` : s)).join(', ') : null
}

/** Points per reception, and the conventional name for it. Null when the league scores no reception rule. */
export function receptionScoring(rules: CanonicalLeagueRules['scoring']['activeRules']): string | null {
  const rec = rules.find((r) => r.statKey === 'rec' || r.statKey === 'receptions')
  if (!rec) return null
  const p = rec.pointsValue
  const name = p === 1 ? 'full PPR' : p === 0.5 ? 'half PPR' : p === 0 ? 'standard (no PPR)' : `${fmt(p)} per reception`
  return `${fmt(p)} pts per reception (${name})`
}

export function renderLeagueRules(r: CanonicalLeagueRules): string[] {
  const lines: string[] = []
  const g = r.general
  lines.push(
    `    League: ${text(g.name)} — ${g.sport} ${g.season ?? ''}`.trimEnd() +
      `, format ${text(g.format)}${g.variant ? ` (${g.variant})` : ''}, ${num(g.teamCount)} teams` +
      `${g.locked ? ', settings LOCKED' : ''}${g.emergencyPaused ? ', league PAUSED' : ''}.`,
  )

  // Scoring — the line Chimmy most often guessed.
  const s = r.scoring
  const rec = receptionScoring(s.activeRules)
  lines.push(
    `    Scoring: preset ${text(s.presetId ?? s.templateId)}${rec ? `; ${rec}` : '; no reception rule on file'}` +
      `; ${s.activeRuleCount} active rule${s.activeRuleCount === 1 ? '' : 's'}, ${s.overriddenRuleCount} changed by the commissioner.`,
  )
  const ranked = [...s.activeRules].filter((x) => x.pointsValue !== 0)
  if (ranked.length) {
    const shown = ranked.slice(0, MAX_SCORING_RULES)
    const more = ranked.length > shown.length ? `, and ${ranked.length - shown.length} more` : ''
    lines.push(`    Scoring rules (stat = points${shown.some((x) => x.isOverridden) ? ', * = commissioner override' : ''}): ` +
      shown.map((x) => `${x.statKey}=${fmt(x.pointsValue)}${x.isOverridden ? '*' : ''}`).join(', ') + more + '.')
  }

  // Roster.
  const ro = r.roster
  const starters = describeStarters(ro.starters)
  lines.push(
    `    Roster: ${num(ro.size)} spots; starters ${starters ?? NOT_ON_FILE}; IR slots ${ro.irSlots}` +
      `${ro.lockAllMoves ? '; ALL roster moves locked' : ''}${ro.preventBenchDrops ? '; bench drops blocked' : ''}.`,
  )

  // Waivers and FAAB.
  const w = r.waivers
  const days = w.processingDays.length ? w.processingDays.map((d) => DAYS[d] ?? String(d)).join('/') : null
  lines.push(
    `    Waivers: ${text(w.type)}${w.continuous ? ', continuous' : ''}` +
      `${days ? `, processed ${days}` : ''}${w.processingTimeLocal ? ` at ${w.processingTimeLocal} league time` : w.processingTimeUtc ? ` at ${w.processingTimeUtc} UTC` : ''}` +
      (w.faabEnabled
        ? `; FAAB budget ${num(w.faabBudget)}, minimum bid ${num(w.faabMinBid)}${w.faabResetRules ? `, resets each: ${w.faabResetRules}` : ''}`
        : '; no FAAB') +
      `${w.tiebreakRule ? `; ties broken by ${w.tiebreakRule}` : ''}.`,
  )

  // Trades.
  const t = r.trades
  lines.push(
    `    Trades: deadline ${t.deadlineWeek != null ? `week ${t.deadlineWeek}` : NOT_ON_FILE}` +
      `; review period ${t.reviewHours != null ? `${fmt(t.reviewHours)} hours` : NOT_ON_FILE}` +
      `; draft picks ${t.draftPickTrading ? 'can' : 'cannot'} be traded.`,
  )

  // Playoffs and schedule.
  const p = r.playoffs
  lines.push(
    `    Playoffs: ${num(p.teamCount)} teams from week ${num(p.startWeek)}, ${num(p.weeksPerRound)} week(s) per round` +
      `, ${p.firstRoundByes} first-round bye${p.firstRoundByes === 1 ? '' : 's'}` +
      `${p.consolationBracketEnabled ? ', consolation bracket' : ''}${p.thirdPlaceGameEnabled ? ', third-place game' : ''}` +
      `${p.toiletBowlEnabled ? ', toilet bowl' : ''}` +
      `${p.standingsTiebreakers.length ? `; standings tiebreakers: ${p.standingsTiebreakers.join(' > ')}` : ''}.`,
  )
  if (r.schedule.regularSeasonLength != null) {
    lines.push(`    Regular season: ${r.schedule.regularSeasonLength} weeks.`)
  }
  lines.push(`    Draft: ${text(r.draft.type)}, ${num(r.draft.rounds)} rounds${r.draft.pickTradingEnabled ? ', picks tradeable' : ''}.`)
  lines.push(
    `    RULES: quote these settings exactly. A setting "${NOT_ON_FILE}" is unknown to AllFantasy — say so; never fill it in from what leagues usually do (no assumed PPR, no assumed deadline, no assumed FAAB).`,
  )
  return lines
}
