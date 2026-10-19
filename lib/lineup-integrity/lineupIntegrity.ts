/**
 * Lineup-integrity monitor (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 7) — pure audit.
 *
 * After a week is final, which teams STARTED a lineup that could not score: an empty starting
 * slot, a starter whose club was on bye, or a starter who scored nothing and is listed Out / IR.
 * This is evidence for a tanking or inactivity ruling, not a ruling — the commissioner decides.
 *
 * ⚠ TWO HARD SIGNALS AND ONE SOFT ONE, AND THEY ARE KEPT APART ON PURPOSE.
 *   empty slot   required starters minus the starters the platform recorded — a fact
 *   on bye       the starter's club had no game that week (the stored schedule) — a fact
 *   ruled out    scored 0 AND is listed Out / IR TODAY. Injury status is only stored as it is now,
 *                not as it was at lock, so this can be wrong: a player hurt on Monday night reads as
 *                "ruled out" for Sunday. It is shown as a soft signal, never counted toward a flag.
 *
 * ⚠ A WEEK WITH NO RECORDED STARTERS FOR A TEAM IS SKIPPED, NOT COUNTED AS EMPTY. The Sleeper
 * import drops a starter whose points are null, and a missing feed looks exactly like an empty
 * lineup. Only a team with at least one recorded starter that week is audited.
 */

export type WeeklyStarterRow = {
  week: number
  rosterId: number | null
  playerId: string
  isStarter: boolean
  points: number | null
}

export type TeamWeekFinding = {
  week: number
  rosterId: number
  teamName: string
  emptySlots: number
  byeStarters: string[]
  ruledOutStarters: string[]
}

export type TeamSeasonSummary = {
  rosterId: number
  teamName: string
  weeksAudited: number
  weeksFlagged: number
  emptySlots: number
  byeStarts: number
  ruledOutStarts: number
}

export type AuditInput = {
  rows: WeeklyStarterRow[]
  requiredStarters: number
  /** Club abbreviation → bye week. A club missing from the map has an unknown bye, never "no bye". */
  byeWeekByClub: Record<string, number>
  clubByPlayer: ReadonlyMap<string, string | null>
  /** Players listed Out / IR now (see the soft-signal note above). */
  ruledOutNow: ReadonlySet<string>
  teamNameByRoster: ReadonlyMap<number, string>
}

/** A finding is a FLAG only on hard evidence: an empty slot or a bye starter. */
export function isFlagged(f: Pick<TeamWeekFinding, 'emptySlots' | 'byeStarters'>): boolean {
  return f.emptySlots > 0 || f.byeStarters.length > 0
}

export function auditLineups(input: AuditInput): { findings: TeamWeekFinding[]; summary: TeamSeasonSummary[]; weeks: number[] } {
  const byTeamWeek = new Map<string, { week: number; rosterId: number; starters: WeeklyStarterRow[] }>()
  for (const r of input.rows) {
    if (!r.isStarter || r.rosterId == null) continue
    const key = `${r.rosterId}:${r.week}`
    const entry = byTeamWeek.get(key) ?? { week: r.week, rosterId: r.rosterId, starters: [] }
    entry.starters.push(r)
    byTeamWeek.set(key, entry)
  }

  const name = (rosterId: number) => input.teamNameByRoster.get(rosterId) ?? `Team ${rosterId}`
  const findings: TeamWeekFinding[] = []
  const summary = new Map<number, TeamSeasonSummary>()
  for (const { week, rosterId, starters } of byTeamWeek.values()) {
    const s = summary.get(rosterId) ?? { rosterId, teamName: name(rosterId), weeksAudited: 0, weeksFlagged: 0, emptySlots: 0, byeStarts: 0, ruledOutStarts: 0 }
    s.weeksAudited++
    const emptySlots = input.requiredStarters > 0 ? Math.max(0, input.requiredStarters - starters.length) : 0
    const byeStarters = starters
      .filter((r) => {
        const club = input.clubByPlayer.get(r.playerId)
        return club != null && input.byeWeekByClub[club] === week
      })
      .map((r) => r.playerId)
    const ruledOutStarters = starters
      .filter((r) => (r.points ?? 0) === 0 && input.ruledOutNow.has(r.playerId) && !byeStarters.includes(r.playerId))
      .map((r) => r.playerId)
    const f: TeamWeekFinding = { week, rosterId, teamName: name(rosterId), emptySlots, byeStarters, ruledOutStarters }
    if (isFlagged(f)) s.weeksFlagged++
    s.emptySlots += emptySlots
    s.byeStarts += byeStarters.length
    s.ruledOutStarts += ruledOutStarters.length
    summary.set(rosterId, s)
    if (isFlagged(f) || ruledOutStarters.length > 0) findings.push(f)
  }
  findings.sort((a, b) => b.week - a.week || a.teamName.localeCompare(b.teamName))
  const weeks = [...new Set([...byTeamWeek.values()].map((e) => e.week))].sort((a, b) => a - b)
  const ranked = [...summary.values()].sort(
    (a, b) => b.weeksFlagged - a.weeksFlagged || b.emptySlots + b.byeStarts - (a.emptySlots + a.byeStarts) || a.teamName.localeCompare(b.teamName),
  )
  return { findings, summary: ranked, weeks }
}

/** One plain sentence for a finding, naming players where we know them. */
export function describeFinding(f: TeamWeekFinding, playerName: (id: string) => string): string {
  const parts: string[] = []
  if (f.emptySlots > 0) parts.push(`${f.emptySlots} empty starting ${f.emptySlots === 1 ? 'slot' : 'slots'}`)
  if (f.byeStarters.length > 0) parts.push(`started ${f.byeStarters.map(playerName).join(', ')} on a bye`)
  if (f.ruledOutStarters.length > 0) parts.push(`started ${f.ruledOutStarters.map(playerName).join(', ')}, who scored 0 and is listed Out/IR now`)
  return `Week ${f.week}: ${f.teamName} — ${parts.join('; ')}.`
}
