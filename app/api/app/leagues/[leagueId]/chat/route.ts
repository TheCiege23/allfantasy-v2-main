import { NextRequest } from 'next/server'
import { proxyToExisting } from '@/lib/api/proxy-adapter'

/*
 * League chat for the main-app `League.id` (uuid) space.
 *
 * ⚠ This used to proxy to `/api/bracket/leagues/{id}/chat`, which gates on
 * `BracketLeagueMember` — the Bracket Challenge product's league space. A
 * fantasy `League.id` never has a BracketLeagueMember row, so every member of
 * every imported league (owner included) got a 403 "Not a member". Same wrong-
 * target class docs/league-workflow-audit.md flags for the standings proxy.
 * The real fantasy league chat is `/api/league/chat` (LeagueChatMessage),
 * which takes `leagueId` as a query param on GET and in the JSON body on POST.
 */
export async function GET(req: NextRequest, { params }: { params: { leagueId: string } }) {
  return proxyToExisting(req, {
    targetPath: '/api/league/chat',
    query: { leagueId: params.leagueId },
  })
}

export async function POST(req: NextRequest, { params }: { params: { leagueId: string } }) {
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null
  return proxyToExisting(req, {
    targetPath: '/api/league/chat',
    body: { ...(raw ?? {}), leagueId: params.leagueId },
  })
}
