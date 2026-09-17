/**
 * DYNASTY TRADE ANALYZER / FINDER — pure, deterministic. No AI, no fabrication.
 *
 * analyzeDynastyTrade(): compares outgoing vs incoming using dynasty asset VALUE,
 * AGE-trajectory adjustment, roster-fit, AND real future-pick capital. Dynasty
 * horizon — value is long-term, not weekly. Picks are priced by their deterministic
 * structural tier (round + seasons-out), never a fabricated market value. When no
 * value signal exists for the involved assets the verdict is 'needs_more_data'.
 *
 * findDynastyTradeTargets(): ranks partners by complementary needs/surplus AND
 * contention windows — contenders pair with rebuilders (win-now vets ↔ youth/picks),
 * surfacing player-for-pick / pick-for-player angles when pick capital is asymmetric.
 */

import { dynastyValue, ageTrajectory, type AgeTrajectory } from './dynastyPlayerValue'
import { evaluateDynastyTeamNeeds } from './dynastyRosterNeedsEngine'
import { evaluateDynastyTeamDirection } from './dynastyTeamDirectionEngine'
import { summarizePickCapital } from './dynastyPickValueEngine'
import type { DynastyFuturePick, DynastyPlayerFact, DynastyWarRoomContext } from './types'

export type DynastyTradeVerdict = 'accept' | 'reject' | 'neutral' | 'needs_more_data'

export interface DynastyTradeAnalysis {
  verdict: DynastyTradeVerdict
  /** Incoming - outgoing age-adjusted value delta from the USER's perspective. */
  valueDelta: number | null
  rosterFitDelta: number
  ageImpact: string[]
  /** Notes about draft picks included in the trade (priced by structural tier). */
  pickImpact: string[]
  directionImpact: string | null
  riskFlags: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

export interface DynastyTradeTarget {
  rosterId: string
  teamName: string | null
  fitScore: number
  theySupply: string[]
  theyNeed: string[]
  windowFit: string | null
  reasons: string[]
}

export interface DynastyTradeFinderResult {
  rosterId: string
  targets: DynastyTradeTarget[]
  missingDataFlags: string[]
  needsMoreData: boolean
}

/** Age-adjusted value: nudge value by trajectory so youth is worth a premium in dynasty. */
function ageAdjustedValue(p: DynastyPlayerFact): number | null {
  const v = dynastyValue(p)
  if (v.source === 'none') return null
  const traj: AgeTrajectory = ageTrajectory(p.position, p.age)
  const mult =
    traj === 'ascending' ? 1.15 : traj === 'prime' ? 1.0 : traj === 'aging' ? 0.85 : traj === 'cliff' ? 0.65 : 1.0
  return Math.round(v.value * mult * 100) / 100
}

function findPlayers(context: DynastyWarRoomContext, ids: string[]): DynastyPlayerFact[] {
  const all = context.teams.flatMap((t) => t.players)
  return ids.map((id) => all.find((p) => p.playerId === id)).filter((p): p is DynastyPlayerFact => Boolean(p))
}

function findPicks(context: DynastyWarRoomContext, ids: string[]): DynastyFuturePick[] {
  const all = context.teams.flatMap((t) => t.picks)
  return ids.map((id) => all.find((pk) => pk.id === id)).filter((pk): pk is DynastyFuturePick => Boolean(pk))
}

function pickLabel(pk: DynastyFuturePick): string {
  return `${pk.season} R${pk.round}`
}

export interface AnalyzeDynastyTradeInput {
  rosterId: string
  outgoingPlayerIds: string[]
  incomingPlayerIds: string[]
  /** Pick identifiers included on either side — unpriced (provider-limited), flagged only. */
  outgoingPickIds?: string[]
  incomingPickIds?: string[]
}

export function analyzeDynastyTrade(
  context: DynastyWarRoomContext,
  input: AnalyzeDynastyTradeInput,
): DynastyTradeAnalysis {
  const missingDataFlags = [...context.missingDataFlags]
  const facts: string[] = []
  const riskFlags: string[] = []
  const ageImpact: string[] = []
  const pickImpact: string[] = []

  const outgoing = findPlayers(context, input.outgoingPlayerIds)
  const incoming = findPlayers(context, input.incomingPlayerIds)
  const outgoingPicks = findPicks(context, input.outgoingPickIds ?? [])
  const incomingPicks = findPicks(context, input.incomingPickIds ?? [])

  if (outgoing.length === 0 && incoming.length === 0 && outgoingPicks.length === 0 && incomingPicks.length === 0) {
    return {
      verdict: 'needs_more_data',
      valueDelta: null,
      rosterFitDelta: 0,
      ageImpact: [],
      pickImpact: [],
      directionImpact: null,
      riskFlags: [],
      explanationFacts: ['No players or picks resolved for this trade.'],
      missingDataFlags,
    }
  }

  // Picks priced by deterministic structural tier (round + seasons-out) — not market.
  // A partial list still prices the picks it names; an own pick it cannot name stays unresolved below.
  const picksAvailable =
    context.availability.futurePicks === 'available' || context.availability.futurePicks === 'partial'
  const requestedPickIds = (input.outgoingPickIds?.length ?? 0) + (input.incomingPickIds?.length ?? 0)
  if (requestedPickIds > 0 && !picksAvailable) {
    riskFlags.push('Pick capital is not tracked for this league — picks in this trade are excluded from the value delta.')
  } else if (requestedPickIds > 0 && requestedPickIds !== outgoingPicks.length + incomingPicks.length) {
    riskFlags.push('Some referenced picks could not be resolved and were excluded.')
  }
  const outPickValues = outgoingPicks.map((pk) => pk.estValue)
  const inPickValues = incomingPicks.map((pk) => pk.estValue)
  for (const pk of incomingPicks) pickImpact.push(`Acquiring ${pickLabel(pk)} pick${pk.estValue != null ? ` (tier ${pk.estValue.toFixed(1)})` : ''}.`)
  for (const pk of outgoingPicks) pickImpact.push(`Sending ${pickLabel(pk)} pick${pk.estValue != null ? ` (tier ${pk.estValue.toFixed(1)})` : ''}.`)

  const outValues = [...outgoing.map(ageAdjustedValue), ...outPickValues]
  const inValues = [...incoming.map(ageAdjustedValue), ...inPickValues]
  const haveAllValues = [...outValues, ...inValues].every((v) => v != null)
  const haveAnyValue = [...outValues, ...inValues].some((v) => v != null)

  let valueDelta: number | null = null
  if (haveAnyValue) {
    const inSum = inValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    const outSum = outValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    valueDelta = Math.round((inSum - outSum) * 100) / 100
    const pickNote = outgoingPicks.length + incomingPicks.length > 0 ? ' (incl. pick tiers)' : ''
    facts.push(
      `Age-adjusted value in ${inSum.toFixed(1)} vs out ${outSum.toFixed(1)} (delta ${valueDelta >= 0 ? '+' : ''}${valueDelta})${pickNote}.`,
    )
  }

  // Age impact narrative.
  for (const p of incoming) {
    const t = ageTrajectory(p.position, p.age)
    if (t === 'ascending') ageImpact.push(`Acquiring ${p.playerName} adds an ascending ${p.position}${p.age != null ? ` (age ${p.age})` : ''}.`)
    if (t === 'cliff') riskFlags.push(`Incoming ${p.playerName} is past its dynasty prime${p.age != null ? ` (age ${p.age})` : ''}.`)
  }
  for (const p of outgoing) {
    const t = ageTrajectory(p.position, p.age)
    if (t === 'ascending') riskFlags.push(`Trading away ascending ${p.playerName} surrenders long-term upside.`)
  }

  // Roster fit vs needs.
  const needs = evaluateDynastyTeamNeeds(context, input.rosterId)
  const needPositions = new Set(needs.tradeTargetPositions)
  let rosterFitDelta = 0
  for (const p of incoming) {
    if (needPositions.has(p.position)) rosterFitDelta += 2
    else rosterFitDelta += 0.5
  }
  for (const p of outgoing) {
    if (needPositions.has(p.position)) {
      rosterFitDelta -= 3
      riskFlags.push(`Trading ${p.playerName} worsens an existing ${p.position} need.`)
    } else if (p.isStarterSlot) rosterFitDelta -= 1
  }
  rosterFitDelta = Math.round(rosterFitDelta * 10) / 10

  // Direction framing.
  const direction = evaluateDynastyTeamDirection(context, input.rosterId)
  let directionImpact: string | null = null
  if (direction.window !== 'unknown') {
    const incomingYoung = incoming.filter((p) => ['ascending', 'prime'].includes(ageTrajectory(p.position, p.age))).length
    const outgoingYoung = outgoing.filter((p) => ['ascending', 'prime'].includes(ageTrajectory(p.position, p.age))).length
    if (direction.window === 'contend') {
      directionImpact = incomingYoung < outgoingYoung
        ? 'Aligns with a contending window only if incoming players start now — youth was dealt away.'
        : 'Contending: ensure incoming pieces help the current starting lineup.'
    } else if (direction.window === 'rebuild') {
      directionImpact = incomingYoung > outgoingYoung
        ? 'Aligns with a rebuild — net younger/ascending assets acquired.'
        : 'Rebuilding: acquiring older assets runs against the window.'
    } else {
      directionImpact = 'Middling window — weigh whether this commits you toward contending or rebuilding.'
    }
  }

  for (const p of incoming) {
    if (p.injuryStatus && !/^(healthy|active|ok)$/i.test(p.injuryStatus)) riskFlags.push(`Incoming ${p.playerName} listed ${p.injuryStatus}.`)
  }

  let verdict: DynastyTradeVerdict
  if (!haveAnyValue) {
    verdict = 'needs_more_data'
    missingDataFlags.push('No dynasty value signal for the involved players or picks — verdict unavailable.')
  } else {
    if (!haveAllValues) riskFlags.push('Some players lack a value signal — verdict weighted by available data only.')
    const composite = (valueDelta ?? 0) + rosterFitDelta * 1.5
    if (composite >= 3) verdict = 'accept'
    else if (composite <= -3) verdict = 'reject'
    else verdict = 'neutral'
  }

  return {
    verdict,
    valueDelta,
    rosterFitDelta,
    ageImpact: [...new Set(ageImpact)],
    pickImpact: [...new Set(pickImpact)],
    directionImpact,
    riskFlags: [...new Set(riskFlags)],
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

export function findDynastyTradeTargets(
  context: DynastyWarRoomContext,
  rosterId: string,
): DynastyTradeFinderResult {
  const missingDataFlags = [...context.missingDataFlags]
  if (context.availability.playerValues !== 'available' && context.availability.playerAges !== 'available') {
    missingDataFlags.push('Trade finder needs value or age data to rank partner fit.')
    return { rosterId, targets: [], missingDataFlags: [...new Set(missingDataFlags)], needsMoreData: true }
  }

  const myNeeds = evaluateDynastyTeamNeeds(context, rosterId)
  const myNeedPositions = new Set(myNeeds.tradeTargetPositions)
  const myDir = evaluateDynastyTeamDirection(context, rosterId)
  const me = context.teams.find((t) => t.rosterId === rosterId)
  const mySurplus = new Set<string>()
  if (me) {
    const byPos: Record<string, number> = {}
    for (const p of me.players) byPos[p.position] = (byPos[p.position] ?? 0) + 1
    for (const [pos, count] of Object.entries(byPos)) {
      if (count >= (context.roster.requiredByPosition[pos] ?? 0) + 2) mySurplus.add(pos)
    }
  }

  const targets: DynastyTradeTarget[] = []
  for (const other of context.teams) {
    if (other.rosterId === rosterId) continue
    const otherNeeds = evaluateDynastyTeamNeeds(context, other.rosterId)
    const otherNeedPositions = new Set(otherNeeds.tradeTargetPositions)
    const otherByPos: Record<string, number> = {}
    for (const p of other.players) otherByPos[p.position] = (otherByPos[p.position] ?? 0) + 1
    const otherSurplus = new Set(
      Object.entries(otherByPos)
        .filter(([pos, count]) => count >= (context.roster.requiredByPosition[pos] ?? 0) + 2)
        .map(([pos]) => pos),
    )

    const theySupply = [...otherSurplus].filter((pos) => myNeedPositions.has(pos))
    const theyNeed = [...mySurplus].filter((pos) => otherNeedPositions.has(pos))
    let fitScore = theySupply.length * 18 + theyNeed.length * 18
    const reasons: string[] = []
    if (theySupply.length) reasons.push(`They have surplus ${theySupply.join('/')} you need.`)
    if (theyNeed.length) reasons.push(`They need ${theyNeed.join('/')} where you have depth.`)

    // Contention-window complementarity (contenders pair with rebuilders).
    const otherDir = evaluateDynastyTeamDirection(context, other.rosterId)
    let windowFit: string | null = null
    if (myDir.window !== 'unknown' && otherDir.window !== 'unknown') {
      if (
        (myDir.window === 'contend' && otherDir.window === 'rebuild') ||
        (myDir.window === 'rebuild' && otherDir.window === 'contend')
      ) {
        fitScore += 25
        windowFit = `Window match: you are ${myDir.window}, they are ${otherDir.window} — natural win-now ↔ youth/picks swap.`
        reasons.push(windowFit)
      } else if (myDir.window === otherDir.window && myDir.window === 'contend') {
        fitScore -= 10
        windowFit = 'Both contending — overlapping win-now goals make a value-add trade harder.'
      }
    }

    // Pick-capital angle (only when picks are really tracked).
    if (context.availability.futurePicks === 'available') {
      const myPicks = summarizePickCapital(me?.picks ?? [])
      const otherPicks = summarizePickCapital(other.picks)
      if (myDir.window === 'contend' && otherDir.window === 'rebuild' && otherPicks.earlyPickCount > 0) {
        fitScore += 8
        reasons.push(`They hold ${otherPicks.earlyPickCount} early pick(s) — target a pick-for-win-now-player package.`)
      } else if (myDir.window === 'rebuild' && otherDir.window === 'contend' && myPicks.earlyPickCount === 0 && (myNeeds.tradeTargetPositions.length > 0)) {
        fitScore += 8
        reasons.push('Rebuilding: offer a productive vet for their future picks to stock pick capital.')
      }
    }

    if (fitScore <= 0) continue
    fitScore = Math.min(100, fitScore)
    targets.push({ rosterId: other.rosterId, teamName: other.teamName, fitScore, theySupply, theyNeed, windowFit, reasons })
  }

  targets.sort((a, b) => b.fitScore - a.fitScore)
  return { rosterId, targets, missingDataFlags: [...new Set(missingDataFlags)], needsMoreData: false }
}
