import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchEspnLeague, findTeamByName } from '@/lib/espn-client'
import { consumeRateLimit, getClientIp, buildRateLimit429 } from '@/lib/rate-limit'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { logUserEvent } from '@/lib/user-events'
import { isMissingDatabaseObjectError } from '@/lib/prisma/schema-drift'
import {
  signGuestSessionToken,
  GUEST_SESSION_COOKIE_NAME,
  GUEST_SESSION_MAX_AGE_SECONDS,
} from '@/lib/guest-mode/guestSessionToken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A visitor typing a league id + team name and clicking submit takes at least this long;
// anything faster than this after the form rendered is almost certainly a bot.
const MIN_HUMAN_FILL_TIME_MS = 1200

/*
 * Anonymous ESPN import for the /af-legacy guest funnel — the ESPN counterpart of
 * `legacy/guest-import`.
 *
 * Deliberately UNGATED by requireVerifiedUser: this funnel is advertised as "No signup
 * required", so requiring a login here is exactly the 401 wall that produced 91 visits and
 * 0 imports. An ESPN public league id is not user-private data — anyone with the id can read
 * it — so, like guest-import, the protection here is rate limiting + a bot honeypot, not
 * authentication.
 *
 * It persists into the SAME Legacy* tables the report reads (via `runLegacyEspnImportStep`,
 * driven by `legacy/worker/run`), NOT the modern `League` tables that `/api/import-espn`
 * owns — that route needs a real AppUser, which a guest does not have.
 *
 * The guest is given a signed `af_guest_session` cookie carrying a SYNTHETIC identity
 * (`sleeperUsername`/`sleeperUserId` = `espn:<leagueId>`) so `/api/legacy/import/status` and
 * `/api/legacy/profile` can find the import again across page loads. The `espn:` prefix
 * contains a colon, which is illegal in a Sleeper handle and impossible for a numeric Sleeper
 * user id, so the synthetic identity can never collide with (or clobber) a real Sleeper user.
 */
export const POST = withApiUsage({ endpoint: "/api/legacy/espn-import", tool: "LegacyEspnImport" })(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    const { league_id, team_name, website, form_rendered_at } = body ?? {}

    // Honeypot: a hidden field real users never fill in.
    if (typeof website === 'string' && website.trim().length > 0) {
      return NextResponse.json({ error: 'Request rejected' }, { status: 400 })
    }

    if (typeof form_rendered_at === 'number' && Number.isFinite(form_rendered_at)) {
      const elapsed = Date.now() - form_rendered_at
      if (elapsed >= 0 && elapsed < MIN_HUMAN_FILL_TIME_MS) {
        return NextResponse.json({ error: 'Request rejected' }, { status: 400 })
      }
    }

    const leagueId = String(league_id || '').replace(/\D/g, '')
    const teamName = String(team_name || '').trim()

    if (!leagueId) {
      return NextResponse.json({ error: 'Missing or invalid ESPN league ID' }, { status: 400 })
    }
    if (!teamName) {
      return NextResponse.json({ error: 'Missing team name' }, { status: 400 })
    }

    const ip = getClientIp(req)

    // Per-league+IP cooldown (repeat imports of the same league) and a looser per-IP cap
    // across leagues (deters enumeration/scraping). `includeIpInKey` is load-bearing:
    // without it `consumeRateLimit` collapses to one global bucket.
    const perLeagueLimit = consumeRateLimit({
      scope: 'legacy',
      action: 'espn_import',
      sleeperUsername: `espn:${leagueId}`,
      ip,
      maxRequests: 3,
      windowMs: 10 * 60_000,
      includeIpInKey: true,
    })
    if (!perLeagueLimit.success) {
      return NextResponse.json(
        buildRateLimit429({ message: 'Please wait a bit before importing again.', rl: perLeagueLimit }),
        { status: 429 },
      )
    }

    const perIpLimit = consumeRateLimit({
      scope: 'legacy',
      action: 'espn_import_ip',
      sleeperUsername: null,
      ip,
      maxRequests: 15,
      windowMs: 60 * 60_000,
      includeIpInKey: true,
    })
    if (!perIpLimit.success) {
      return NextResponse.json(
        buildRateLimit429({ message: 'Too many imports from this connection. Please try again later.', rl: perIpLimit }),
        { status: 429 },
      )
    }

    // Verify the league is readable and the team exists BEFORE enqueuing, so the visitor gets
    // the same immediate "league is private" / "team not found" feedback the old handler gave
    // — and we never queue a doomed job.
    let league
    try {
      league = await fetchEspnLeague(leagueId)
    } catch (e: any) {
      const msg = e?.message || 'Failed to fetch ESPN league data'
      const isClientErr = msg.includes('not found') || msg.includes('private')
      return NextResponse.json({ error: msg }, { status: isClientErr ? 400 : 502 })
    }

    const userTeam = findTeamByName(league.teams, teamName)
    if (!userTeam) {
      return NextResponse.json({
        error: `Team "${teamName}" not found in this league.`,
        availableTeams: league.teams.map(t => t.name),
      }, { status: 404 })
    }

    // Canonical ESPN casing, tracked across the season walk by the worker.
    const resolvedTeamName = userTeam.name
    const syntheticIdentity = `espn:${leagueId}`

    const legacyUser = await prisma.legacyUser.upsert({
      where: { sleeperUsername: syntheticIdentity },
      update: { displayName: resolvedTeamName },
      create: {
        sleeperUsername: syntheticIdentity,
        sleeperUserId: syntheticIdentity,
        displayName: resolvedTeamName,
      },
    })

    const guestToken = await signGuestSessionToken({
      legacyUserId: legacyUser.id,
      sleeperUsername: legacyUser.sleeperUsername,
    })

    const setGuestCookie = (res: NextResponse) => {
      if (guestToken) {
        res.cookies.set(GUEST_SESSION_COOKIE_NAME, guestToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
        })
      }
      return res
    }

    const existingJob = await prisma.legacyImportJob.findFirst({
      where: { userId: legacyUser.id, status: { in: ['queued', 'running'] } },
    })

    if (existingJob) {
      return setGuestCookie(NextResponse.json({
        success: true,
        guest: true,
        message: 'Import already in progress',
        job_id: existingJob.id,
        status: existingJob.status,
        progress: existingJob.progress,
        sleeper_username: legacyUser.sleeperUsername,
        display_name: legacyUser.displayName,
        platform: 'espn',
      }))
    }

    let job: { id: string }
    try {
      job = await prisma.legacyImportJob.create({
        data: { userId: legacyUser.id, status: 'queued', progress: 0 },
      })
    } catch (e: unknown) {
      if (isMissingDatabaseObjectError(e)) {
        console.error('[legacy/espn-import] DB schema out of date — run prisma migrate deploy:', e)
        return NextResponse.json(
          {
            error: 'League import is unavailable until the database is updated. Try again after the next deploy.',
            code: 'IMPORT_SCHEMA_UPDATE_REQUIRED',
          },
          { status: 503 },
        )
      }
      throw e
    }

    trackLegacyToolUsage('legacy_espn_import', legacyUser.id, null, {
      leagueId,
      guest: true,
    })

    logUserEvent(legacyUser.id, 'league_imported', {
      leagueId,
      jobId: job.id,
      platform: 'espn',
      guest: true,
    })

    return setGuestCookie(NextResponse.json({
      success: true,
      guest: true,
      message: 'Import queued',
      job_id: job.id,
      user_id: legacyUser.id,
      sleeper_username: legacyUser.sleeperUsername,
      display_name: legacyUser.displayName,
      platform: 'espn',
      league: {
        leagueId: league.leagueId,
        name: league.leagueName,
        season: league.seasonId,
        numTeams: league.numTeams,
        scoringType: league.scoringType,
      },
    }))
  } catch (e: any) {
    console.error('[legacy/espn-import] Error:', e)
    return NextResponse.json(
      { error: 'Failed to start import', details: String(e?.message || e) },
      { status: 500 },
    )
  }
})
