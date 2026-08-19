export interface DecisionShadowScope {
  username?: string | null
  leagueId?: string | null
  leagueIds?: Array<string | null | undefined> | null
}

export interface DecisionShadowScopeFilters {
  usernames: Set<string>
  leagueIds: Set<string>
  hasScope: boolean
  hasUsernameFilter: boolean
  hasLeagueFilter: boolean
}

function parseList(rawValue: string | undefined, options?: { lowercase?: boolean }): Set<string> {
  const lowercase = options?.lowercase ?? false
  const values = String(rawValue ?? '')
    .split(/[\n\r,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (lowercase ? value.toLowerCase() : value))

  return new Set(values)
}

function normalizeLeagueIds(scope: DecisionShadowScope | undefined): string[] {
  if (!scope) return []
  const values = [scope.leagueId, ...(scope.leagueIds ?? [])]
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  )
}

export function getDecisionShadowScopeFilters(
  env: NodeJS.ProcessEnv = process.env,
): DecisionShadowScopeFilters {
  const usernames = parseList(env.DECISION_OS_TEST_USERNAMES, { lowercase: true })
  const leagueIds = parseList(env.DECISION_OS_TEST_LEAGUE_IDS)
  return {
    usernames,
    leagueIds,
    hasScope: usernames.size > 0 || leagueIds.size > 0,
    hasUsernameFilter: usernames.size > 0,
    hasLeagueFilter: leagueIds.size > 0,
  }
}

export function matchesDecisionShadowScope(
  scope: DecisionShadowScope | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const filters = getDecisionShadowScopeFilters(env)
  if (!filters.hasScope) return true

  const username = String(scope?.username ?? '').trim().toLowerCase()
  const leagueIds = normalizeLeagueIds(scope)

  const usernameMatches =
    !filters.hasUsernameFilter || (Boolean(username) && filters.usernames.has(username))
  const leagueMatches =
    !filters.hasLeagueFilter || leagueIds.some((leagueId) => filters.leagueIds.has(leagueId))

  return usernameMatches && leagueMatches
}
