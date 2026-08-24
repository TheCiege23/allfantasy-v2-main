import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserLeagues } from '@/lib/sleeper-client';

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sleeperUsername } = await req.json().catch(() => ({}));
  if (!sleeperUsername) {
    return NextResponse.json({ error: 'Missing Sleeper username' }, { status: 400 });
  }

  try {
    /*
     * The season was hardcoded '2025' — with the 2026 season starting, League
     * Sync discovery would list only last year's leagues forever. NFL season
     * rolls over in August (same convention as chimmy-context's helper).
     */
    const now = new Date();
    const season = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const leagues = await getUserLeagues(String(sleeperUsername), 'nfl', String(season));

    return NextResponse.json({
      success: true,
      leagues: leagues.map((l: any) => ({
        sleeperLeagueId: l.league_id,
        name: l.name,
        totalTeams: l.total_rosters,
        isDynasty: l.settings?.type === 2,
        season: l.season,
      })),
    });
  } catch (error) {
    console.error('[Sleeper Discover]', error);
    return NextResponse.json({ error: 'Failed to discover leagues' }, { status: 500 });
  }
}
