/**
 * 27a — the league tile, as one model shared by every surface that draws one.
 *
 * The handoff's whole argument is that there is ONE tile with five lifecycle
 * states, not five tiles. So the anatomy is fixed here and the only thing a
 * state may change is the status line:
 *
 *   image (+ corner platform badge)  ← never a text row for the platform
 *   name
 *   format line                      ← identical in every state
 *   status line                      ← the ONLY per-state line
 *
 * ⚠ THE PLATFORM BADGE IS A CORNER MARK ON THE IMAGE, NEVER ITS OWN ROW. The
 * handoff's stated reason, kept verbatim because it is the whole rationale: "at
 * 61 leagues a whole line for 'Sleeper' is 61 wasted lines."
 *
 * ⚠ THE STATUS LINE ALWAYS CARRIES A REASON OR A NEXT STEP. "DRAFTING · pick
 * 1.04 in 2m", never a bare "DRAFTING". A state word on its own tells a manager
 * nothing they cannot already see from the colour of the dot.
 *
 * This file is pure — no prisma, no `server-only` — because both the real
 * screens and the dev states preview render from it.
 */

export type LeagueTileStateKind =
  | 'predraft'
  | 'drafting'
  | 'live'
  | 'upcoming'
  | 'finished'

/** Drives the dot colour and the tile's left border. */
export type LeagueTileTone = 'neutral' | 'accent' | 'live' | 'warn' | 'gold'

export type LeagueTileStatus = {
  kind: LeagueTileStateKind
  /** The state word — "PRE-DRAFT", "DRAFTING", "LIVE", "WEEK 12", "FINISHED". */
  label: string
  /**
   * Why, or what happens next. Required, not optional: a tile that can only say
   * its state word has failed the handoff's second copy contract.
   */
  reason: string
  tone: LeagueTileTone
}

/**
 * The score, when one exists. Separate from `status` because a live tile shows
 * BOTH the state line and the numbers, and because a pre-kickoff projection
 * uses the same shape with `projected: true`.
 *
 * ⚠ PRE-GAME TILES SHOW A PROJECTION RATHER THAN STAYING BLANK — the handoff
 * calls this out explicitly as the difference from Sleeper's tile, which is
 * empty until kickoff. `projected` is what lets the renderer label it as one
 * instead of passing a projection off as a result.
 */
export type LeagueTileScore = {
  you: number
  opponent: number
  opponentName: string | null
  projected: boolean
}

export type LeagueTileModel = {
  id: string
  name: string
  /** Lowercased platform slug — 'sleeper' | 'espn' | 'yahoo' | 'cbs' | … */
  platform: string
  /** Real league art, when the platform gave us one. */
  imageUrl?: string | null
  /** "2026 · 12-team · Dynasty PPR". Fixed across every state. */
  formatLine: string
  status: LeagueTileStatus
  score?: LeagueTileScore | null
  /**
   * User-set nickname, used ahead of `name` when present.
   * See `resolveTileName` for why this exists.
   */
  nickname?: string | null
  /** Where the tile navigates. */
  href: string
}

/**
 * Deterministic fallback art colour, seeded from the league id.
 *
 * ⚠ SEEDED, NOT RANDOM, AND NOT A GENERIC SHIELD. Two separate requirements from
 * the handoff. Random would repaint a league on every render, which reads as a
 * different league; a generic shield makes 61 leagues look like one league
 * repeated. An FNV-1a hash over the id gives a stable index with good spread
 * over short, similar ids — which league ids are, since they mostly share a
 * prefix and differ only in the last few digits.
 */
const FALLBACK_RAMP: Array<{ bg: string; fg: string }> = [
  { bg: '#1f2a4d', fg: '#9fd4ff' },
  { bg: '#12352a', fg: '#7ff0c4' },
  { bg: '#3a1d55', fg: '#dcb4ff' },
  { bg: '#4a1414', fg: '#ffb4b4' },
  { bg: '#3a2a12', fg: '#f6c445' },
  { bg: '#14303a', fg: '#8fe3f5' },
  { bg: '#2a1836', fg: '#e0a8f0' },
  { bg: '#1a3320', fg: '#9de8a8' },
]

export function tileFallbackColor(leagueId: string): { bg: string; fg: string } {
  // FNV-1a, 32-bit. `>>> 0` after each step keeps it in unsigned number space.
  let hash = 0x811c9dc5
  for (let i = 0; i < leagueId.length; i += 1) {
    hash ^= leagueId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return FALLBACK_RAMP[hash % FALLBACK_RAMP.length]
}

/** Initials for the fallback art — two characters, from real word boundaries. */
export function tileInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '??'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/*
 * The naming-collision rule (nickname, else "Name · 1a2b" only when a name collides) moved to
 * lib/core-app/leagueNameCollision.ts, with its full history, so Chimmy's cross-league tools can
 * share it. Re-exported here so every existing caller is unchanged.
 */
export { findCollidingNames, resolveTileName } from '@/lib/core-app/leagueNameCollision'

/** Platform corner-mark letter. Matches the rail's PLATFORM_MARK map. */
const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  cbs: 'C',
  mfl: 'M',
  fantrax: 'F',
}

export function platformMark(platform: string): string {
  return PLATFORM_MARK[platform.toLowerCase()] ?? (platform.charAt(0).toUpperCase() || '·')
}
