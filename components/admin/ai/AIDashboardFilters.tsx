'use client'

export type DashboardFilterState = {
  dateFrom: string
  dateTo: string
  sport: string
  leagueType: string
  feature: string
  userSegment: string
  timeRange: '7d' | '30d' | 'all'
}

