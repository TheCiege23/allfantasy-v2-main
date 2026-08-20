import type { PbpGame, PbpPlay, PbpPlayer } from '@/lib/live/rollingInsightsPlayByPlay'
import type { IdpWeeklyStatLine } from '@/lib/idp/statIngestionEngine'

/**
 * Derive real NFL defensive stat lines from play-by-play.
 *
 * ⚠ THIS EXISTS TO REPLACE FABRICATED DATA. `generateDeterministicWeeklyStatLine`
 * invents a defender's week from a hash of their id — solo tackles are
 * `2 + (hash % 9)`, sacks fire when `hash % 5 >= 3`. It is stable and it looks
 * exactly like a real stat line, which is what makes it dangerous: nothing
 * downstream can tell the difference. It is reachable from app surfaces today.
 *
 * Rolling Insights has no defensive stats in its player box at all — the live
 * payload carries passing, rushing and fumbles only. Play-by-play is the ONLY
 * route to NFL IDP, which is why this maps plays rather than reading a box.
 *
 * Everything here is counted from an observed play. Where the contract is
 * ambiguous about what a role means, the stat is NOT credited — an
 * under-counted defender is a fixable gap, a mis-credited one is a wrong number
 * a manager will act on.
 */

/** A defender's line for one game, keyed by the canonical `idp_*` names. */
export type IdpGameLine = {
  playerId: string
  playerName: string
  teamAbbr: string | null
  position: string | null
  stats: IdpWeeklyStatLine
}

const add = (line: IdpWeeklyStatLine, key: string, n = 1) => {
  line[key] = (line[key] ?? 0) + n
}

/**
 * ⚠ NOT MAPPED, ON PURPOSE:
 *
 *   role 'fumbler'  — GAPS N-06 records this as ambiguous: it may name the
 *                     player who FUMBLED rather than the one who forced it.
 *                     Crediting a forced fumble to whoever fumbled would hand
 *                     defensive points to the offense that lost the ball.
 *
 *   action 'pressure' — a hurry is not a QB hit, and `idp_qb_hit` is the only
 *                     near-miss key available. Counting hurries as hits would
 *                     inflate every edge rusher in the league.
 */
const UNMAPPED_BY_DESIGN = ['fumbler', 'pressure'] as const

function isDefensivePlayer(p: PbpPlayer): boolean {
  return p.role === 'defender' || p.role === 'interceptor' || p.role === 'recoverer'
}

/**
 * Tackles from one play.
 *
 * The play-by-play `action` enum has a single `tackle` value with no solo/assist
 * split, so it is derived from how many defenders made the tackle: one tackler
 * is a solo, several share assists. That is what the distinction actually
 * means, and it beats crediting every tackle as solo — which would overstate
 * every linebacker in the league on the stat IDP scoring weighs most.
 */
function creditTackles(play: PbpPlay, lineFor: (p: PbpPlayer) => IdpWeeklyStatLine): void {
  const tacklers = play.players.filter((p) => p.role === 'defender' && p.action === 'tackle')
  if (tacklers.length === 0) return
  const key = tacklers.length === 1 ? 'idp_solo_tackle' : 'idp_assist_tackle'
  for (const t of tacklers) add(lineFor(t), key)
}

/**
 * Fold one game's plays into per-defender stat lines.
 *
 * ⚠ REVERSED PLAYS ARE DROPPED. A play the officials overturned did not happen;
 * counting its tackles would leave a defender permanently credited for a snap
 * that was wiped out, and there is no later correction that removes it.
 */
export function idpLinesFromGame(game: PbpGame): IdpGameLine[] {
  const byPlayer = new Map<string, IdpGameLine>()

  const lineFor = (p: PbpPlayer): IdpWeeklyStatLine => {
    // Fall back to a name key so an unidentified defender still accumulates
    // rather than silently merging with everyone else who has no id.
    const id = p.id != null ? String(p.id) : `name:${p.name}`
    let entry = byPlayer.get(id)
    if (!entry) {
      entry = {
        playerId: id,
        playerName: p.name,
        teamAbbr: p.teamAbbr,
        position: p.position,
        stats: {},
      }
      byPlayer.set(id, entry)
    }
    // Position and team arrive per play; keep the first non-empty.
    if (!entry.position && p.position) entry.position = p.position
    if (!entry.teamAbbr && p.teamAbbr) entry.teamAbbr = p.teamAbbr
    return entry.stats
  }

  for (const play of game.plays) {
    if (play.isReversed) continue

    creditTackles(play, lineFor)

    for (const p of play.players) {
      if (!isDefensivePlayer(p)) continue

      if (p.role === 'defender' && p.action === 'sack') {
        add(lineFor(p), 'idp_sack')
        // A sack is also a tackle for loss. Most IDP formats pay both.
        add(lineFor(p), 'idp_tackle_for_loss')
        if (play.yardsGained != null && play.yardsGained < 0) {
          add(lineFor(p), 'idp_sack_yardage', Math.abs(play.yardsGained))
        }
      }

      if (p.role === 'defender' && p.action === 'defend') add(lineFor(p), 'idp_pass_defended')
      if (p.role === 'interceptor') add(lineFor(p), 'idp_interception')
      if (p.role === 'recoverer' && p.action === 'fumble_recovery') {
        add(lineFor(p), 'idp_fumble_recovery')
      }

      /*
       * A defensive touchdown is credited to the defender who was already on
       * the play as an interceptor or recoverer — the same player who took it
       * back. `isTouchdown` alone is not enough: an offensive touchdown play
       * also carries a tackler.
       */
      if (play.isTouchdown && (p.role === 'interceptor' || p.role === 'recoverer')) {
        add(lineFor(p), 'idp_defensive_touchdown')
      }
    }

    // A safety credits the defenders on the play, not the whole unit.
    if (play.event === 'safety') {
      for (const p of play.players) {
        if (p.role === 'defender') add(lineFor(p), 'idp_safety')
      }
    }
  }

  return [...byPlayer.values()].filter((l) => Object.keys(l.stats).length > 0)
}

/** Exported so a test can assert the exclusions stay deliberate. */
export const __unmappedByDesign = UNMAPPED_BY_DESIGN
