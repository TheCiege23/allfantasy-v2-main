import 'server-only'

export function isCommissionerQaEnvironment() {
  return process.env.RAILWAY_PROJECT_ID === 'bb9805c9-f83a-4e3d-a5dd-cf3214436fbf' &&
    process.env.RAILWAY_ENVIRONMENT_ID === 'd23b2377-5944-44e7-bba5-57804006fd91'
}

export function isRoadToGloryStagingLeague(leagueId: string) {
  return isCommissionerQaEnvironment() && leagueId === 'c4e6e7b2-9571-4234-89c5-30159d0c2a14'
}
