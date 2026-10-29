import type { RailMatchupSummary } from '@/components/core-app/AfCoreShell'

/**
 * Native league handoff §2 (2026-10-11): each league crest in the rail and the phone switcher wears
 * a RING for this week's state and a short MONO line under it (record, score or place).
 *
 *   green  `good`  winning this week (or above the cut in a field race)
 *   red    `bad`   losing this week (or on / below the cut)
 *   amber  `needs` the league needs you: setup or the draft is still ahead
 *
 * Pure, and built only from what the rail already holds — the DB-first rail snapshot
 * (`getRailMatchups`, the same loader /core's rail reads) with the live poll laid over it, plus the
 * league row's own phase. Nothing here calls a provider or the database.
 */

export type LeagueRingTone = 'good' | 'bad' | 'needs'

export type LeagueRailStatus = {
  /** Null = no ring colour to show (an unplayed week, an even score, a quiet offseason). */
  tone: LeagueRingTone | null
  /** The mono line under the crest, e.g. `88–71`, `8TH`, `SETUP`, `WK 5`. Never empty. */
  mini: string
  /** One phrase for the tooltip and the phone switcher row: "Winning · Wk 5". */
  line: string
  /** Which phone-switcher group the row belongs to. */
  group: 'needs' | 'live' | 'other'
}

export type LeagueRailPhase = 'Setup' | 'Draft' | 'Regular season' | 'Playoffs' | 'Offseason' | string

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}TH`
  switch (n % 10) {
    case 1: return `${n}ST`
    case 2: return `${n}ND`
    case 3: return `${n}RD`
    default: return `${n}TH`
  }
}

/** Whole points read cleanly in a 52px column; a decimal is kept only below ten. */
function scoreText(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.abs(value) < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value))
}

export function leagueRailStatus(input: {
  m: RailMatchupSummary | null | undefined
  phase: LeagueRailPhase
  /** "Wk 6" or the phase — LeagueRail's `weekLabel`. */
  weekLabel: string
}): LeagueRailStatus {
  const { m, phase, weekLabel } = input
  const week = weekLabel.toUpperCase()

  // Before the draft the league is waiting on its managers: amber, whatever the (empty) scoreboard says.
  if (phase === 'Setup' || phase === 'Draft') {
    return {
      tone: 'needs',
      mini: phase === 'Draft' ? 'DRAFT' : 'SETUP',
      line: phase === 'Draft' ? 'Draft is on' : 'Setup · draft ahead',
      group: 'needs',
    }
  }

  if (m?.guillotine) {
    // A guillotine line reads like a standing: safe or in danger. It carries its own copy.
    const g = m.guillotine as unknown as { rank?: number | null; overCut?: number | null }
    const over = typeof g.overCut === 'number' ? g.overCut : null
    const rank = typeof g.rank === 'number' && g.rank > 0 ? g.rank : null
    if (rank != null || over != null) {
      return {
        tone: over == null ? 'bad' : over > 0 ? 'good' : 'bad',
        mini: rank != null ? ordinal(rank) : week,
        line: over == null ? 'On the chopping block' : over > 0 ? `+${over.toFixed(1)} over the cut` : 'At the cut line',
        group: 'live',
      }
    }
  }

  if (m && (m.unpaired || !m.opponentTeam) && m.standing) {
    const s = m.standing
    const safe = s.overCut != null && s.overCut > 0
    return {
      tone: s.elimination ? (safe ? 'good' : 'bad') : s.rank <= Math.ceil(s.outOf / 2) ? 'good' : 'bad',
      mini: ordinal(s.rank),
      line: s.elimination
        ? safe ? `+${(s.overCut ?? 0).toFixed(1)} over the cut` : 'At the cut line'
        : `${ordinal(s.rank).toLowerCase()} of ${s.outOf}`,
      group: 'live',
    }
  }

  if (m && m.scored && m.opponentTeam) {
    const diff = m.yourScore - m.opponentScore
    const tone: LeagueRingTone | null = diff > 0 ? 'good' : diff < 0 ? 'bad' : null
    return {
      tone,
      mini: `${scoreText(m.yourScore)}–${scoreText(m.opponentScore)}`,
      line: `${diff > 0 ? 'Winning' : diff < 0 ? 'Losing' : 'Tied'} · ${weekLabel}`,
      group: 'live',
    }
  }

  return {
    tone: null,
    mini: phase === 'Offseason' ? 'OFF' : week,
    line: m && m.opponentTeam ? `vs ${m.opponentTeam} · ${weekLabel}` : phase === 'Offseason' ? 'Offseason' : weekLabel,
    group: 'other',
  }
}

/** The unread count as the badge prints it: nothing at zero, `99+` past ninety-nine. */
export function unreadBadgeText(count: number | null | undefined): string | null {
  if (!count || !Number.isFinite(count) || count <= 0) return null
  return count > 99 ? '99+' : String(Math.floor(count))
}

/** ‹ › on the phone pill: the league before / after `currentId`, wrapping round. */
export function adjacentLeagueId(ids: readonly string[], currentId: string, step: -1 | 1): string | null {
  if (ids.length < 2) return null
  const at = ids.indexOf(currentId)
  if (at < 0) return ids[0] ?? null
  return ids[(at + step + ids.length) % ids.length] ?? null
}
