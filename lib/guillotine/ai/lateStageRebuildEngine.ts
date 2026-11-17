type LateStageStrategy = {
  headline: string
  priorities: string[]
  faabNote: string
}

export async function generateLateStageStrategy(_rosterId: string, _seasonId: string): Promise<LateStageStrategy> {
  return {
    headline: 'Final stage: shift from pure floor to championship ceiling.',
    priorities: ['Identify one more elite piece', 'Track FAAB of finalists'],
    faabNote: 'Spend decisively if a league-winning player hits the wire.',
  }
}
