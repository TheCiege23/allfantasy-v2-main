import type { SingleGameSport } from "./singleGameSchedule"

export type VerifiedBracketFinal = {
  eventId: string; homeScore: number; awayScore: number
  homeTeam: string; awayTeam: string; startsAt: string
}
export type EventCheck = { ok: true; final: VerifiedBracketFinal } | { ok: false; reason: string }

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}
function names(team: unknown): string[] {
  const value = object(team)
  return [value.displayName, value.location, value.shortDisplayName]
    .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    .map((name) => name.replace(/\s+/g, " ").trim().toLowerCase())
}
function score(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const text = String(value).trim()
  if (!/^\d{1,3}$/.test(text)) return null
  const number = Number(text)
  return Number.isInteger(number) && number <= 300 ? number : null
}
function sameTeam(expected: string, team: unknown): boolean {
  const normalized = expected.replace(/\s+/g, " ").trim().toLowerCase()
  return names(team).includes(normalized)
}

/** A mapped ESPN event must agree with the published bracket game before a score can be written. */
export function verifyBracketEvent(input: {
  payload: unknown; sport: SingleGameSport; season: number; eventId: string
  scheduledAt: string; homeTeam: string; awayTeam: string
}): EventCheck {
  const events = object(input.payload).events
  if (!Array.isArray(events)) return { ok: false, reason: "feed-unavailable" }
  const matches = events.filter((row) => String(object(row).id ?? "") === input.eventId)
  if (matches.length !== 1) return { ok: false, reason: matches.length ? "duplicate-event-id" : "event-not-found" }
  const event = object(matches[0])
  const competition = object(Array.isArray(event.competitions) ? event.competitions[0] : null)
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : []
  const home = competitors.filter((row: unknown) => object(row).homeAway === "home")
  const away = competitors.filter((row: unknown) => object(row).homeAway === "away")
  if (home.length !== 1 || away.length !== 1) return { ok: false, reason: "ambiguous-competitors" }
  const direct = sameTeam(input.homeTeam, object(home[0]).team) && sameTeam(input.awayTeam, object(away[0]).team)
  const reversed = sameTeam(input.homeTeam, object(away[0]).team) && sameTeam(input.awayTeam, object(home[0]).team)
  if (!direct && !reversed) return { ok: false, reason: "team-mismatch" }
  const actualAt = Date.parse(String(event.date ?? ""))
  const scheduledAt = Date.parse(input.scheduledAt)
  if (!Number.isFinite(actualAt) || !Number.isFinite(scheduledAt) || Math.abs(actualAt - scheduledAt) > 2 * 60 * 60 * 1000) {
    return { ok: false, reason: "start-time-mismatch" }
  }
  const eventSeason = object(event.season ?? object(input.payload).season)
  if (input.sport === "ncaaf" && (Number(eventSeason.year) !== input.season || Number(eventSeason.type) !== 3)) {
    return { ok: false, reason: "not-cfp-postseason" }
  }
  if (input.sport === "nba_cup" && new Date(actualAt).getUTCFullYear() !== input.season) {
    return { ok: false, reason: "wrong-cup-season" }
  }
  const notes = Array.isArray(competition.notes) ? competition.notes : []
  const headlines = notes.map((note: unknown) => String(object(note).headline ?? ""))
  if (input.sport === "ncaaf" && !headlines.some((headline: string) => /College Football Playoff/i.test(headline))) {
    return { ok: false, reason: "not-cfp-event" }
  }
  if (input.sport === "nba_cup" && !headlines.some((headline: string) => /\bNBA Cup\b/i.test(headline))) {
    return { ok: false, reason: "not-nba-cup-event" }
  }
  const status = object(object(competition.status).type)
  if (status.state !== "post" || status.completed !== true) return { ok: false, reason: "not-final" }
  const homeScore = score(object(direct ? home[0] : away[0]).score)
  const awayScore = score(object(direct ? away[0] : home[0]).score)
  if (homeScore == null || awayScore == null || homeScore === awayScore) return { ok: false, reason: "invalid-final-score" }
  return {
    ok: true,
    final: { eventId: input.eventId, homeScore, awayScore, homeTeam: input.homeTeam, awayTeam: input.awayTeam, startsAt: new Date(actualAt).toISOString() },
  }
}
