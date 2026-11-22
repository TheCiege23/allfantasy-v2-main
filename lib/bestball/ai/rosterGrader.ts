import type { BestBallSportTemplate } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { validateBestBallRoster } from '../rosterValidator'
import type { DraftedPlayer } from './draftAssistant'

type RosterGrade = {
  overallGrade: string
  positionalBalance: string
  weeklyCeiling: string
  weeklyFloor: string
  injuryFragility: string
  byeWeekDistribution: string
  tournamentUniqueness?: string
  strengths: string[]
  weaknesses: string[]
  actionableNote: string
}

export async function gradeBestBallRoster(
  roster: DraftedPlayer[],
  sport: string,
  variant: string,
  template: BestBallSportTemplate,
  draftSlot: number,
  leagueSize: number,
  opts?: { leagueId?: string; rosterId?: string },
): Promise<RosterGrade> {
  const v = validateBestBallRoster(
    roster.map((p) => ({ position: p.pos })),
    template,
  )
  const grade: RosterGrade = {
    overallGrade: 'B',
    positionalBalance: 'B',
    weeklyCeiling: 'B',
    weeklyFloor: 'B',
    injuryFragility: 'B',
    byeWeekDistribution: sport === 'NFL' ? 'B' : 'N/A',
    strengths: ['Depth-oriented build for best ball'],
    weaknesses: v.warnings.map((w) => w.issue),
    actionableNote: v.criticalErrors[0]?.issue ?? 'Monitor positional depth as the draft continues.',
  }
  if (variant === 'tournament') grade.tournamentUniqueness = 'B-'

  if (opts?.leagueId) {
    await prisma.bestBallAIInsight.create({
      data: {
        leagueId: opts.leagueId,
        rosterId: opts.rosterId ?? null,
        type: 'draft_grade',
        content: grade as object,
      },
    })
  }

  return grade
}
