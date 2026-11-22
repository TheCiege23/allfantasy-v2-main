import { prisma } from '@/lib/prisma'
import { formatLeagueAIContextPromptByLeagueId } from '@/lib/sportConfig/aiContextService'

type MatchupInsight = { insight: string }

export async function generateMatchupInsight(matchupId: string): Promise<MatchupInsight> {
  const m = await prisma.redraftMatchup.findFirst({
    where: { id: matchupId },
    select: { leagueId: true },
  })
  const ctx = m ? await formatLeagueAIContextPromptByLeagueId(m.leagueId) : null
  const prefix = ctx ? `${ctx}\n\n` : ''
  return { insight: `${prefix}Matchup insight pending wiring.` }
}
