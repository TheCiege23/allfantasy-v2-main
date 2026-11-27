import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { syncSleeperLeague } from '@/lib/sleeper-sync';
import { ConvertedLeagueError } from '@/lib/league/nativeConversionLookup';

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { sleeperLeagueId } = body;

  if (!sleeperLeagueId) {
    return NextResponse.json({ error: 'Missing Sleeper league ID' }, { status: 400 });
  }

  try {
    // User explicitly triggered this sync — allow it to activate a league
    // that was previously tagged as a ranking-import-only record.
    const result = await syncSleeperLeague(sleeperLeagueId, userId, { forceActivate: true });

    return NextResponse.json({
      ...result,
      message: `Sleeper league "${result.name}" synced successfully`,
    });
  } catch (error: any) {
    if (error instanceof ConvertedLeagueError) {
      // Switched to AllFantasy in place: a refusal, not a failure — nothing was written (conversion plan, step 5).
      return NextResponse.json({ error: error.message, code: 'LEAGUE_NOW_ON_ALLFANTASY', leagueId: error.converted.leagueId }, { status: 409 });
    }
    console.error('[Sleeper Sync]', error);
    return NextResponse.json(
      { error: error.message || 'Sync failed' },
      { status: 500 }
    );
  }
}
