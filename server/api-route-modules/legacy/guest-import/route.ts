import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { consumeRateLimit, getClientIp, buildRateLimit429 } from '@/lib/rate-limit';
import { trackLegacyToolUsage } from '@/lib/analytics-server';
import { resolveOrCreateLegacyUser } from '@/lib/legacy-user-resolver';
import { logUserEvent } from '@/lib/user-events';
import { isMissingDatabaseObjectError } from '@/lib/prisma/schema-drift';
import {
  signGuestSessionToken,
  GUEST_SESSION_COOKIE_NAME,
  GUEST_SESSION_MAX_AGE_SECONDS,
} from '@/lib/guest-mode/guestSessionToken';

// A visitor typing a username and clicking submit takes at least this long;
// anything faster than this after the form rendered is almost certainly a bot.
const MIN_HUMAN_FILL_TIME_MS = 1200;

export const POST = withApiUsage({ endpoint: "/api/legacy/guest-import", tool: "LegacyGuestImport" })(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { sleeper_username, website, form_rendered_at } = body ?? {};

    // Honeypot: a hidden field real users never fill in.
    if (typeof website === 'string' && website.trim().length > 0) {
      return NextResponse.json({ error: 'Request rejected' }, { status: 400 });
    }

    if (typeof form_rendered_at === 'number' && Number.isFinite(form_rendered_at)) {
      const elapsed = Date.now() - form_rendered_at;
      if (elapsed >= 0 && elapsed < MIN_HUMAN_FILL_TIME_MS) {
        return NextResponse.json({ error: 'Request rejected' }, { status: 400 });
      }
    }

    if (!sleeper_username || typeof sleeper_username !== 'string') {
      return NextResponse.json({ error: 'Missing sleeper_username' }, { status: 400 });
    }

    const ip = getClientIp(request);

    // Per-username+IP cooldown (repeat imports of the same account) and a
    // looser per-IP cap across usernames (deters enumeration/scraping).
    const perUserLimit = consumeRateLimit({
      scope: 'legacy',
      action: 'guest_import',
      sleeperUsername: sleeper_username,
      ip,
      maxRequests: 3,
      windowMs: 10 * 60_000,
      includeIpInKey: true,
    });
    if (!perUserLimit.success) {
      return NextResponse.json(
        buildRateLimit429({ message: 'Please wait a bit before importing again.', rl: perUserLimit }),
        { status: 429 },
      );
    }

    const perIpLimit = consumeRateLimit({
      scope: 'legacy',
      action: 'guest_import_ip',
      sleeperUsername: null,
      ip,
      maxRequests: 15,
      windowMs: 60 * 60_000,
      includeIpInKey: true,
    });
    if (!perIpLimit.success) {
      return NextResponse.json(
        buildRateLimit429({ message: 'Too many imports from this connection. Please try again later.', rl: perIpLimit }),
        { status: 429 },
      );
    }

    // resolveOrCreateLegacyUser checks LegacyUser by username first, so
    // repeated guest imports of the same username never re-hit the Sleeper API.
    const resolved = await resolveOrCreateLegacyUser(sleeper_username);

    if (!resolved) {
      return NextResponse.json({ error: 'Sleeper user not found' }, { status: 404 });
    }

    /*
     * A guest session must never be minted for a handle somebody already owns.
     *
     * `resolveOrCreateLegacyUser` returns the EXISTING LegacyUser when the handle is known,
     * so without this check the legacy IDOR reopens in two steps rather than one: type a
     * victim's handle here, receive an `af_guest_session` bound to their LegacyUser, then
     * call any gated route and be served their data. That path would defeat the entire
     * identity sweep, since `requireLegacySleeperIdentity` trusts this token by design.
     *
     * `AppUser.legacyUserId` is `@unique`, so at most one account can own a handle and this
     * is an exact ownership test rather than a heuristic.
     *
     * 409 (not 403) because nothing is wrong with the CALLER — the handle is simply taken,
     * and the client's correct next move is to sign in rather than to retry as a guest.
     */
    const owner = await prisma.appUser.findUnique({
      where: { legacyUserId: resolved.id },
      select: { id: true },
    });
    if (owner) {
      return NextResponse.json(
        {
          error: 'That Sleeper account is already linked to an AllFantasy login. Sign in to use it.',
          code: 'HANDLE_CLAIMED',
        },
        { status: 409 },
      );
    }

    const guestToken = await signGuestSessionToken({
      legacyUserId: resolved.id,
      sleeperUsername: resolved.sleeperUsername,
    });

    const existingJob = await prisma.legacyImportJob.findFirst({
      where: { userId: resolved.id, status: { in: ['queued', 'running'] } },
    });

    if (existingJob) {
      const res = NextResponse.json({
        success: true,
        guest: true,
        message: 'Import already in progress',
        job_id: existingJob.id,
        status: existingJob.status,
        progress: existingJob.progress,
        sleeper_username: resolved.sleeperUsername,
      });
      if (guestToken) {
        res.cookies.set(GUEST_SESSION_COOKIE_NAME, guestToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
        });
      }
      return res;
    }

    let job: { id: string };
    try {
      job = await prisma.legacyImportJob.create({
        data: { userId: resolved.id, status: 'queued', progress: 0 },
      });
    } catch (e: unknown) {
      if (isMissingDatabaseObjectError(e)) {
        console.error('[legacy/guest-import] DB schema out of date — run prisma migrate deploy:', e);
        return NextResponse.json(
          {
            error: 'League import is unavailable until the database is updated. Try again after the next deploy.',
            code: 'IMPORT_SCHEMA_UPDATE_REQUIRED',
          },
          { status: 503 },
        );
      }
      throw e;
    }

    trackLegacyToolUsage('legacy_guest_import', resolved.id, null, {
      username: resolved.sleeperUsername,
      guest: true,
    });

    logUserEvent(resolved.id, 'league_imported', {
      username: resolved.sleeperUsername,
      jobId: job.id,
      guest: true,
    });

    const res = NextResponse.json({
      success: true,
      guest: true,
      message: 'Import queued',
      job_id: job.id,
      user_id: resolved.id,
      sleeper_user_id: resolved.sleeperUserId,
      sleeper_username: resolved.sleeperUsername,
      display_name: resolved.displayName,
      avatar: resolved.avatar,
    });

    if (guestToken) {
      res.cookies.set(GUEST_SESSION_COOKIE_NAME, guestToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
      });
    }

    return res;
  } catch (error) {
    console.error('Legacy guest import error:', error);
    return NextResponse.json(
      { error: 'Failed to start import', details: String(error) },
      { status: 500 },
    );
  }
})
