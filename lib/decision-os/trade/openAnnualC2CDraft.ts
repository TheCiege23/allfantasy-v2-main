import 'server-only'

import { prisma } from '@/lib/prisma'
import { OPEN_DRAFT_SESSION_STATUSES, CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { ANNUAL_C2C_DRAFT, annualC2CDraftSeason } from '@/lib/live-draft-engine/annualC2CDraft'

export async function readOpenAnnualC2CDraft(leagueId: string) {
  const draft = await prisma.draftSession.findFirst({
    where: { leagueId, sessionKind: 'live', status: { in: [...OPEN_DRAFT_SESSION_STATUSES] }, draftModeLabel: ANNUAL_C2C_DRAFT },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { draftModeLabel: true, c2cConfig: true, rounds: true, teamCount: true },
  })
  const year = annualC2CDraftSeason(draft)
  return draft && year != null ? { year, rounds: draft.rounds, teams: draft.teamCount } : null
}
