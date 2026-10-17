import 'server-only'

/**
 * The ONE live Sleeper read the team-ownership check needs: each manager's team name in one league.
 *
 * WHY THIS IS ALLOWLISTED IN THE DB-FIRST GUARD, rather than read from Postgres: it is a PROOF, not
 * data. The check asks "has this person, right now, put the code we gave them into their Sleeper team
 * name?" — only Sleeper knows, and a stored copy would be exactly the stale answer that lets the wrong
 * person in. It is the same footing as an auth exchange: Postgres cannot answer it by definition.
 *
 * Kept to this file so the exemption covers nothing else. Public endpoint, no credential, never
 * logged. Called only from `verifySleeperTeamClaim`, on a member's explicit "Verify" tap, at most a
 * handful of times per 30-minute code.
 */

const SLEEPER_LEAGUE_USERS = (sleeperLeagueId: string) =>
  `https://api.sleeper.app/v1/league/${encodeURIComponent(sleeperLeagueId)}/users`

/** Sleeper `user_id` → that manager's team name in this league (empty when they never set one). Null when Sleeper did not answer. */
export async function fetchSleeperLeagueTeamNames(sleeperLeagueId: string): Promise<Map<string, string> | null> {
  try {
    const res = await fetch(SLEEPER_LEAGUE_USERS(sleeperLeagueId), {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows)) return null
    const out = new Map<string, string>()
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const r = row as { user_id?: unknown; metadata?: { team_name?: unknown } | null }
      if (typeof r.user_id !== 'string' || !r.user_id) continue
      out.set(r.user_id, typeof r.metadata?.team_name === 'string' ? r.metadata.team_name : '')
    }
    return out
  } catch {
    return null
  }
}
