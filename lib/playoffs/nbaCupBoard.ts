import type { PlayoffSeriesView } from "./types"
import { nbaCupLogoCode } from "@/lib/players/teamLogos"
import { cupGameDetails } from "./nbaCupProgress"

/**
 * NBA Cup Group Play, derived for the pool page: per-game live detail, group
 * standings, clinch / elimination status, the wild-card race and the projected
 * quarterfinal field.
 *
 * ⚠ EVERYTHING HERE IS DERIVED FROM THE STORED GAME ROWS, NOTHING IS FETCHED.
 * The provider is read by `syncNbaCupTournament`; this module only does
 * arithmetic on what that writer stored, so it is safe on the client.
 *
 * ⚠ GROUPS ARE RECOVERED FROM THE SCHEDULE, NOT DECLARED. ESPN labels a game
 * "NBA Cup - Group Play" and names no group. Every Group Play game is between
 * two teams of the same five-team group, so the connected components of the
 * "played each other" graph ARE the groups. Until enough of the schedule has
 * synced a component can be smaller than five; it then reads as a smaller
 * group rather than being merged into a guess. The official letters (A/B/C)
 * are not in the feed either, so groups are numbered in a stable order.
 */

export type CupLeader = { name: string; points: number }

type CupGameDetail = {
  detail: string | null
  period: number | null
  clock: string | null
  homeLeader: CupLeader | null
  awayLeader: CupLeader | null
  homeLines: number[]
  awayLines: number[]
  homeColor: string | null
  awayColor: string | null
  homeAbbr: string | null
  awayAbbr: string | null
}

function leader(value: unknown): CupLeader | null {
  const row = value as { name?: unknown; points?: unknown } | null
  return row && typeof row.name === "string" && row.name && Number.isFinite(Number(row.points))
    ? { name: row.name, points: Number(row.points) }
    : null
}

function lines(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : []
}

function color(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null
}

function text(value: unknown, max = 40): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null
}

/** Read the live block the sync writes into `providerGamesJson`. Absent fields read as unknown. */
export function cupGameDetail(series: Pick<PlayoffSeriesView, "providerGamesJson">): CupGameDetail {
  const json = (series.providerGamesJson ?? {}) as { live?: Record<string, unknown>; teams?: Record<string, unknown> }
  const live = json.live ?? {}
  const teams = json.teams ?? {}
  const period = Number(live.period)
  const details = cupGameDetails(series)
  const tiedLeader = (rows: typeof details.homeLeaders): CupLeader | null => rows?.length
    ? { name: rows.map((row) => row.name).join(" / "), points: rows[0].points } : null
  return {
    detail: text(live.detail) ?? details.statusDetail ?? null,
    period: Number.isInteger(period) && period > 0 ? period : details.period ?? null,
    clock: text(live.clock, 12) ?? details.clock ?? null,
    homeLeader: tiedLeader(details.homeLeaders) ?? leader(live.homeLeader),
    awayLeader: tiedLeader(details.awayLeaders) ?? leader(live.awayLeader),
    homeLines: lines(live.homeLines),
    awayLines: lines(live.awayLines),
    homeColor: color(teams.homeColor),
    awayColor: color(teams.awayColor),
    homeAbbr: text(teams.homeAbbr, 5),
    awayAbbr: text(teams.awayAbbr, 5),
  }
}

/** The league's own three-letter code ("ATL", "NYK"), never a guessed shortening of the nickname. */
export function cupTeamCode(name: string, fromFeed?: string | null): string {
  return nbaCupLogoCode(name) ?? fromFeed ?? name.split(/\s+/).pop()?.slice(0, 3).toUpperCase() ?? name
}

type CupGameState = "live" | "final" | "scheduled"

export function cupGameState(series: Pick<PlayoffSeriesView, "status" | "winnerTeamName">): CupGameState {
  if (series.status === "final" || series.winnerTeamName) return "final"
  if (series.status === "in_progress") return "live"
  return "scheduled"
}

/** "Q3 4:12", "Halftime", "OT 1:02". Falls back to the stored status line, then a plain label. */
export function cupLiveClock(series: PlayoffSeriesView): string {
  const d = cupGameDetail(series)
  if (d.detail && !/^final/i.test(d.detail)) {
    // ESPN's shortDetail reads "4:12 - 3rd"; the card has room for "Q3 4:12".
    const m = d.detail.match(/^(\d{1,2}:\d{2}|\d{1,2}\.\d)\s*-\s*(\d)(?:st|nd|rd|th)$/i)
    if (m) return `Q${m[2]} ${m[1]}`
    const ot = d.detail.match(/^(\d{1,2}:\d{2}|\d{1,2}\.\d)\s*-\s*(\d?)\s*OT$/i)
    if (ot) return `${ot[2] && ot[2] !== "1" ? `${ot[2]}OT` : "OT"} ${ot[1]}`
    return d.detail
  }
  if (d.period && d.clock) return d.period > 4 ? `OT ${d.clock}` : `Q${d.period} ${d.clock}`
  if (series.liveStatus && !/^(in_progress|scheduled|final)$/i.test(series.liveStatus)) return series.liveStatus
  return "Live"
}

/** Rough share of regulation played, for the live progress bar. Unknown reads as 0. */
export function cupGameProgress(series: PlayoffSeriesView): number {
  const d = cupGameDetail(series)
  if (!d.period) return 0
  if (d.period > 4) return 100
  const m = d.clock?.match(/^(\d{1,2}):(\d{2})$/)
  const left = m ? Number(m[1]) * 60 + Number(m[2]) : 0
  return Math.max(2, Math.min(100, Math.round(((d.period - 1) * 720 + (720 - left)) / 2880 * 100)))
}

// ── standings ───────────────────────────────────────────────────────────────

type CupResultDot = "W" | "L" | "live" | "todo"

type CupStatus =
  | "won_group" | "clinched_group" | "controls_path" | "needs_help"
  | "wild_card_only" | "wild_card" | "awaiting" | "eliminated"
  | "schedule_pending" | "tiebreak_pending" | "qualified"

export type CupTeamRow = {
  team: string
  conference: "east" | "west"
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDiff: number
  remaining: number
  results: CupResultDot[]
  status: CupStatus
  statusLabel: string
  path: string
  live: { opponent: string; teamScore: number | null; opponentScore: number | null; clock: string } | null
  nextGame: { opponent: string; home: boolean; startsAt: string | null } | null
}

export type CupGroup = {
  id: string
  label: string
  conference: "east" | "west"
  teams: CupTeamRow[]
  scheduleComplete: boolean
  complete: boolean
}

type CupSeedSlot = { seed: number; team: string; how: string; confirmed: boolean }

const STATUS_LABEL: Record<CupStatus, string> = {
  won_group: "Won group",
  clinched_group: "Clinched group",
  controls_path: "Controls own path",
  needs_help: "Needs help",
  wild_card_only: "Wild card only",
  wild_card: "Wild card",
  awaiting: "Awaiting other groups",
  eliminated: "Eliminated",
  schedule_pending: "Schedule pending",
  tiebreak_pending: "Tiebreak pending",
  qualified: "Qualified",
}

type Tally = { wins: number; losses: number; pf: number; pa: number }

function isGroupGame(row: PlayoffSeriesView): boolean {
  return row.round === "cup_group_play"
}

function scored(row: PlayoffSeriesView): boolean {
  return cupGameState(row) === "final" && row.liveHomeScore != null && row.liveAwayScore != null && Boolean(row.winnerTeamName)
}

function byStart(a: PlayoffSeriesView, b: PlayoffSeriesView): number {
  const x = Date.parse(a.startsAt ?? ""), y = Date.parse(b.startsAt ?? "")
  return (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity) || a.seriesNumber - b.seriesNumber
}

/**
 * Order a set of teams by the Cup tiebreakers this data can support: record,
 * head-to-head when exactly two are tied, point differential, points scored.
 * The league's last tiebreakers (prior-season record, a draw) are not in the
 * feed. Alphabetical order keeps the display stable; it must never confirm
 * qualification when the supported tiebreakers do not resolve a place.
 */
function rank(teams: string[], tally: Map<string, Tally>, games: PlayoffSeriesView[]): string[] {
  const t = (name: string) => tally.get(name)!
  const ordered = [...teams].sort((a, b) =>
    t(b).wins - t(a).wins || (t(b).pf - t(b).pa) - (t(a).pf - t(a).pa) || t(b).pf - t(a).pf || a.localeCompare(b))
  // Head-to-head for an exact two-way tie on wins.
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i], b = ordered[i + 1]
    const tied = ordered.filter((name) => t(name).wins === t(a).wins)
    if (tied.length !== 2 || t(a).wins !== t(b).wins) continue
    const meeting = games.find((g) => scored(g) && ((g.homeTeamName === a && g.awayTeamName === b) || (g.homeTeamName === b && g.awayTeamName === a)))
    if (meeting?.winnerTeamName === b) { ordered[i] = b; ordered[i + 1] = a }
  }
  return ordered
}

function shortDate(iso: string | null, timeZone?: string): string {
  const ms = Date.parse(iso ?? "")
  if (!Number.isFinite(ms)) return "date TBA"
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone }).format(new Date(ms))
}

export function buildNbaCupGroups(series: PlayoffSeriesView[], timeZone?: string): CupGroup[] {
  const games = series.filter(isGroupGame).slice().sort(byStart)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x) ?? x
    if (p === x) { parent.set(x, x); return x }
    const root = find(p)
    parent.set(x, root)
    return root
  }
  const conferenceOf = new Map<string, "east" | "west">()
  for (const g of games) {
    const conf = g.conference === "east" || g.conference === "west" ? g.conference : null
    if (!conf) continue
    conferenceOf.set(g.homeTeamName, conf)
    conferenceOf.set(g.awayTeamName, conf)
    parent.set(find(g.homeTeamName), find(g.awayTeamName))
  }
  const members = new Map<string, string[]>()
  for (const team of conferenceOf.keys()) {
    const root = find(team)
    members.set(root, [...(members.get(root) ?? []), team].sort())
  }

  const groups: CupGroup[] = []
  for (const conf of ["east", "west"] as const) {
    const sets = [...members.values()].filter((teams) => conferenceOf.get(teams[0]) === conf).sort((a, b) => a[0].localeCompare(b[0]))
    sets.forEach((teams, index) => {
      const set = new Set(teams)
      const own = games.filter((g) => set.has(g.homeTeamName) && set.has(g.awayTeamName))
      const tally = new Map<string, Tally>(teams.map((name) => [name, { wins: 0, losses: 0, pf: 0, pa: 0 }]))
      for (const g of own) {
        if (!scored(g)) continue
        const home = tally.get(g.homeTeamName)!, away = tally.get(g.awayTeamName)!
        const hs = Number(g.liveHomeScore), as = Number(g.liveAwayScore)
        home.pf += hs; home.pa += as; away.pf += as; away.pa += hs
        if (g.winnerTeamName === g.homeTeamName) { home.wins++; away.losses++ } else { away.wins++; home.losses++ }
      }
      const remainingOf = (name: string) => own.filter((g) => !scored(g) && (g.homeTeamName === name || g.awayTeamName === name))
      const pairs = new Set(own.map((game) => [game.homeTeamName, game.awayTeamName].sort().join("|")))
      const scheduleComplete = teams.length === 5 && own.length === 10 && pairs.size === 10 &&
        teams.every((name) => own.filter((game) => game.homeTeamName === name || game.awayTeamName === name).length === 4)
      const complete = scheduleComplete && own.every(scored)
      const order = rank(teams, tally, own)
      const rows: CupTeamRow[] = order.map((name, position) => {
        const me = tally.get(name)!
        const left = remainingOf(name)
        const maxWins = me.wins + left.length
        const others = teams.filter((other) => other !== name)
        const othersCeiling = Math.max(0, ...others.map((o) => tally.get(o)!.wins + remainingOf(o).length))
        // If this team wins out, every opponent it still plays loses that game.
        const othersIfWinOut = Math.max(0, ...others.map((o) => {
          const vsMe = remainingOf(o).filter((g) => g.homeTeamName === name || g.awayTeamName === name).length
          return tally.get(o)!.wins + remainingOf(o).length - vsMe
        }))
        const leaderWins = Math.max(0, ...others.map((o) => tally.get(o)!.wins))

        let status: CupStatus
        const tied = teams.filter((other) => tally.get(other)!.wins === me.wins)
        if (!scheduleComplete) status = "schedule_pending"
        // Multi-team tiebreaks need evidence this display does not resolve.
        else if (complete && tied.length > 2) status = "tiebreak_pending"
        else if (complete) status = position === 0 ? "won_group" : "awaiting"
        else if (me.wins > othersCeiling) status = "clinched_group"
        else if (maxWins > othersIfWinOut) status = "controls_path"
        else if (maxWins < leaderWins) status = "wild_card_only"
        else status = "needs_help"

        const mine = own.filter((g) => g.homeTeamName === name || g.awayTeamName === name)
        const results: CupResultDot[] = mine.map((g) =>
          scored(g) ? (g.winnerTeamName === name ? "W" : "L") : cupGameState(g) === "live" ? "live" : "todo")
        while (results.length < 4) results.push("todo")

        const liveGame = mine.find((g) => cupGameState(g) === "live")
        const next = left.find((g) => cupGameState(g) === "scheduled") ?? null
        const live = liveGame ? {
          opponent: liveGame.homeTeamName === name ? liveGame.awayTeamName : liveGame.homeTeamName,
          teamScore: liveGame.homeTeamName === name ? liveGame.liveHomeScore ?? null : liveGame.liveAwayScore ?? null,
          opponentScore: liveGame.homeTeamName === name ? liveGame.liveAwayScore ?? null : liveGame.liveHomeScore ?? null,
          clock: cupLiveClock(liveGame),
        } : null
        const nextGame = next ? {
          opponent: next.homeTeamName === name ? next.awayTeamName : next.homeTeamName,
          home: next.homeTeamName === name,
          startsAt: next.startsAt ?? null,
        } : null
        return {
          team: name, conference: conf, wins: me.wins, losses: me.losses, pointsFor: me.pf, pointsAgainst: me.pa,
          pointDiff: me.pf - me.pa, remaining: scheduleComplete ? left.length : Math.max(0, 4 - me.wins - me.losses), results, status, statusLabel: STATUS_LABEL[status],
          path: pathLine(status, nextGame, timeZone), live, nextGame,
        }
      })
      groups.push({ id: `${conf}-${index + 1}`, label: `${conf === "east" ? "East" : "West"} Group ${index + 1}`, conference: conf, teams: rows, scheduleComplete, complete })
    })
  }

  // Once every group in a conference is final, the wild card is decided too.
  for (const conf of ["east", "west"] as const) {
    const confGroups = groups.filter((g) => g.conference === conf)
    if (!cupConferenceComplete(groups, conf) || confGroups.some((g) => g.teams[0].status !== "won_group")) continue
    const race = wildCardRace(groups, conf)
    // Do not let an alphabetical or provisional points tiebreak award a berth.
    const wild = race[0] && (!race[1] || race[0].wins > race[1].wins) ? race[0].team : null
    for (const group of confGroups) {
      for (const row of group.teams.slice(1)) {
        row.status = wild ? row.team === wild ? "wild_card" : "eliminated"
          : row.wins === race[0]?.wins ? "tiebreak_pending" : "eliminated"
        row.statusLabel = STATUS_LABEL[row.status]
        row.path = pathLine(row.status, null)
      }
    }
  }
  // A published knockout participant is authoritative even if some group
  // games have not synced, or the available tiebreak data remains incomplete.
  const qualifiers = new Set(series.filter((game) => game.round === "cup_quarterfinals")
    .flatMap((game) => [game.homeTeamName, game.awayTeamName]).filter((team) => nbaCupLogoCode(team)))
  for (const group of groups) for (const row of group.teams) {
    if (!qualifiers.has(row.team)) continue
    row.status = "qualified"; row.statusLabel = STATUS_LABEL.qualified; row.path = pathLine("qualified", null)
  }
  return groups
}

/** All three five-team round robins must be present before conference decisions. */
export function cupConferenceComplete(groups: CupGroup[], conference: "east" | "west"): boolean {
  const own = groups.filter((group) => group.conference === conference)
  return own.length === 3 && own.every((group) => group.scheduleComplete && group.complete && group.teams.length === 5) &&
    new Set(own.flatMap((group) => group.teams.map((team) => team.team))).size === 15
}

function pathLine(status: CupStatus, next: CupTeamRow["nextGame"], timeZone?: string): string {
  const nextText = next ? ` Next: ${next.home ? "vs" : "at"} ${next.opponent}, ${shortDate(next.startsAt, timeZone)}.` : ""
  switch (status) {
    case "schedule_pending": return `The full group schedule is still syncing. Qualification is not confirmed.${nextText}`
    case "tiebreak_pending": return "Qualification awaits verified tiebreaks or the confirmed quarterfinal field."
    case "qualified": return "Confirmed in the quarterfinal field."
    case "won_group": return "Won the group. In the quarterfinals."
    case "clinched_group": return `Clinched the group and a quarterfinal spot.${nextText}`
    case "controls_path": return `Wins the group by winning out.${nextText}`
    case "needs_help": return `Can still win the group, but needs other results to fall its way.${nextText}`
    case "wild_card_only": return `Can't win the group. The wild card is the way in.${nextText}`
    case "wild_card": return "Best second-place record in the conference. In the quarterfinals."
    case "awaiting": return "Group play done. Waiting on the other groups for the wild card."
    case "eliminated": return "Out of the knockout round."
  }
}

/** Second-place teams across a conference's groups, best first: record, point differential, points scored. */
export function wildCardRace(groups: CupGroup[], conference: "east" | "west"): CupTeamRow[] {
  return groups.filter((g) => g.conference === conference && g.teams.length > 1).map((g) => g.teams[1])
    .sort((a, b) => b.wins - a.wins || b.pointDiff - a.pointDiff || b.pointsFor - a.pointsFor || a.team.localeCompare(b.team))
}

/**
 * The quarterfinal field as it stands: the three group leaders seeded 1–3 by
 * record, the wild card 4th. `confirmed` only when every group in the
 * conference is final. Returns [] until a game in the conference has finished,
 * because a projection from 0-0 records is alphabetical order, not a forecast.
 */
export function projectedQuarterfinalSeeds(groups: CupGroup[], conference: "east" | "west"): CupSeedSlot[] {
  const confGroups = groups.filter((g) => g.conference === conference && g.teams.length)
  // Once the actual field is published, use the real knockout bracket rather
  // than projecting a different field from incomplete group/tiebreak records.
  if (confGroups.some((group) => group.teams.some((team) => team.status === "qualified"))) return []
  if (!confGroups.some((g) => g.teams.some((t) => t.wins + t.losses > 0))) return []
  const race = wildCardRace(groups, conference)
  const seedOrderResolved = confGroups.every((a, i) => confGroups.every((b, j) => i === j ||
    a.teams[0].wins !== b.teams[0].wins || a.teams[0].pointDiff !== b.teams[0].pointDiff || a.teams[0].pointsFor !== b.teams[0].pointsFor))
  const confirmed = cupConferenceComplete(groups, conference) && seedOrderResolved &&
    confGroups.every((group) => group.teams[0].status === "won_group") && race[0]?.status === "wild_card"
  const leaders = confGroups.map((g) => ({ row: g.teams[0], label: g.label }))
    .sort((a, b) => b.row.wins - a.row.wins || b.row.pointDiff - a.row.pointDiff || b.row.pointsFor - a.row.pointsFor || a.row.team.localeCompare(b.row.team))
  const slots: CupSeedSlot[] = leaders.map((l, i) => ({ seed: i + 1, team: l.row.team, how: `${l.label} leader`, confirmed }))
  const wild = wildCardRace(groups, conference)[0]
  if (wild) slots.push({ seed: slots.length + 1, team: wild.team, how: "Wild card", confirmed })
  return slots
}

/** Which group a team plays in, if the schedule has placed it. */
export function groupForTeam(groups: CupGroup[], team: string): CupGroup | null {
  return groups.find((g) => g.teams.some((t) => t.team === team)) ?? null
}

