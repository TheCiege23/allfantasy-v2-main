import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { setUserSessionCookie, getUserSessionFromCookie, clearUserSessionCookie, validateRequestOrigin } from '@/lib/api-auth'
import { logUserEventByUsername } from '@/lib/user-events'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export const POST = withApiUsage({ endpoint: "/api/legacy/session", tool: "LegacySession" })(async (req: NextRequest) => {
  try {
    if (!validateRequestOrigin(req)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const body = await req.json()
    const sleeperId = body.sleeper_id ? String(body.sleeper_id).trim() : undefined

    /*
     * This endpoint is the ROOT of the legacy IDOR class: it minted the `af_session`
     * cookie from a `sleeper_username` in the body with nothing but an origin check, so
     * the attack was two calls — mint a cookie naming the victim, then use it. The cookie
     * is HMAC-signed, which prevents tampering but never prevented lying at mint time.
     *
     * It can now only mint a cookie for the caller's OWN linked username. The origin check
     * above is kept and is legitimate here — this is a state-changing, cookie-setting
     * endpoint, so it wants CSRF protection. What was wrong was ever treating that check
     * as authentication.
     */
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'session_create', maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername

    setUserSessionCookie({
      sleeperUsername,
      sleeperId,
    })

    const referrer = typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null
    const utmSource = typeof body.utm_source === 'string' ? body.utm_source.slice(0, 128) : null
    const utmMedium = typeof body.utm_medium === 'string' ? body.utm_medium.slice(0, 128) : null
    const utmCampaign = typeof body.utm_campaign === 'string' ? body.utm_campaign.slice(0, 128) : null

    logUserEventByUsername(sleeperUsername, 'user_login', {
      ...(referrer ? { referrer } : {}),
      ...(utmSource ? { utm_source: utmSource } : {}),
      ...(utmMedium ? { utm_medium: utmMedium } : {}),
      ...(utmCampaign ? { utm_campaign: utmCampaign } : {}),
    })

    return NextResponse.json({ success: true, username: sleeperUsername })
  } catch (e) {
    console.error('Session create error:', e)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/session", tool: "LegacySession" })(async (req: NextRequest) => {
  try {
    if (!validateRequestOrigin(req)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    const session = getUserSessionFromCookie()

    if (!session) {
      return NextResponse.json({ authenticated: false, user: null })
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        sleeperUsername: session.sleeperUsername,
        sleeperId: session.sleeperId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    })
  } catch (e) {
    console.error('Session check error:', e)
    return NextResponse.json({ error: 'Failed to check session' }, { status: 500 })
  }
})

export const DELETE = withApiUsage({ endpoint: "/api/legacy/session", tool: "LegacySession" })(async (req: NextRequest) => {
  try {
    if (!validateRequestOrigin(req)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }

    clearUserSessionCookie()

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Session delete error:', e)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
})
