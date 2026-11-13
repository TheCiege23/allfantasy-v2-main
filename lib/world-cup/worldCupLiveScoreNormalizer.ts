import type { ApiFootballWorldCupFixture } from "./apiSportsWorldCup"
import {
  normalizeWorldCupFixture,
  normalizeWorldCupStatus,
} from "./apiSportsWorldCup"
import type { WorldCupProviderFixture } from "./worldCupDataProvider"
import type { NormalizedWorldCupLiveMatch } from "./live-providers/worldCupLiveProviderTypes"

/** Maps API-Football `fixture.status.short` to a coarse period label for UI/bracket rows. */
export function inferPeriodFromApiFootballShort(short?: string | null): string | null {
  const c = (short || "").toUpperCase()
  if (["ET", "BT", "E1", "E2"].includes(c)) return "extra_time"
  if (c === "P") return "penalties"
  if (c === "1H") return "first_half"
  if (c === "2H") return "second_half"
  if (c === "HT") return "halftime"
  return null
}

/**
 * Normalizes an API-Football / API-SPORTS soccer fixture into the shared live-match shape.
 */
export function apiFootballFixtureToNormalizedLive(
  f: ApiFootballWorldCupFixture
): NormalizedWorldCupLiveMatch {
  const n = normalizeWorldCupFixture(f)
  const short = f.fixture.status?.short ?? null
  const winnerTeamId =
    n.winnerApiTeamId != null ? String(n.winnerApiTeamId) : null

  return {
    providerMatchId: String(f.fixture.id),
    homeTeamName: n.home.name,
    awayTeamName: n.away.name,
    homeTeamId: String(n.home.apiTeamId),
    awayTeamId: String(n.away.apiTeamId),
    homeScore: n.homeScore,
    awayScore: n.awayScore,
    status: n.status,
    minute: f.fixture.status?.elapsed ?? null,
    period: inferPeriodFromApiFootballShort(short),
    startsAt: n.date,
    winnerTeamId,
    winnerTeamName: n.winnerName,
    penaltyHomeScore: n.homePenaltyScore,
    penaltyAwayScore: n.awayPenaltyScore,
    apiStatusShort: short,
    injuryTime: f.fixture.status?.extra ?? null,
    homeTeamLogo: n.home.logo,
    awayTeamLogo: n.away.logo,
    raw: f,
  }
}

/** Bridge from unified live rows back into `WorldCupProviderFixture` for DB sync. */
export function normalizedLiveMatchToProviderFixture(
  m: NormalizedWorldCupLiveMatch
): WorldCupProviderFixture {
  return {
    providerId: m.providerMatchId,
    homeProviderId: m.homeTeamId,
    awayProviderId: m.awayTeamId,
    homeName: m.homeTeamName,
    awayName: m.awayTeamName,
    homeLogo: m.homeTeamLogo ?? null,
    awayLogo: m.awayTeamLogo ?? null,
    startsAt: m.startsAt,
    status: m.status,
    elapsedMinute: m.minute,
    injuryTime: m.injuryTime ?? null,
    period: m.period,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homePenaltyScore: m.penaltyHomeScore,
    awayPenaltyScore: m.penaltyAwayScore,
    winnerProviderId: m.winnerTeamId,
    winnerName: m.winnerTeamName,
    apiStatusShort: m.apiStatusShort,
    raw: m.raw,
  }
}

/**
 * Accepts fully-normalized rows or loose provider-shaped objects (coerced per-row).
 */
export function normalizeManualLivePayload(body: unknown): NormalizedWorldCupLiveMatch[] {
  if (body == null) return []
  const rawList = Array.isArray(body)
    ? body
    : typeof body === "object" &&
        body !== null &&
        "matches" in body &&
        Array.isArray((body as { matches?: unknown }).matches)
      ? ((body as { matches: unknown[] }).matches ?? [])
      : []

  const out: NormalizedWorldCupLiveMatch[] = []
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    if ("providerMatchId" in rec && rec.providerMatchId != null) {
      const prelim = rec as unknown as NormalizedWorldCupLiveMatch
      if (
        typeof prelim.homeTeamName === "string" &&
        typeof prelim.awayTeamName === "string"
      ) {
        out.push(prelim)
        continue
      }
    }
    const c = coerceNormalizedLiveMatch(rec)
    if (c) out.push(c)
  }
  return out
}

/**
 * Coerces loose JSON keys into `NormalizedWorldCupLiveMatch` (operator feeds / placeholder APIs).
 */
export function coerceNormalizedLiveMatch(row: Record<string, unknown>): NormalizedWorldCupLiveMatch | null {
  const providerMatchId =
    row.providerMatchId ?? row.idEvent ?? row.id ?? row.fixtureId
  if (providerMatchId == null || String(providerMatchId).trim() === "") return null

  const apiShortGuess =
    typeof row.apiStatusShort === "string" ? row.apiStatusShort : null
  const longGuess =
    typeof row.strLong === "string"
      ? row.strLong
      : typeof row.strStatus === "string"
        ? row.strStatus
        : typeof row.matchStatus === "string"
          ? row.matchStatus
          : null

  let status: NormalizedWorldCupLiveMatch["status"]
  const explicit = typeof row.status === "string" ? row.status : ""
  if (
    explicit === "scheduled" ||
    explicit === "live" ||
    explicit === "halftime" ||
    explicit === "final" ||
    explicit === "postponed" ||
    explicit === "cancelled"
  ) {
    status = explicit
  } else {
    status = normalizeWorldCupStatus(apiShortGuess, longGuess)
  }

  return {
    matchId: row.matchId != null ? String(row.matchId) : null,
    providerMatchId: String(providerMatchId),
    homeTeamName: String(row.homeTeamName ?? row.strHomeTeam ?? row.homeName ?? ""),
    awayTeamName: String(row.awayTeamName ?? row.strAwayTeam ?? row.awayName ?? ""),
    homeTeamId:
      row.homeTeamId != null
        ? String(row.homeTeamId)
        : row.idHomeTeam != null
          ? String(row.idHomeTeam)
          : null,
    awayTeamId:
      row.awayTeamId != null
        ? String(row.awayTeamId)
        : row.idAwayTeam != null
          ? String(row.idAwayTeam)
          : null,
    homeScore:
      row.homeScore != null
        ? Number(row.homeScore)
        : row.intHomeScore != null
          ? Number(row.intHomeScore)
          : null,
    awayScore:
      row.awayScore != null
        ? Number(row.awayScore)
          : row.intAwayScore != null
            ? Number(row.intAwayScore)
            : null,
    status,
    minute:
      row.minute != null
        ? Number(row.minute)
        : row.intTime != null
          ? Number(row.intTime)
          : null,
    period: row.period != null ? String(row.period) : null,
    startsAt:
      row.startsAt != null
        ? String(row.startsAt)
        : row.strTimestamp != null
          ? String(row.strTimestamp)
          : row.dateEvent != null
            ? String(row.dateEvent)
            : null,
    winnerTeamId:
      row.winnerTeamId != null ? String(row.winnerTeamId) : null,
    winnerTeamName:
      row.winnerTeamName != null ? String(row.winnerTeamName) : null,
    penaltyHomeScore:
      row.penaltyHomeScore != null ? Number(row.penaltyHomeScore) : null,
    penaltyAwayScore:
      row.penaltyAwayScore != null ? Number(row.penaltyAwayScore) : null,
    apiStatusShort:
      row.apiStatusShort != null ? String(row.apiStatusShort) : null,
    injuryTime: row.injuryTime != null ? Number(row.injuryTime) : null,
    homeTeamLogo: row.homeTeamLogo != null ? String(row.homeTeamLogo) : null,
    awayTeamLogo: row.awayTeamLogo != null ? String(row.awayTeamLogo) : null,
    raw: row,
  }
}
