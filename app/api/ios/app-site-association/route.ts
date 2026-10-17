import { NextResponse } from 'next/server'

import { appSiteAssociation, isAppleTeamId } from '@/lib/platform/appSiteAssociation'

/**
 * GET /.well-known/apple-app-site-association (via the next.config rewrite).
 *
 * The Team ID is read at request time from the web service's own Apple settings — the same team the
 * native push sender uses (APNS_TEAM_ID, falling back to APPLE_TEAM_ID; lib/push-notifications/apns.ts)
 * — so it is never committed. Without one this answers 404: no association, links keep opening in
 * Safari exactly as before. Must be 200 with no redirect for Apple to accept it.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  // `||`, not `??`: an APNS_TEAM_ID that is SET but blank must still fall back to APPLE_TEAM_ID.
  const teamId = process.env.APNS_TEAM_ID?.trim() || process.env.APPLE_TEAM_ID?.trim()
  if (!isAppleTeamId(teamId)) return new NextResponse('Not found', { status: 404 })
  return NextResponse.json(appSiteAssociation(teamId), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}
