import 'server-only'

import { getTeamDepthChart } from '@/lib/depth-charts'

/**
 * Where a player sits on his team's depth chart — the first piece of the value
 * ledger's trajectory layer.
 *
 * ⚠ THE CHART TELLS YOU POSITION, NOT DIRECTION, and for a trade that is the
 * harder limitation to work around. `DepthChart` stores current state with no
 * history, so "he just took the job in week 3" and "he has held it for three
 * years" are the same row. A trade cares enormously about which one it is, and
 * this layer cannot tell you. It says so rather than implying a trend it cannot
 * see.
 *
 * ⚠ UNLISTED IS NOT BURIED. A player missing from the chart may be a rookie it
 * has not caught up with, a name our matcher spelled differently, or genuinely
 * irrelevant. Reporting "buried" for a player we simply failed to find would
 * be a confident negative claim built on a lookup miss, and negatives are the
 * expensive direction to be wrong in on a trade screen.
 *
 * ⚠ AND THE TABLE MAY BE EMPTY. `lib/depth-charts.ts` is cache-only and never
 * calls a provider; a repo-wide search finds readers but no writer for
 * `depth_charts`. Treat an empty result as "not ingested", which is what the
 * `unlisted` role with a zero `listed` count means.
 */

export type DepthRole = {
  position: string
  /** 1 = listed first at the position. Null when he is not on the chart. */
  rank: number | null
  /** How many players the chart lists at that position. */
  listed: number
  role: 'starter' | 'backup' | 'buried' | 'unlisted'
  basis: string
}

/** Listed this deep or lower and he is not competing for snaps. */
const BURIED_FROM_RANK = 3

/**
 * Normalised for comparison only.
 *
 * ⚠ NAME MATCHING IS THE WEAK JOINT and it is worth being explicit about. The
 * chart stores an array of strings whose provenance we do not control — they
 * may be names or ids depending on the source that filled the row. Both are
 * attempted; a miss returns `unlisted` rather than a guess.
 */
function normalise(x: string): string {
  return x
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function getDepthRole(args: {
  playerName: string
  /** Sleeper id, tried as well as the name because chart contents vary. */
  sleeperId?: string | null
  team: string | null
  position: string | null
  sport?: string
}): Promise<DepthRole | null> {
  const { playerName, team, position } = args
  if (!team || !position) return null

  const entries = await getTeamDepthChart(team, args.sport ?? 'NFL').catch(() => [])
  const entry = entries.find((e) => e.position.toUpperCase() === position.toUpperCase())

  if (!entry || entry.players.length === 0) {
    return {
      position,
      rank: null,
      listed: 0,
      role: 'unlisted',
      basis: `We hold no depth chart for ${team} ${position}, so his role is unknown — not low, unknown.`,
    }
  }

  const target = normalise(playerName)
  const id = args.sleeperId ? String(args.sleeperId) : null
  const idx = entry.players.findIndex(
    (p) => normalise(String(p)) === target || (id != null && String(p) === id),
  )

  if (idx < 0) {
    return {
      position,
      rank: null,
      listed: entry.players.length,
      role: 'unlisted',
      basis: `He is not on ${team}'s ${position} chart, which lists ${entry.players.length}. That may mean he is behind them, or that the chart has not caught up with him — we cannot tell which, so this is not evidence against him.`,
    }
  }

  const rank = idx + 1
  const role: DepthRole['role'] =
    rank === 1 ? 'starter' : rank >= BURIED_FROM_RANK ? 'buried' : 'backup'

  return {
    position,
    rank,
    listed: entry.players.length,
    role,
    basis:
      role === 'starter'
        ? `Listed first at ${position} for ${team}. ⚠ The chart carries no history, so this cannot tell you whether he just won the job or has held it for years — and for a trade that is usually the question.`
        : role === 'backup'
          ? `Listed ${rank} of ${entry.players.length} at ${position} for ${team} — one injury from the job, and worth more to a roster that can afford to wait than to one that needs points now.`
          : `Listed ${rank} of ${entry.players.length} at ${position} for ${team}. He is not competing for snaps today, so anything you pay is for what changes, not for what he is.`,
  }
}

/**
 * The trade-facing sentence, or nothing.
 *
 * Only speaks when the role actually bears on a deal. "Listed second" on a
 * player nobody was arguing about is noise, and a panel of non-findings is one
 * managers stop reading.
 */
export function depthRoleNote(args: {
  playerName: string
  role: DepthRole | null
}): string | null {
  const { role } = args
  if (!role) return null
  if (role.role === 'unlisted' && role.listed === 0) return null
  if (role.role === 'starter') return null
  return `${args.playerName}: ${role.basis}`
}
