type DynastyStoryline = { headline: string; body: string; tags?: string[] }

export async function generateBestBallWeeklyRecap(
  leagueId: string,
  contestId: string | null,
  week: number,
): Promise<DynastyStoryline> {
  void contestId
  return {
    headline: `Week ${week} best ball recap`,
    body: `Preview only — League ${leagueId} best ball recap is not production-ready yet. Full narrative generation is waiting on the live score feed wiring.`,
    tags: ['best_ball', 'recap'],
  }
}

export async function generateDraftStorylines(
  leagueId: string,
  contestId: string | null,
  sport: string,
): Promise<DynastyStoryline[]> {
  void contestId
  return [
    {
      headline: 'Draft storylines',
      body: `Preview only — ${sport} best ball draft storyline generation for league ${leagueId} is coming soon and is not production-ready yet.`,
      tags: ['best_ball', 'draft'],
    },
  ]
}
