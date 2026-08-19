import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity';
import {
  importDisplayStateToStatus,
  resolveLegacyImportDisplayState,
} from '@/lib/legacy/dataStatus';

export const GET = withApiUsage({ endpoint: "/api/legacy/import/status", tool: "LegacyImportStatus" })(async (request: NextRequest) => {
  const jobId = request.nextUrl.searchParams?.get('job_id');
  const requestedUsername = request.nextUrl.searchParams?.get('sleeper_username');

  /*
   * This route had TWO unowned lookups, not one. The `sleeper_username` branch served
   * whoever the caller named; the `job_id` branch fetched a job by primary key with no
   * ownership check whatsoever. Gating only the username branch would have left an
   * enumerable id as an open side door, so both now resolve against the caller's own
   * LegacyUser.
   *
   * allowGuest: status polling is the first thing that runs after a guest import, before
   * any account exists.
   */
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername,
  });
  if (!gate.ok) return gate.response;

  const caller = await prisma.legacyUser.findFirst({
    where: { sleeperUsername: gate.identity.sleeperUsername.toLowerCase() },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let job;

  if (jobId) {
    // Scoped to the caller's own userId. A job belonging to someone else returns the same
    // 404 as one that does not exist — never a distinguishable "not yours", which would
    // turn this into an existence oracle for other people's imports.
    job = await prisma.legacyImportJob.findFirst({
      where: { id: jobId, userId: caller.id },
    });
  } else {
    // First look for an active job (running or queued)
    job = await prisma.legacyImportJob.findFirst({
      where: { userId: caller.id, status: { in: ['running', 'queued'] } },
      orderBy: { createdAt: 'desc' },
    });

    // If no active job, get the most recent completed one
    if (!job) {
      job = await prisma.legacyImportJob.findFirst({
        where: { userId: caller.id },
        orderBy: { createdAt: 'desc' },
      });
    }
  }

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Honest display state: the DB only knows queued/running/completed/failed, but a run where
  // some seasons failed used to render as a clean "completed". The completeness columns
  // (totalSeasons/seasonsCompleted, written by the importer) let us derive partial/stale here.
  const displayState = resolveLegacyImportDisplayState({
    status: job.status,
    completedAt: job.completedAt,
    lastSyncedAt: job.completedAt,
    errorMessage: job.error,
    importedSeasonCount: job.seasonsCompleted,
    expectedSeasonCount: job.totalSeasons,
  });
  const status = importDisplayStateToStatus(displayState, {
    lastSyncedAt: job.completedAt,
    importedSeasonCount: job.seasonsCompleted,
    expectedSeasonCount: job.totalSeasons,
    errorMessage: job.error,
  });

  // NOTE: honesty impression analytics deliberately do NOT fire here — this route is polled
  // every 3s during an import and re-hit on every page load afterwards, so a server-side event
  // would duplicate hundreds of times per user. The client (app/af-legacy) beacons the
  // impression exactly once per job via sendProductAnalyticsBeacon.
  return NextResponse.json({
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    // `message` was read off a column that does not exist ((job as any).message) — it was
    // always null. Now carries the honest user-facing status message.
    message: status.message,
    started_at: job.startedAt,
    completed_at: job.completedAt,
    display_state: displayState,
    seasons_completed: job.seasonsCompleted,
    total_seasons: job.totalSeasons,
    total_leagues_saved: job.totalLeaguesSaved,
    seasons_summary: job.seasonsSummary,
    meta: { status },
  });
})

