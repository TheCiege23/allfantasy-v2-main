import type { TeamStance } from '@/lib/trade-value/types'
import type { FairnessBand } from '@/lib/trade-discovery/redraftTradeDiscovery'

/**
 * "Should I trade for X?" — yes or no, and why. Pure: every fact arrives already read.
 *
 * ── 🛑 THE VERDICT IS COMPUTED HERE, NEVER BY A MODEL ─────────────────────────────────────────
 * The product rule (2026-08-20) is that a decision with roster or money consequences is
 * explanation-only for AI: a model may phrase it, never author it. This file is the author. The
 * route returns its sentences as they are.
 *
 * ── WHAT IT WEIGHS, IN THE ORDER A MANAGER WOULD ────────────────────────────────────────────
 *   1. Can he be traded for at all — a no-trade league, or no package your roster can make.
 *   2. Does he start for you: this week's projection under THIS league's scoring, the lineup with
 *      him against the lineup without him.
 *   3. Where your team stands — a rebuilding team does not buy a veteran for this season.
 *   4. What it costs — the package the trade finder would open with, and the engine's grade of it.
 *   5. Whether paying that price still leaves your lineup better this week.
 *   6. Dynasty only: a young or rising player can be worth it even when he does not start yet.
 *
 * ⚠ IT ALWAYS DECIDES. The user asked for "yes because" or "no because", not a list of
 * considerations. When a fact is missing the rule that needs it is skipped and the answer says the
 * fact was missing — it never guesses the fact.
 */

export type TradeTargetLineup =
  | {
      status: 'priced'
      /** The projection week the points are for. */
      week: number
      /** His projected points this week under the league's scoring. */
      targetPoints: number | null
      /** Starting points gained if he joined for nothing. Zero or less: he would not start. */
      addGain: number
      /** Starting points gained after sending the suggested package. Null when there is no package or it could not be priced. */
      netGain: number | null
      /** Why `netGain` is null despite a package, in a manager's words. */
      netBlocked: string | null
      /** The starter he would replace this week, when he starts. */
      replaces: string | null
    }
  | { status: 'unavailable'; detail: string }

export type TradeTargetOfferAsset = { name: string; position: string | null; value: number | null }

export type TradeTargetFacts = {
  leagueName: string
  target: {
    name: string
    position: string | null
    value: number | null
    trend30Day: number | null
    age: number | null
  }
  mode: 'dynasty' | 'redraft'
  you: {
    stance: TeamStance
    record: { wins: number; losses: number; ties: number } | null
    rank: number | null
    teamCount: number | null
    needs: string[]
    surpluses: string[]
  }
  partner: { teamName: string; stance: TeamStance }
  lineup: TradeTargetLineup
  /** The package the trade finder would open with. Null when it could build none. */
  offer: {
    give: TradeTargetOfferAsset[]
    giveTotal: number
    receiveTotal: number
    fairness: FairnessBand
  } | null
  /** The trade engine's grade of that package, when it answered in time. */
  grade: { verdict: 'accept' | 'reject' | 'counter'; acceptance: number | null } | null
  /** Set when the league does not allow trades at all, with the waiver advice when there is any. */
  noTrades: { waiverNote: string | null } | null
}

export type TradeTargetVerdict = {
  verdict: 'yes' | 'no'
  /** "Yes, trade for Rashee Rice" / "No, don't trade for Rashee Rice". */
  headline: string
  /** The deciding reason, as the clause after "because". */
  because: string
  /** The facts behind it, one line each. */
  reasons: string[]
  /** The package to open with — only on a yes. */
  openWith: string | null
  /** What the answer rests on, and what it could not see. */
  basis: string[]
}

/*
 * Young enough that a dynasty team buys him for the years ahead, whatever this week says.
 * Presentation thresholds, not a model: running backs age first, quarterbacks last.
 */
const YOUNG_MAX_AGE: Record<string, number> = { RB: 24, WR: 25, TE: 25, QB: 27 }

function youngOrRising(t: TradeTargetFacts['target']): boolean {
  const limit = t.position ? YOUNG_MAX_AGE[t.position.toUpperCase()] : undefined
  const young = t.age != null && limit != null && t.age <= limit
  const rising = t.trend30Day != null && t.trend30Day > 0
  return young || rising
}

/** "Draft Junkies'", "King Gingerbeards SF 2026's". */
const possessive = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`)
const fmtPts = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function recordText(you: TradeTargetFacts['you']): string | null {
  const r = you.record
  if (!r || r.wins + r.losses + r.ties === 0) return null
  const wl = `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`
  const place = you.rank != null && you.teamCount ? `, ${ordinal(you.rank)} of ${you.teamCount}` : ''
  return `${wl}${place}`
}

const STANCE_PHRASE: Record<TeamStance, string> = {
  contender: 'contending',
  middle: 'in the middle of the pack',
  rebuilder: 'rebuilding',
}

/*
 * ── 🛑 ONE GAME IS NOT A SEASON ───────────────────────────────────────────────────────────────
 *
 * The stance arrives from `buildTeamProfile`, which is win percentage and nothing else: 0-1 is a
 * .000 team and reads as "rebuilding". Measured on production 2026-09-17 in the owner's Draft
 * Junkies league: "No, don't trade for Rashee Rice, because you are rebuilding at 0-1, 12th of 12"
 * — the answer turned on one result, while Rice would have started for +7.2 points at a fair price.
 *
 * So the record decides nothing until this many games are played, and the answer says so. Every
 * team in a league has played about the same number of games, so the asker's count stands in for
 * the partner's too. A presentation threshold, not a model.
 */
const MIN_GAMES_FOR_STANCE = 4

function gamesPlayed(you: TradeTargetFacts['you']): number {
  const r = you.record
  return r ? r.wins + r.losses + r.ties : 0
}

function teamLine(you: TradeTargetFacts['you'], settled: boolean): string {
  const rec = recordText(you)
  if (!rec) return 'Your team: no games played yet, so your record does not tilt this either way.'
  if (!settled) return `Your team: ${rec} — too early in the season to call you a contender or a rebuilder.`
  return `Your team: ${rec} — ${STANCE_PHRASE[you.stance]}.`
}

function lineupLine(facts: TradeTargetFacts): string {
  const l = facts.lineup
  const name = facts.target.name
  if (l.status === 'unavailable') return `Lineup: not computed — ${l.detail}.`
  const pts = l.targetPoints != null ? ` (${l.targetPoints.toFixed(1)} projected)` : ''
  if (l.addGain <= 0) {
    return `Lineup: ${name}${pts} would not crack your week ${l.week} lineup under ${possessive(facts.leagueName)} scoring — your starters already project higher at his slots.`
  }
  const over = l.replaces ? ` over ${l.replaces}` : ''
  let line = `Lineup: ${name}${pts} would start for you${over} — ${fmtPts(l.addGain)} points in week ${l.week} under ${possessive(facts.leagueName)} scoring.`
  if (l.netGain != null) {
    line += ` After sending the package below, your lineup moves ${fmtPts(l.netGain)}.`
  } else if (l.netBlocked) {
    line += ` The lineup after paying for him could not be priced: ${l.netBlocked}.`
  }
  return line
}

function needLine(facts: TradeTargetFacts): string | null {
  const pos = facts.target.position?.toUpperCase()
  if (!pos) return null
  if (facts.you.needs.includes(pos)) return `Need: ${pos} is a hole on your roster.`
  if (facts.you.surpluses.includes(pos)) return `Need: you are already deep at ${pos}.`
  return null
}

function assetList(give: TradeTargetOfferAsset[]): string {
  const names = give.map((a) => a.name)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const FAIRNESS_PHRASE: Record<FairnessBand, string> = {
  balanced: 'a fair deal',
  'slight edge you': 'a slight edge to you',
  'slight edge partner': 'a slight overpay by you',
  lopsided: 'a big value gap',
  'low confidence': 'a deal the values cannot price with confidence',
}

/*
 * No market value for him in this format. The package finder still returns something — a bench
 * body "for his 0" — and the engine will grade it, but a price built on a missing value is not a
 * price. Measured on staging 2026-09-17: "about Chig Okonkwo (85) for his 0 … a good offer".
 */
const unpricedTarget = (facts: TradeTargetFacts) => facts.target.value == null || facts.target.value <= 0

function priceLine(facts: TradeTargetFacts): string | null {
  if (unpricedTarget(facts)) {
    return `Price: the market has no value for ${facts.target.name} in this league's format, so no package can be priced.`
  }
  const o = facts.offer
  if (!o) return null
  let line = `Price: about ${assetList(o.give)} (${fmtInt(o.giveTotal)}) for his ${fmtInt(o.receiveTotal)} — ${FAIRNESS_PHRASE[o.fairness]}.`
  const g = facts.grade
  if (g) {
    const odds = g.acceptance != null ? `, about ${Math.round(g.acceptance * 100)}% they accept` : ''
    const word = g.verdict === 'accept' ? 'a good offer' : g.verdict === 'reject' ? 'a bad offer for you' : 'an opening offer they will counter'
    line += ` The trade engine calls it ${word}${odds}.`
  }
  return line
}

function marketLine(facts: TradeTargetFacts): string | null {
  const t = facts.target
  if (t.value == null) return null
  const parts = [`${facts.mode === 'dynasty' ? 'Dynasty' : 'Redraft'} value ${fmtInt(t.value)}`]
  if (t.trend30Day != null && t.trend30Day !== 0) {
    parts.push(`${t.trend30Day > 0 ? 'up' : 'down'} ${fmtInt(Math.abs(t.trend30Day))} over 30 days`)
  }
  if (t.age != null) parts.push(`age ${t.age}`)
  return `Market: ${parts.join(', ')}.`
}

function partnerLine(facts: TradeTargetFacts, settled: boolean): string {
  const p = facts.partner
  if (!settled) return `His team: ${p.teamName} — too early in the season to tell whether they are buying or selling.`
  const tail =
    p.stance === 'rebuilder'
      ? 'a team likely to sell a veteran'
      : p.stance === 'contender'
        ? 'they will want starters back, not futures'
        : 'no strong reason to sell or to hold'
  return `His team: ${p.teamName} is ${STANCE_PHRASE[p.stance]} — ${tail}.`
}

export function decideTradeTarget(facts: TradeTargetFacts): TradeTargetVerdict {
  const name = facts.target.name
  const pos = facts.target.position?.toUpperCase() ?? null
  const dynastyFuture = facts.mode === 'dynasty' && youngOrRising(facts.target)
  const lineup = facts.lineup
  const priced = lineup.status === 'priced' ? lineup : null
  const rec = recordText(facts.you)
  const settled = gamesPlayed(facts.you) >= MIN_GAMES_FOR_STANCE
  /* Before the record means anything, nobody is contending or rebuilding. */
  const stance: TeamStance = settled ? facts.you.stance : 'middle'

  const reasons = [
    lineupLine(facts),
    teamLine(facts.you, settled),
    needLine(facts),
    priceLine(facts),
    marketLine(facts),
    partnerLine(facts, settled),
  ].filter((r): r is string => Boolean(r))

  const basis: string[] = []
  if (priced) basis.push(`Week ${priced.week} projections scored under ${possessive(facts.leagueName)} own rules.`)
  else basis.push(`No lineup projection: ${lineup.status === 'unavailable' ? lineup.detail : 'unavailable'}.`)
  basis.push(`${facts.mode === 'dynasty' ? 'Dynasty' : 'Redraft'} market values in this league's format.`)
  if (!facts.grade && facts.offer && !unpricedTarget(facts)) basis.push('The trade engine did not grade the package in time.')

  const no = (because: string): TradeTargetVerdict => ({
    verdict: 'no',
    headline: `No, don't trade for ${name}`,
    because,
    reasons,
    openWith: null,
    basis,
  })
  const yes = (because: string): TradeTargetVerdict => ({
    verdict: 'yes',
    headline: `Yes, trade for ${name}`,
    because,
    reasons,
    openWith: facts.offer ? assetList(facts.offer.give) : null,
    basis,
  })

  // 1. Can he be traded for at all.
  if (facts.noTrades) {
    const v = no(`this league does not allow trades`)
    // The price and package lines describe a deal that cannot be sent; the waiver advice replaces them.
    v.reasons = [
      ...(facts.noTrades.waiverNote ? [`Waivers: ${facts.noTrades.waiverNote}`] : []),
      marketLine(facts),
    ].filter((r): r is string => Boolean(r))
    return v
  }
  if (unpricedTarget(facts)) {
    return no(`the market has no value for him in this league's format, so there is no fair price to build a trade on`)
  }
  if (!facts.offer) {
    return no(`nothing on your roster lines up with his value without costing you a starter you need`)
  }

  // 2. Does he start for you.
  if (priced && priced.addGain <= 0 && !dynastyFuture) {
    return no(`he would not start for you — your lineup already projects more at his slots this week`)
  }

  // 3. Where your team stands.
  if (stance === 'rebuilder' && !dynastyFuture) {
    return no(
      `you are rebuilding${rec ? ` at ${rec}` : ''}, and ${facts.mode === 'dynasty' ? 'he is not young or rising enough to be part of the next contending team' : 'a redraft season spent buying help is a season already gone'}`,
    )
  }

  // 4. What it costs.
  if (facts.grade?.verdict === 'reject') {
    return no(`the package it would take (${assetList(facts.offer.give)}) costs more than he is worth to you`)
  }
  if (facts.offer.fairness === 'lopsided' && facts.offer.receiveTotal < facts.offer.giveTotal) {
    return no(`you would have to overpay — about ${fmtInt(facts.offer.giveTotal)} for his ${fmtInt(facts.offer.receiveTotal)}`)
  }

  // 5. Paying the price must still leave your lineup better, when this season is what you are playing for.
  if (priced && priced.netGain != null && priced.netGain < 0 && (facts.mode === 'redraft' || stance === 'contender')) {
    return no(`paying for him leaves your lineup ${fmtPts(priced.netGain)} worse this week — you would be trading starters for a starter`)
  }

  // The case for yes.
  if (priced && priced.addGain > 0) {
    const standing =
      stance === 'contender'
        ? ` and you are contending${rec ? ` at ${rec}` : ''}`
        : stance === 'rebuilder'
          ? ` and, at his age and trend, he fits your rebuild`
          : ''
    return yes(`he would start for you (${fmtPts(priced.addGain)} points in week ${priced.week})${standing}, at a price your roster can pay`)
  }
  if (pos && facts.you.needs.includes(pos)) {
    return yes(`${pos} is a hole on your roster and he fills it at a price your roster can pay`)
  }
  if (dynastyFuture) {
    return yes(`he is ${facts.target.age != null ? `${facts.target.age} and ` : ''}${(facts.target.trend30Day ?? 0) > 0 ? 'rising' : 'young enough to hold value'} — a dynasty buy even before he starts for you`)
  }

  return no(
    priced
      ? `he does not improve your lineup or fill a need`
      : `he does not fill a need on your roster, and his effect on your lineup could not be computed`,
  )
}

/** The answer as Chimmy says it. */
export function renderTradeTargetVerdict(v: TradeTargetVerdict): string {
  const lines = [`${v.headline}, because ${v.because}.`, '', ...v.reasons.map((r) => `• ${r}`)]
  if (v.openWith) lines.push('', `Open with: ${v.openWith}.`)
  lines.push('', `Based on: ${v.basis.join(' ')}`)
  return lines.join('\n')
}
