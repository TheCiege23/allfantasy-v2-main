/**
 * Survivor Guillotine follow-up boards (handoff2: tribe setup, multi-race, tribe draw, tribe chat
 * card, lineup blade meter, waivers, reversal). Presentation only, engine rules only — see the
 * header of ./visual-model.ts. Where the handoff proposes behaviour the engine does not have, the
 * board shows what the engine does and the copy says so.
 */

import { DEFAULT_DANGER_MARGIN_POINTS } from '@/lib/guillotine/constants'
import { SG_POWER_LABELS } from '@/lib/survivor-guillotine/powers'
import type { SGConfig, SGPowerKind } from '@/lib/survivor-guillotine/types'
import {
  SG_ART, SG_POWER_ART, buildChopLine, buildTribeRace, sgTribeArt,
  type SGRace, type SGVisualHistoryRow, type SGVisualInput, type SGVisualTeam,
} from '@/lib/survivor-guillotine/visual-model'

/* ───────────────────────────── Tribe setup (SGTribeSetup) ───────────────────────────── */

/** The engine's tribe limits (config.ts buildSGSchedule): 2–4 tribes, each with at least one team. */
export const SG_ENGINE_MIN_TRIBES = 2
export const SG_ENGINE_MAX_TRIBES = 4

export const SG_FORMATION_LABELS: Record<SGConfig['tribeFormation'], string> = {
  random: 'Random draw when the draft completes',
  commissioner: 'Commissioner assigns tribes',
  captain_draft: 'Captains draft their tribes live',
  manager_choice: 'Managers choose; sizes stay balanced',
}

export type SGTribeCountOption = { count: number; sizes: string; allowed: boolean; reason: string | null }

/** Every count the handoff shows (2–8), marked allowed only where the engine accepts it. */
export function sgTribeCountOptions(teamCount: number): SGTribeCountOption[] {
  return [2, 3, 4, 5, 6, 7, 8].map((count) => {
    const small = Math.floor(teamCount / count)
    const big = Math.ceil(teamCount / count)
    const sizes = small === big ? `${small} each` : `${small}–${big} each`
    const reason = count > SG_ENGINE_MAX_TRIBES
      ? `The Survivor Guilly engine runs ${SG_ENGINE_MIN_TRIBES}–${SG_ENGINE_MAX_TRIBES} tribes.`
      : count > teamCount ? 'More tribes than managers.' : null
    return { count, sizes, allowed: reason === null, reason }
  })
}

export function buildTribeSetupView(config: SGConfig) {
  const tribeIds = Array.from({ length: config.tribeCount }, (_, i) => `tribe-${i}`)
  return {
    tribeCount: config.tribeCount,
    formation: SG_FORMATION_LABELS[config.tribeFormation],
    tribes: tribeIds.map((id) => sgTribeArt(id)),
    merged: sgTribeArt('merged'),
    counts: sgTribeCountOptions(config.teamCount),
    shuffles: config.shufflePeriods,
  }
}

/* ───────────────────────────── Multi-tribe race (SGMultiRace) ───────────────────────────── */

export type SGMultiRow = { tribeId: string; name: string; color: string; buffSrc: string; rank: number; value: number | null; label: string; status: 'immune' | 'chop_field' | 'tied' | 'pending' }

/**
 * Engine rule for 3–4 tribes: ONE tribe (the best metric) is immune and EVERY other tribe is in the
 * chop field. The handoff's "only the last-place tribe goes to the chop" is not what the engine does.
 */
export function buildMultiRace(race: SGRace): SGMultiRow[] {
  const sorted = [...race.tribes].sort((a, b) => (b.metric ?? -Infinity) - (a.metric ?? -Infinity))
  return sorted.map((t, i) => ({
    tribeId: t.tribeId, name: t.name, color: t.color, buffSrc: t.buffSrc, rank: i + 1, value: t.metric, label: t.metricLabel,
    status: t.standing === 'pending' ? 'pending' : t.standing === 'tied' ? 'tied' : t.tribeId === race.projectedImmuneTribeId ? 'immune' : 'chop_field',
  }))
}

/* ───────────────────────────── Tribe draw + private idol (SGTribeDraw) ───────────────────────────── */

export type SGOwnPlayer = { id: string; name: string; position: string; team: string | null }

/**
 * The viewer's own tribe and their own sealed powers. Player-bound idols name the attached player
 * ONLY when that player is on the viewer's own roster (which the engine already requires to see it).
 */
export function buildTribeDraw(input: SGVisualInput, ownPlayers: SGOwnPlayer[]) {
  const own = input.ownRosterId
  const mine = input.season.tribes.find((m) => m.rosterId === own)
  const names = new Map(input.teams.filter((t) => t.legacyRosterId).map((t) => [t.legacyRosterId!, t.teamName || t.ownerName]))
  const byPlayer = new Map(ownPlayers.map((p) => [p.id, p]))
  const idols = input.powers.filter((p) => own && p.ownerId === own && p.status !== 'used' && p.status !== 'expired').map((p) => {
    const player = p.playerId ? byPlayer.get(p.playerId) : undefined
    return {
      id: p.id, kind: p.kind as SGPowerKind, label: SG_POWER_LABELS[p.kind], src: SG_POWER_ART[p.kind].src,
      attachedTo: p.binding === 'player' && player ? `${player.name} (${player.position}${player.team ? ` · ${player.team}` : ''})` : null,
      throughPeriod: p.expiresAfterPeriod,
    }
  })
  return {
    tribe: mine ? sgTribeArt(mine.tribeId) : null,
    captain: Boolean(mine?.captain),
    tribemates: mine ? input.season.tribes.filter((m) => m.tribeId === mine.tribeId && m.rosterId !== own).map((m) => names.get(m.rosterId) ?? 'Manager') : [],
    formation: SG_FORMATION_LABELS[input.season.config.tribeFormation],
    idols,
  }
}

/* ───────────────────────────── Lineup blade meter (SGLineup) ───────────────────────────── */

export type SGBladeMeter = {
  you: number; blade: number; margin: number; tier: 'chop_zone' | 'danger' | 'safe' | 'immune'
  bladeName: string | null; youPct: number; bladePct: number; dangerPct: number; headline: string; sub: string
}

/** Where the viewer sits against the live chop line. Null when there is nothing to measure. */
export function buildBladeMeter(input: SGVisualInput, race: SGRace = buildTribeRace(input)): SGBladeMeter | null {
  const own = input.ownRosterId
  if (!own) return null
  const groups = buildChopLine(input, race).groups
  const group = groups.find((g) => g.rows.some((r) => r.rosterId === own))
  const myScore = input.scores.find((s) => s.rosterId === own)?.totalPoints
  if (!group) {
    const myTribe = input.season.tribes.find((m) => m.rosterId === own)?.tribeId
    if (myScore != null && myTribe && myTribe === race.projectedImmuneTribeId) {
      return { you: myScore, blade: myScore, margin: 0, tier: 'immune', bladeName: null, youPct: 100, bladePct: 0, dangerPct: 0,
        headline: `${sgTribeArt(myTribe).name} is ahead, so you are off the chop line`, sub: 'If the race holds, nobody in your tribe can be chopped this period.' }
    }
    return null
  }
  const rows = group.rows
  const me = rows.find((r) => r.rosterId === own)!
  const blade = rows.filter((r) => r.tier === 'chop_zone').reduce((m, r) => Math.max(m, r.points), -Infinity)
  const bladeRow = rows.filter((r) => r.tier === 'chop_zone' && r.rosterId !== own).sort((a, b) => b.points - a.points)[0] ?? null
  const top = Math.max(...rows.map((r) => r.points), blade + DEFAULT_DANGER_MARGIN_POINTS * 2)
  const low = Math.min(...rows.map((r) => r.points))
  const span = Math.max(1, top - low)
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100))
  const margin = Math.round((me.points - blade) * 10) / 10
  const headline = me.tier === 'chop_zone'
    ? 'You are under the blade'
    : `You're ${margin.toFixed(1)} above the blade`
  return {
    you: me.points, blade, margin, tier: me.tier, bladeName: bladeRow?.name ?? null,
    youPct: pct(me.points), bladePct: pct(blade), dangerPct: pct(blade + DEFAULT_DANGER_MARGIN_POINTS),
    headline,
    sub: me.tier === 'chop_zone'
      ? 'An immunity idol played before the deadline passes the blade to the next lowest.'
      : me.tier === 'danger' ? `Inside ${DEFAULT_DANGER_MARGIN_POINTS} of the chop zone. Live points, not final.` : 'Clear of the danger band on live points.',
  }
}

/* ───────────────────────────── Tribe chat chop card (SGTribeChat) ───────────────────────────── */

export type SGChopCard = { period: number; title: string; lines: string[]; art: string }

/**
 * The card for an engine league-chat post (`metadata.survivorGuillotine` events). It uses only what
 * the engine already published in that post — never a power holder the message did not name.
 */
export function sgChopCardFromHistory(period: number, row: SGVisualHistoryRow, teams: SGVisualTeam[]): SGChopCard {
  const names = new Map(teams.filter((t) => t.legacyRosterId).map((t) => [t.legacyRosterId!, t.teamName || t.ownerName]))
  const n = (ids: string[]) => ids.map((id) => names.get(id) ?? 'A manager').join(', ')
  const lines: string[] = []
  if (row.immuneTribeId) lines.push(`${sgTribeArt(row.immuneTribeId).name} won immunity.`)
  if (row.savedTeamIds.length) lines.push(`The blade passed over ${n(row.savedTeamIds)}.`)
  if (row.choppedTeamIds.length) lines.push(`${n(row.choppedTeamIds)} ${row.choppedTeamIds.length > 1 ? 'were' : 'was'} chopped. Their players are on waivers.`)
  if (!row.choppedTeamIds.length && row.placements?.length) lines.push(`${n(row.placements.slice(0, 1))} is the last one standing.`)
  return { period, title: `Chop night · period ${period}`, lines, art: row.choppedTeamIds.length ? `${SG_ART}/guillotine-drop.svg` : `${SG_ART}/winner.svg` }
}

/* ───────────────────────────── Waivers (SGWaivers) ───────────────────────────── */

export type SGReleasedPlayer = { id: string; name: string; position: string; team: string | null; fromRosterId: string; period: number; available: boolean }

/**
 * Players released by chops, for the waiver board. Server-side helper for the season route: skips
 * reversed chops and any period whose chop is still hidden by a hosted ceremony.
 */
export function selectReleasedPlayers(args: {
  chops: { period: number; rosterId: string; releaseSnapshot: unknown; reversedAt: Date | string | null }[]
  hiddenPeriods: number[]
  rosterPlayerIds: (snapshot: unknown) => string[]
  ownedPlayerIds: Set<string>
  players: Map<string, { name: string; position: string; team: string | null }>
  limitPeriods?: number
}): SGReleasedPlayer[] {
  const hidden = new Set(args.hiddenPeriods)
  const live = args.chops.filter((c) => !c.reversedAt && !hidden.has(c.period))
  const periods = [...new Set(live.map((c) => c.period))].sort((a, b) => b - a).slice(0, args.limitPeriods ?? 1)
  return live.filter((c) => periods.includes(c.period)).flatMap((c) => {
    const snap = c.releaseSnapshot && typeof c.releaseSnapshot === 'object' ? (c.releaseSnapshot as { playerData?: unknown }).playerData : undefined
    return args.rosterPlayerIds(snap).flatMap((id) => {
      const p = args.players.get(id)
      return p ? [{ id, ...p, fromRosterId: c.rosterId, period: c.period, available: !args.ownedPlayerIds.has(id) }] : []
    })
  })
}

/* ───────────────────────────── Reversal (SGReversal) ───────────────────────────── */

export type SGReversalRow = { period: number; rosterId: string; score: number; reversedAt: string | null; reason: string | null }

/**
 * Engine behaviour: when final scores change for the LATEST completed period and the chop changes,
 * the chop is reversed — roster restored except players a claimant already won — and the ceremony
 * runs again with corrected scores. It does not instantly chop the new lowest, and it is not tied to
 * an "immediate" correction mode.
 */
export function buildReversals(rows: SGReversalRow[], teams: SGVisualTeam[], history: Record<string, SGVisualHistoryRow>) {
  const names = new Map(teams.filter((t) => t.legacyRosterId).map((t) => [t.legacyRosterId!, t.teamName || t.ownerName]))
  return rows.map((r) => {
    const rerun = history[String(r.period)]
    const newChop = rerun && !rerun.hostedCeremony ? rerun.choppedTeamIds.filter((id) => id !== r.rosterId) : []
    return {
      period: r.period,
      restored: names.get(r.rosterId) ?? 'A manager',
      originalScore: r.score,
      correctedScore: rerun?.scores?.[r.rosterId] ?? null,
      newlyChopped: newChop.map((id) => names.get(id) ?? 'A manager'),
      when: r.reversedAt,
      steps: [
        { title: 'Chop ran', detail: `Period ${r.period} ceremony.`, art: `${SG_ART}/guillotine-drop.svg` },
        { title: 'Correction landed', detail: 'Final scores changed the result.', art: `${SG_ART}/icon-zone.svg` },
        { title: 'Chop reversed', detail: 'Torch relit; roster restored except players already claimed.', art: `${SG_ART}/torch-lit.svg` },
        { title: 'Ceremony reruns', detail: newChop.length ? `${newChop.map((id) => names.get(id) ?? 'A manager').join(', ')} chopped on corrected scores.` : 'The chop runs again on corrected scores.', art: `${SG_ART}/guillotine.svg` },
      ],
    }
  })
}
