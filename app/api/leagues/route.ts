/**
 * POST /api/leagues — canonical concept-first league creation (preset engine + Prisma transaction).
 */

import { postCreateLeague } from '@/lib/league-creation/canonical/createLeagueHandler'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  return postCreateLeague(req)
}
