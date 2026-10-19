/**
 * Shared mock harness for the dynasty-projections handler tests. No DB, no network:
 * every collaborator the handler reaches is replaced via vi.mock in the calling test file,
 * and this module only builds the fixtures and drives GET.
 */
import { vi } from 'vitest'

export type HarnessPlayer = {
  id: string
  name: string
  position: string
  birthYear: number | null
}

export type HarnessTeam = {
  externalId: string
  players: HarnessPlayer[]
}

export const state = {
  league: null as null | Record<string, unknown>,
  teams: [] as HarnessTeam[],
  generatedInputs: [] as any[],
}

export const prismaMock = {
  league: { findFirst: vi.fn(async () => state.league) },
  leagueTeam: {
    findMany: vi.fn(async () =>
      state.teams.map((t, i) => ({
        id: `lt-${t.externalId}`,
        externalId: t.externalId,
        ownerName: `owner-${t.externalId}`,
        teamName: `Team ${t.externalId}`,
        wins: i,
        losses: 0,
        pointsFor: 100 - i,
        aiPowerScore: 70,
      }))
    ),
  },
  roster: {
    findMany: vi.fn(async () =>
      state.teams.map((t) => ({
        id: `r-${t.externalId}`,
        platformUserId: t.externalId,
        playerData: { players: t.players.map((p) => p.id) },
      }))
    ),
  },
  draftSession: { findFirst: vi.fn(async () => null) },
  player: {
    findMany: vi.fn(async () =>
      state.teams.flatMap((t) =>
        t.players.map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          birthYear: p.birthYear,
          injuryStatus: null,
          projectedDraftRound: null,
        }))
      )
    ),
  },
  playerMetaTrend: { findMany: vi.fn(async () => []) },
}

export function setLeague(sport: string, teams: HarnessTeam[]) {
  state.league = {
    id: 'L1',
    platformLeagueId: 'L1',
    platform: 'sleeper',
    sport,
    season: 2027,
    isDynasty: true,
    leagueSize: teams.length,
    scoring: null,
    settings: {},
  }
  state.teams = teams
  state.generatedInputs = []
}

export function makeReq(qs: string) {
  return { nextUrl: new URL(`http://localhost/api/leagues/L1/dynasty-projections?${qs}`) } as any
}

export const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
