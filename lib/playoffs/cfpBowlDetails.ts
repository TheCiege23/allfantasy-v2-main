export type CfpBowlDetail = { label: string; startsAt?: string; venue?: string; homeTeamName?: string; awayTeamName?: string }
const names = ["Fiesta Bowl", "Cotton Bowl", "Peach Bowl", "Rose Bowl", "Orange Bowl", "Sugar Bowl"]

/** Extract only published CFP bowl details; unknown matchups and dates remain absent. */
export function parseCfpBowlDetails(payload: unknown): CfpBowlDetail[] {
  if (!payload || typeof payload !== "object") return []
  const data = payload as { season?: unknown; competition?: unknown; status?: unknown; rounds?: unknown }
  if (data.season !== 2026 || data.competition !== "cfp" || !["selected", "in_progress", "completed"].includes(String(data.status)) || !Array.isArray(data.rounds)) return []
  const out: CfpBowlDetail[] = []
  for (const round of data.rounds as Array<{ code?: string; matchups?: unknown }>) {
    if (!["quarterfinal", "semifinal"].includes(String(round.code)) || !Array.isArray(round.matchups)) continue
    for (const value of round.matchups) {
      if (!value || typeof value !== "object") continue
      const game = value as { bowlName?: unknown; startDate?: unknown; game?: { venue?: unknown }; slots?: Array<{ participant?: { school?: unknown } }> }
      const label = typeof game.bowlName === "string" ? names.find(name => game.bowlName!.toString().toLowerCase().includes(name.toLowerCase())) : undefined
      if (!label || out.some(item => item.label === label)) continue
      if (round.code === "quarterfinal" && ["Orange Bowl", "Sugar Bowl"].includes(label)) continue
      if (round.code === "semifinal" && !["Orange Bowl", "Sugar Bowl"].includes(label)) continue
      const startsAt = typeof game.startDate === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(game.startDate) && Number.isFinite(Date.parse(game.startDate)) ? new Date(game.startDate).toISOString() : undefined
      const venue = typeof game.game?.venue === "string" ? game.game.venue.trim().slice(0, 120) || undefined : undefined
      const schools = Array.isArray(game.slots) ? game.slots.map(slot => typeof slot?.participant?.school === "string" ? slot.participant.school.trim().slice(0, 120) : "") : []
      const teams = schools.length === 2 && schools.every(Boolean) && schools[0] !== schools[1] ? { homeTeamName: schools[0], awayTeamName: schools[1] } : {}
      out.push({ label, startsAt, venue, ...teams })
    }
  }
  return out
}
