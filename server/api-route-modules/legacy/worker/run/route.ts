// app/api/legacy/worker/run/route.ts
import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runLegacyImportStep } from '@/lib/legacy-import';
import { runLegacyEspnImportStep } from '@/lib/legacy-espn-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Anonymous ESPN guest imports (see `legacy/espn-import`) share this single worker with the
 * Sleeper funnel. They are told apart by the synthetic identity their LegacyUser carries:
 * `sleeperUserId` of the form `espn:<leagueId>`. Real Sleeper user ids are always numeric,
 * so this prefix can never collide with a genuine Sleeper account.
 */
const ESPN_IDENTITY_PREFIX = 'espn:';

export const GET = withApiUsage({ endpoint: "/api/legacy/worker/run", tool: "LegacyWorkerRun" })(async () => {
  // Find the oldest job that needs processing (queued or running)
  const job = await prisma.legacyImportJob.findFirst({
    where: { status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, sleeperUserId: true, sleeperUsername: true, displayName: true } },
    },
  });

  if (!job) {
    return NextResponse.json({ ok: true, message: 'No jobs to process.' });
  }

  if (!job.user) {
    await prisma.legacyImportJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        progress: 100,
        completedAt: new Date(),
        error: 'LegacyUser not found',
      },
    });
    return NextResponse.json({ ok: false, message: 'Job failed: missing user.' }, { status: 500 });
  }

  try {
    let result: { done: boolean; progress: number };

    if (job.user.sleeperUserId.startsWith(ESPN_IDENTITY_PREFIX)) {
      // ESPN guest import. The league id lives in the synthetic sleeperUserId
      // (`espn:<leagueId>`) and the team name is carried on the LegacyUser displayName,
      // both set at enqueue time by legacy/espn-import.
      const espnLeagueId = job.user.sleeperUserId.slice(ESPN_IDENTITY_PREFIX.length);
      const teamName = job.user.displayName ?? '';
      result = await runLegacyEspnImportStep(job.id, job.user.id, espnLeagueId, teamName);
    } else {
      // Process ONE Sleeper season step (unchanged).
      result = await runLegacyImportStep(job.id, job.user.id, job.user.sleeperUserId);
    }

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      done: result.done,
      progress: result.progress,
    });
  } catch (e: any) {
    console.error('Worker error:', e);
    await prisma.legacyImportJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        error: e?.message || 'Unknown error',
      },
    });
    return NextResponse.json(
      { ok: false, message: e?.message || 'Worker error', jobId: job.id },
      { status: 500 }
    );
  }
})
