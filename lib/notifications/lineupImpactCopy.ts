/**
 * Injury alerts only when they change your lineup (owner's call, 2026-10-25). An injury or status
 * change reaches you by push and email ONLY when it affects a starting lineup:
 *
 *   starter_out           a starter is ruled out (Out, IR, suspended) — what to do about it: the bench
 *                         player to start, or the free agent to add when nobody on the bench can.
 *   starter_questionable  a starter turns questionable or doubtful — who to have ready.
 *   starter_cleared       a starter who was questionable or doubtful is cleared — he stays in.
 *   bench_should_start    a bench player comes back healthy and out-projects a starter — who to
 *                         swap him with, and by how much.
 *   none                  anything else (a bench player hurt, or healthy but not good enough to
 *                         start): the in-app bell only. No push, no email, not in the daily digest.
 *
 * The swap names and numbers come from the Player Finder's league-scored picker
 * (core-app/playerImpact + leagueCall), never from here. Pure and client-safe.
 */

import type { LeagueCall } from '@/lib/core-app/leagueCall'
import type { StatusBucket } from './playerNewsStatus'

export type LineupImpactKind = 'starter_out' | 'starter_questionable' | 'starter_cleared' | 'bench_should_start' | 'none'

export type LeagueLineupImpact = {
  leagueId: string
  leagueName: string
  kind: LineupImpactKind
  /** The player to put in: a bench player for a starter, or the healthy player himself. */
  startName: string | null
  /** The starter to take out (bench_should_start). */
  benchName: string | null
  /** Projected gain of the swap under this league's scoring, when known. */
  delta: number | null
  /** The free agent to add when no bench player can come in (starter_out, AF Pro player depth only). */
  freeAgent: { name: string; projectedPoints: number } | null
  /** Where to make the change, when the platform can be deep-linked. */
  fixHref: string | null
}

const RULED_OUT: ReadonlySet<StatusBucket> = new Set(['out', 'ir', 'suspended'])
const IFFY: ReadonlySet<StatusBucket> = new Set(['questionable', 'doubtful'])

/**
 * What a status change means for one league's lineup. `call` is the Player Finder's call for that
 * league (null when it could not be computed); `prior` is the status before this change, when known.
 */
export function lineupImpactKind(args: {
  bucket: StatusBucket
  prior: StatusBucket | null
  isStarting: boolean
  call: LeagueCall | null
}): LineupImpactKind {
  const { bucket, prior, isStarting, call } = args
  // His game (or the swap partner's) has kicked off: there is nothing to do, so nothing to send.
  if (call?.kind === 'locked') return 'none'
  if (isStarting) {
    if (RULED_OUT.has(bucket)) return 'starter_out'
    if (IFFY.has(bucket)) return 'starter_questionable'
    // Cleared: only a real recovery (prior questionable / doubtful / out), never a routine "active".
    if (bucket === 'active' && prior != null && prior !== 'active') return 'starter_cleared'
    return 'none'
  }
  if (bucket === 'active' && call?.kind === 'start' && call.swap) return 'bench_should_start'
  return 'none'
}

export function hasLineupImpact(impacts: readonly LeagueLineupImpact[]): boolean {
  return impacts.some((i) => i.kind !== 'none')
}

const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`

function optionLine(i: LeagueLineupImpact, playerName: string): string {
  const where = i.leagueName
  switch (i.kind) {
    case 'starter_out':
      if (i.startName) return `${where}: start ${i.startName} in place of ${playerName}.`
      if (i.freeAgent) return `${where}: no bench player can come in — add ${i.freeAgent.name} (${i.freeAgent.projectedPoints.toFixed(1)} projected) from free agents.`
      return `${where}: no bench player can come in — check free agents.`
    case 'starter_questionable':
      return i.startName
        ? `${where}: keep him in for now; if he's ruled out, start ${i.startName}.`
        : `${where}: keep him in for now; nobody on your bench can come in for him.`
    case 'starter_cleared':
      return `${where}: he's cleared and stays in your lineup.`
    case 'bench_should_start':
      return `${where}: start ${playerName} over ${i.benchName ?? 'your weakest starter'}${i.delta != null ? ` (${fmt(i.delta)} projected)` : ''}.`
    default:
      return ''
  }
}

const TITLE: Record<Exclude<LineupImpactKind, 'none'>, (p: string, i: LeagueLineupImpact) => string> = {
  starter_out: (p) => `🚨 ${p} is OUT — your lineup options`,
  starter_questionable: (p) => `⚠️ ${p} is questionable — have a backup ready`,
  starter_cleared: (p) => `✅ ${p} is cleared to play`,
  bench_should_start: (p, i) => `💪 ${p} is healthy — start him over ${i.benchName ?? 'a starter'}`,
}

/** Most urgent first: a ruled-out starter outranks a cleared one. */
const RANK: Record<LineupImpactKind, number> = { starter_out: 0, starter_questionable: 1, bench_should_start: 2, starter_cleared: 3, none: 9 }

/** The push / email text for one player across the leagues where he changes the lineup. */
export function lineupImpactCopy(playerName: string, impacts: readonly LeagueLineupImpact[]): { title: string; body: string; kind: LineupImpactKind; fixHref: string | null } | null {
  const real = impacts.filter((i) => i.kind !== 'none').sort((a, b) => RANK[a.kind] - RANK[b.kind])
  const top = real[0]
  if (!top) return null
  const lines = real.map((i) => optionLine(i, playerName)).filter(Boolean)
  return {
    kind: top.kind,
    title: TITLE[top.kind as Exclude<LineupImpactKind, 'none'>](playerName, top),
    body: lines.join('\n'),
    fixHref: top.fixHref,
  }
}
