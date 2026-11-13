'use client'

// ── Shared Types ──

export type LiveScoreGame = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  status: string
  quarter?: string | null
  clock?: string | null
  sport: string
  startTime: string | null
}

export type GameWeather = {
  team: string
  venue: string
  isDome: boolean
  temp?: number
  wind?: number
  impact?: string
}

export type StandingRow = {
  rank: number
  teamName: string
  teamLogo?: string
  wins: number
  losses: number
  ties?: number
  pointsFor?: number
  pointsAgainst?: number
  streak?: string
}

export type DepthChartEntry = {
  team: string
  position: string
  players: string[]
  source: string
}

