import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { trackLegacyToolUsage } from '@/lib/analytics-server';
import { resolveOrCreateLegacyUser } from '@/lib/legacy-user-resolver';
import { logUserEvent } from '@/lib/user-events';
import { requireVerifiedUser } from '@/lib/auth-guard';
import { linkAfUserToLegacy } from '@/lib/legacy/linkAfUserToLegacy';
import { isMissingDatabaseObjectError } from '@/lib/prisma/schema-drift';

export const POST = withApiUsage({ endpoint: "/api/legacy/import", tool: "LegacyImport" })(async (request: NextRequest) => {
  try {
    const auth = await requireVerifiedUser();
    if (!auth.ok) {
      return auth.response;
    }

    const ip = getClientIp(request);
    const rateLimitResult = rateLimit(ip, 5, 60000);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { sleeper_username } = body;

    if (!sleeper_username || typeof sleeper_username !== 'string') {
      return NextResponse.json(
        { error: 'Missing sleeper_username' },
        { status: 400 }
      );
    }

    const resolved = await resolveOrCreateLegacyUser(sleeper_username);

    if (!resolved) {
      return NextResponse.json(
        { error: 'Sleeper user not found' },
        { status: 404 }
      );
    }

    const existingJob = await prisma.legacyImportJob.findFirst({
      where: {
        userId: resolved.id,
        status: { in: ['queued', 'running'] },
      },
    });

    if (existingJob) {
      const linked = await linkAfUserToLegacy(auth.userId, resolved)
      if (!linked.ok) return linked.response
      return NextResponse.json({
        success: true,
        message: 'Import already in progress',
        job_id: existingJob.id,
        status: existingJob.status,
        progress: existingJob.progress,
        username_changed: resolved.usernameChanged,
        previous_username: resolved.previousUsername,
      });
    }

    const linkedNew = await linkAfUserToLegacy(auth.userId, resolved)
    if (!linkedNew.ok) return linkedNew.response

    let job: { id: string };
    try {
      job = await prisma.legacyImportJob.create({
        data: {
          userId: resolved.id,
          status: 'queued',
          progress: 0,
        },
      });
    } catch (e: unknown) {
      if (isMissingDatabaseObjectError(e)) {
        console.error('[legacy/import] DB schema out of date — run prisma migrate deploy:', e);
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

    trackLegacyToolUsage('legacy_import', resolved.id, null, {
      username: resolved.sleeperUsername,
      usernameChanged: resolved.usernameChanged,
      previousUsername: resolved.previousUsername,
    })

    logUserEvent(resolved.id, 'league_imported', {
      username: resolved.sleeperUsername,
      jobId: job.id,
      usernameChanged: resolved.usernameChanged,
    })

    return NextResponse.json({
      success: true,
      message: resolved.usernameChanged
        ? `Welcome back! Your username was updated from "${resolved.previousUsername}" to "${resolved.sleeperUsername}". All your data has been preserved.`
        : 'Import queued',
      job_id: job.id,
      user_id: resolved.id,
      sleeper_user_id: resolved.sleeperUserId,
      display_name: resolved.displayName,
      avatar: resolved.avatar,
      username_changed: resolved.usernameChanged,
      previous_username: resolved.previousUsername,
    });
  } catch (error) {
    console.error('Legacy import error:', error);
    return NextResponse.json(
      { error: 'Failed to start import', details: String(error) },
      { status: 500 }
    );
  }
})
