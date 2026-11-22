/**
 * worldCupDataProvider.ts
 *
 * Provider-neutral abstraction for World Cup data sources.
 * All external provider clients must conform to the WorldCupDataProvider interface.
 * Use getWorldCupDataProvider() to obtain a provider instance.
 */

// ── Provider names ────────────────────────────────────────────────────────────

export type WorldCupProviderName = "mock" | "apifootball" | "sportsdata" | "manual"

// ── Provider-neutral team ────────────────────────────────────────────────────

export type WorldCupProviderTeam = {
  /** Opaque ID used by the external provider */
  providerId: string
  /** Three-letter FIFA country code, e.g. "BRA" — may be null for placeholder entries */
  fifaCode?: string | null
  countryName: string
  displayName: string
  flagUrl?: string | null
  groupName?: string | null
  confederation?: string | null
  fifaRank?: number | null
  qualificationStatus?: string | null
}

// ── Provider-neutral fixture ──────────────────────────────────────────────────

export type WorldCupProviderFixture = {
  /** Opaque fixture ID used by the external provider */
  providerId: string
  homeProviderId?: string | null
  awayProviderId?: string | null
  homeFifaCode?: string | null
  awayFifaCode?: string | null
  homeName?: string | null
  awayName?: string | null
  homeLogo?: string | null
  awayLogo?: string | null
  startsAt?: string | null
  venueName?: string | null
  venueCity?: string | null
  roundName?: string | null
  groupName?: string | null
  stage?: string | null
  /** Normalized status using WorldCupMatchStatus vocabulary */
  status?: string | null
  elapsedMinute?: number | null
  injuryTime?: number | null
  period?: string | null
  homeScore?: number | null
  awayScore?: number | null
  homePenaltyScore?: number | null
  awayPenaltyScore?: number | null
  winnerProviderId?: string | null
  winnerFifaCode?: string | null
  winnerName?: string | null
  /** Raw provider status code, e.g. "1H", "FT", "PST" — stored as apiStatusShort */
  apiStatusShort?: string | null
  /** Full raw provider payload for debugging/audit */
  raw?: unknown
}

export type WorldCupProviderGroupStanding = {
  providerTeamId?: string | null
  fifaCode?: string | null
  teamName: string
  groupName: string
  rank: number
  points: number
  goalDifference: number
  goalsFor: number
  goalsAgainst?: number | null
  played?: number | null
  wins?: number | null
  draws?: number | null
  losses?: number | null
  raw?: unknown
}

type WorldCupProviderSquadPlayer = {
  providerPlayerId: string
  name: string
  shortName?: string | null
  position?: string | null
  positionCode?: string | null
  shirtNumber?: number | null
  birthDate?: string | null
  age?: number | null
  club?: string | null
  nationality?: string | null
  photoUrl?: string | null
  isCaptain?: boolean
  raw?: unknown
}

export type WorldCupProviderSquad = {
  providerTeamId: string
  teamName: string
  players: WorldCupProviderSquadPlayer[]
}

export type WorldCupProviderInjury = {
  providerPlayerId: string
  playerName: string
  teamProviderId?: string | null
  teamName: string
  status: string
  bodyPart?: string | null
  notes?: string | null
  fixtureProviderId?: string | null
  fixtureDate?: string | null
  raw?: unknown
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface WorldCupDataProvider {
  readonly name: WorldCupProviderName

  /** Fetch all teams for the given season year */
  getTeams(seasonYear: number): Promise<WorldCupProviderTeam[]>

  /** Fetch all fixtures for the given season year */
  getFixtures(seasonYear: number): Promise<WorldCupProviderFixture[]>

  /** Fetch group standings for deriving Round of 32 slots after group play. */
  getGroupStandings?(seasonYear: number): Promise<WorldCupProviderGroupStanding[]>

  /**
   * Fetch only live/in-progress fixtures.
   * Not all providers support this; falls back to getFixtures() if not implemented.
   */
  getLiveFixtures?(seasonYear: number): Promise<WorldCupProviderFixture[]>

  /** Fetch player/team injury reports when the provider exposes them. */
  getInjuries?(seasonYear: number): Promise<WorldCupProviderInjury[]>

  /** Fetch squad rosters for all teams in the tournament. */
  getSquads?(seasonYear: number): Promise<WorldCupProviderSquad[]>

  /**
   * Fetch a single fixture by provider ID.
   * Returns null if not found or provider doesn't support it.
   */
  getFixtureById?(providerId: string, seasonYear: number): Promise<WorldCupProviderFixture | null>
}

// ── Typed config error ────────────────────────────────────────────────────────

export class WorldCupProviderConfigError extends Error {
  constructor(
    public readonly provider: WorldCupProviderName,
    message: string
  ) {
    super(`[WorldCupProvider:${provider}] ${message}`)
    this.name = "WorldCupProviderConfigError"
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns the configured data provider.
 * Provider is selected by:
 *   1. explicit `name` argument
 *   2. WORLD_CUP_DATA_PROVIDER env var
 *   3. defaults to "mock"
 *
 * This is a lazy factory — it does not make network calls.
 */
export async function getWorldCupDataProvider(
  name?: WorldCupProviderName | string | null
): Promise<WorldCupDataProvider> {
  const selected = (name ??
    process.env.WORLD_CUP_DATA_PROVIDER ??
    "mock") as WorldCupProviderName

  switch (selected) {
    case "apifootball": {
      const { ApiFootballWorldCupProvider } = await import(
        "./providers/apiFootballWorldCupProvider"
      )
      return new ApiFootballWorldCupProvider()
    }
    case "sportsdata": {
      const { SportsDataWorldCupProvider } = await import(
        "./providers/sportsDataWorldCupProvider"
      )
      return new SportsDataWorldCupProvider()
    }
    case "manual":
    case "mock":
    default: {
      const { MockWorldCupProvider } = await import(
        "./providers/mockWorldCupProvider"
      )
      return new MockWorldCupProvider()
    }
  }
}
