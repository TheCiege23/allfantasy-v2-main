import type { SportConfig } from '@prisma/client'

export type StatCategoryRow = { key: string; label: string; points: number }

export type PlayoffStructure = {
  upperBracket: { round: number; matchups: { home: string; away: string | null }[] }[]
  lowerBracket?: { round: number; matchups: { home: string; away: string | null }[] }[]
}

export type { SportConfig }
