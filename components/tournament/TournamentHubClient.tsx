'use client'

interface Conference {
  id: string
  name: string
  theme: string
  leagues: Array<{
    id: string
    leagueId: string
    league: { id: string; name: string | null; leagueSize: number | null }
    roundIndex: number
    phase: string
    orderInConference: number
  }>
}

interface Round {
  id: string
  roundIndex: number
  phase: string
  name: string | null
  startWeek: number | null
  endWeek: number | null
  status: string
}

