import type { z } from 'zod'
import { PostDraftGradeSchema } from './schemas'

type PostDraftGrade = z.infer<typeof PostDraftGradeSchema>

interface TeamDraftGradeInput {
  teamName: string
  picks: Array<{ playerName: string; position: string; overallPick: number; adpAtPick?: number | null }>
}

export function gradeTeamDraft(input: TeamDraftGradeInput): PostDraftGrade {
  let valueScore = 0
  let n = 0
  for (const p of input.picks) {
    if (p.adpAtPick != null) {
      valueScore += p.adpAtPick - p.overallPick
      n += 1
    }
  }
  const avgEdge = n > 0 ? valueScore / n : 0
  const numericScore = Math.round(clamp(72 + avgEdge * 1.2, 40, 99))
  const letter =
    numericScore >= 93 ? 'A+' : numericScore >= 88 ? 'A' : numericScore >= 82 ? 'B+' : numericScore >= 75 ? 'B' : 'C+'

  const sorted = [...input.picks].sort((a, b) => (b.adpAtPick ?? 0) - (a.adpAtPick ?? 0))
  const bestPick = sorted[0]?.playerName ?? '—'
  const reach = [...input.picks].sort((a, b) => (a.overallPick - (a.adpAtPick ?? a.overallPick)))[0]

  return {
    teamName: input.teamName,
    letterGrade: letter,
    numericScore,
    bestPick,
    biggestReach: reach ? `${reach.playerName} (early vs ADP)` : '—',
    summary: `Composite grade from ADP value vs pick slot${n ? ` across ${n} graded picks` : ''}.`,
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

