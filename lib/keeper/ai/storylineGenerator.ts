type DynastyStoryline = {
  type: string
  title: string
  body: string
  metadata?: Record<string, unknown>
}

export async function generateKeeperOffseasonRecap(
  _leagueId: string,
  _year: number,
): Promise<DynastyStoryline> {
  return {
    type: 'keeper_recap',
    title: 'Keepers That Defined the Season',
    body: 'Placeholder Chimmy keeper offseason recap.',
  }
}

export async function generateKeeperPlayerStoryline(
  _playerId: string,
  _leagueId: string,
  _year: number,
): Promise<DynastyStoryline> {
  return {
    type: 'franchise_cornerstone',
    title: 'Keeper arc',
    body: 'Placeholder player keeper storyline.',
  }
}

export async function generateKeeperTeamArc(
  _rosterId: string,
  _leagueId: string,
  _year: number,
): Promise<DynastyStoryline> {
  return {
    type: 'core_builder',
    title: 'Team keeper identity',
    body: 'Placeholder team arc.',
  }
}
