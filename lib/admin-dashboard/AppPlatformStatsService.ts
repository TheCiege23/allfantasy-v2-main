import 'server-only'

import {
  buildAppPlatformQueries,
  buildPlatformRows,
  normalizeWindow,
  parseDaily,
  parseTotal,
  type AppPlatformReport,
  type HogQLRows,
} from './appPlatformStats'

/**
 * The data behind /admin/apps, read from PostHog's query API. Read-only, admin-only.
 *
 * Needs a PostHog PERSONAL API key (Settings → Personal API keys, scope "Query: read"),
 * which is different from the public project token the browser uses:
 *   POSTHOG_PERSONAL_API_KEY   phx_…   (secret — never logged, never sent to the client)
 *   POSTHOG_PROJECT_ID         the number in the PostHog project URL
 *   POSTHOG_API_HOST           optional, default https://us.posthog.com
 *
 * The key travels in the Authorization header only, never in a URL. Each query is read
 * on its own; a failed one is REPORTED in `errors` and leaves its section null — never
 * a zero, which here would read as "nobody used the app".
 */

export type PostHogQueryConfig = { host: string; projectId: string; apiKey: string }

export function readPostHogQueryConfig(env: Record<string, string | undefined> = process.env): PostHogQueryConfig | null {
  const apiKey = env.POSTHOG_PERSONAL_API_KEY?.trim()
  const projectId = env.POSTHOG_PROJECT_ID?.trim()
  if (!apiKey || !projectId || !/^\d+$/.test(projectId)) return null
  const host = (env.POSTHOG_API_HOST?.trim() || 'https://us.posthog.com').replace(/\/+$/, '')
  return { host, projectId, apiKey }
}

const QUERY_TIMEOUT_MS = 15_000

export async function runHogQL(config: PostHogQueryConfig, query: string, fetchImpl: typeof fetch = fetch): Promise<HogQLRows> {
  const res = await fetchImpl(`${config.host}/api/projects/${config.projectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  })
  if (!res.ok) {
    // Status only: PostHog's error body can echo request details, and this text reaches the page.
    const hint = res.status === 401 || res.status === 403 ? ' — check POSTHOG_PERSONAL_API_KEY and its "Query: read" scope' : ''
    throw new Error(`PostHog answered ${res.status}${hint}`)
  }
  const body = (await res.json()) as { results?: unknown }
  if (!Array.isArray(body.results)) throw new Error('PostHog returned no results')
  return body.results as HogQLRows
}

export async function getAppPlatformReport(opts: {
  days?: unknown
  now?: Date
  config: PostHogQueryConfig
  fetchImpl?: typeof fetch
}): Promise<AppPlatformReport> {
  const days = normalizeWindow(opts.days)
  const q = buildAppPlatformQueries(days)
  const errors: string[] = []
  const read = async (name: string, query: string): Promise<HogQLRows | null> => {
    try {
      return await runHogQL(opts.config, query, opts.fetchImpl)
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : 'query failed'}`)
      return null
    }
  }
  const [total, active, daily, newUsers] = await Promise.all([
    read('Active people', q.total),
    read('Active by platform', q.active),
    read('Daily chart', q.daily),
    read('New people', q.newUsers),
  ])
  return {
    days,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    totalActive: total ? parseTotal(total) : null,
    platforms: buildPlatformRows(active, newUsers),
    daily: daily ? parseDaily(daily) : null,
    errors,
  }
}
