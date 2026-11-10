import { z } from 'zod'

const score = z.number().finite().min(-1_000_000).max(1_000_000).refine(value =>
  Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.00001, 'Use up to four decimal places.')
export const recoveryReason = z.string().trim().min(1).max(500)
export const recoveryId = z.string().trim().min(1).max(200)
export const scoreCorrectionSchema = z.object({ matchupId: recoveryId, homeScore: score, awayScore: score }).strict()
export type ScoreCorrection = z.infer<typeof scoreCorrectionSchema>
export type RecoveryImpact = {
  eligible: boolean
  explanation: string
  affectedStage: number
  rooms: number
  started: number
  picks: number
  entrantsIn?: string[]
  entrantsOut?: string[]
  changedSeeds?: number
  canReopen?: boolean
}
export type RecoveryCase = {
  id: string
  openedAt: string
  reason: string
  ownerId: string
  stage: number
  impact: RecoveryImpact
} & (
  { kind: 'withdrawal'; manager: string; replacement?: string } |
  { kind: 'correction'; matchupId: string; period: number; home: string; away: string | null; before: [number, number]; after: [number, number] }
)
export type RecoveryMatch = {
  id: string; leagueName: string; home: string; away: string | null; homeScore: number; awayScore: number
}
