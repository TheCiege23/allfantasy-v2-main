/**
 * Projected starting goalies (2026-11-28) — from our own box scores, never presented as confirmed.
 *
 * WHY "PROJECTED". Nothing we ingest carries a confirmed starter: no provider contract in
 * `contracts/` documents one, and the NHL publishes the goalie only once the game is under way.
 * Confirmed-starter services gather it from morning skates and beat reporters; adding one is a
 * vendor decision, not code. Until then this says what the record supports and why, and labels it so.
 *
 * The rule, from the team's own recent games:
 *   1. Each past game's starter is the goalie with the most time on ice for that team that night
 *      (a dressed backup is listed at 0:00). A starter pulled early can be mislabelled; ties are skipped.
 *   2. The team's No. 1 is whoever started most of its last `WINDOW` games.
 *   3. On the SECOND night of a back-to-back, if the No. 1 started the first night and the team has
 *      a backup who has started this season's window, the backup is projected instead — the one
 *      rotation pattern teams follow reliably enough to state.
 *   4. Confidence is the No. 1's share of recent starts: ≥ 70% "likely", otherwise "lean"; the
 *      back-to-back case is always "lean". Fewer than `MIN_GAMES` recent games: no projection.
 *   5. A game already under way or final has a box line: the goalie with ice time is "in net".
 */

export const GOALIE_WINDOW = 10
export const GOALIE_MIN_GAMES = 3

export type GoalieLine = {
  /** PlayerIdentityMap id. */
  playerId: string
  name: string
  /** Team code (dailyTeamCode). */
  team: string
  /** Eastern day `YYYY-MM-DD`. */
  day: string
  /** Decimal minutes; 0 or null for a dressed backup. */
  toi: number | null
}

export type UpcomingGame = { day: string; team: string; opponent: string; home: boolean }

export type GoalieStartProjection = {
  day: string
  team: string
  opponent: string
  home: boolean
  status: 'in_net' | 'projected'
  confidence: 'confirmed_in_game' | 'likely' | 'lean'
  goalie: { playerId: string; name: string }
  /** The other goalie in the picture, when there is one. */
  alternate: { playerId: string; name: string } | null
  /** Plain-language reason, shown with the projection. */
  basis: string
  /** Starts of the projected goalie in the team's last `games` games. */
  starts: number
  games: number
}

const DAY_MS = 86_400_000
const prevDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)

/** One starter per (team, day): the goalie with the most ice time; null when it cannot be told. */
function startersByTeam(lines: readonly GoalieLine[]): Map<string, Array<{ day: string; playerId: string; name: string }>> {
  const byGame = new Map<string, GoalieLine[]>()
  for (const l of lines) {
    const k = `${l.team}|${l.day}`
    const list = byGame.get(k) ?? []
    list.push(l)
    byGame.set(k, list)
  }
  const out = new Map<string, Array<{ day: string; playerId: string; name: string }>>()
  for (const [k, list] of byGame) {
    const played = list.filter((l) => (l.toi ?? 0) > 0).sort((a, b) => (b.toi ?? 0) - (a.toi ?? 0))
    if (played.length === 0) continue
    if (played.length > 1 && played[0].toi === played[1].toi) continue
    const [team, day] = k.split('|')
    const arr = out.get(team) ?? []
    arr.push({ day, playerId: played[0].playerId, name: played[0].name })
    out.set(team, arr)
  }
  for (const arr of out.values()) arr.sort((a, b) => b.day.localeCompare(a.day)) // newest first
  return out
}

export function projectGoalieStarts(args: {
  lines: readonly GoalieLine[]
  upcoming: readonly UpcomingGame[]
}): GoalieStartProjection[] {
  const starters = startersByTeam(args.lines)
  const out: GoalieStartProjection[] = []

  for (const g of args.upcoming) {
    // Already under way or final: the box says who is in net.
    const tonight = args.lines.filter((l) => l.team === g.team && l.day === g.day && (l.toi ?? 0) > 0)
    if (tonight.length > 0) {
      const top = [...tonight].sort((a, b) => (b.toi ?? 0) - (a.toi ?? 0))[0]
      const other = tonight.find((l) => l.playerId !== top.playerId) ?? null
      out.push({
        ...g,
        status: 'in_net',
        confidence: 'confirmed_in_game',
        goalie: { playerId: top.playerId, name: top.name },
        alternate: other ? { playerId: other.playerId, name: other.name } : null,
        basis: other ? `${top.name} and ${other.name} have both played tonight.` : `${top.name} is in net tonight.`,
        starts: 0,
        games: 0,
      })
      continue
    }

    const recent = (starters.get(g.team) ?? []).filter((s) => s.day < g.day).slice(0, GOALIE_WINDOW)
    if (recent.length < GOALIE_MIN_GAMES) continue
    const counts = new Map<string, { name: string; n: number }>()
    for (const s of recent) {
      const c = counts.get(s.playerId) ?? { name: s.name, n: 0 }
      c.n += 1
      counts.set(s.playerId, c)
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name))
    const [oneId, one] = ranked[0]
    const backup = ranked[1] ?? null

    const yesterday = recent[0]?.day === prevDay(g.day) ? recent[0] : null
    if (yesterday && yesterday.playerId === oneId && backup) {
      out.push({
        ...g,
        status: 'projected',
        confidence: 'lean',
        goalie: { playerId: backup[0], name: backup[1].name },
        alternate: { playerId: oneId, name: one.name },
        basis: `Second night of a back-to-back: ${one.name} started last night, so ${backup[1].name} is the likelier starter.`,
        starts: backup[1].n,
        games: recent.length,
      })
      continue
    }

    const share = one.n / recent.length
    out.push({
      ...g,
      status: 'projected',
      confidence: share >= 0.7 ? 'likely' : 'lean',
      goalie: { playerId: oneId, name: one.name },
      alternate: backup ? { playerId: backup[0], name: backup[1].name } : null,
      basis:
        `${one.name} has started ${one.n} of the last ${recent.length} games` +
        (yesterday?.playerId === oneId ? `, including last night.` : '.'),
      starts: one.n,
      games: recent.length,
    })
  }
  return out
}
