/**
 * Fetches full Sleeper league data (league, users, rosters, matchups, transactions, draft, player map).
 * Used by import preview and by league creation from import.
 */

import { getAllPlayers } from '@/lib/sleeper-client'
import type { SleeperImportPayload } from '../adapters/sleeper/types'

const FETCH_RETRIES = 3
const FETCH_TIMEOUT_MS = 12000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Phase 2.3 — resilient Sleeper GET. Retries transient failures (network / timeout /
 * 5xx / 429) with exponential backoff and a per-request timeout. A 404 or an
 * ok-but-empty body is legitimate "no data" (e.g. a week beyond the season) and is NOT
 * a warning. A persistent failure pushes a message to `ctx.warnings` (never silently
 * swallowed) and returns null so the caller keeps whatever partial data it has. When
 * `ctx` is omitted the call still retries — it just doesn't record a warning.
 */
async function fetchSleeperJson<T>(
  url: string,
  ctx?: { warnings: string[]; label: string },
): Promise<T | null> {
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (res.status === 404) return null // legitimate no-data
      if (!res.ok) {
        if (attempt < FETCH_RETRIES - 1) {
          await delay(300 * 2 ** attempt)
          continue
        }
        ctx?.warnings.push(
          `${ctx.label}: Sleeper returned ${res.status} after ${FETCH_RETRIES} attempts — data may be incomplete.`,
        )
        return null
      }
      return (await res.json()) as T
    } catch (err) {
      clearTimeout(timer)
      if (attempt < FETCH_RETRIES - 1) {
        await delay(300 * 2 ** attempt)
        continue
      }
      ctx?.warnings.push(
        `${ctx.label}: Sleeper request failed after ${FETCH_RETRIES} attempts (${
          err instanceof Error ? err.message : 'network error'
        }) — data may be incomplete.`,
      )
      return null
    }
  }
  return null
}

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: ingestion service endpoint

interface SleeperDraftSummaryRaw {
  draft_id: string
  type?: string
  status?: string
  start_time?: number
  slot_to_roster_id?: Record<string, string>
}

export interface SleeperFetchOptions {
  maxMatchupWeeks?: number
  maxTransactionWeeks?: number
  maxPreviousSeasons?: number
}

const DEFAULTS: SleeperFetchOptions = {
  maxMatchupWeeks: 18,
  maxTransactionWeeks: 18,
  maxPreviousSeasons: 10,
}

async function fetchLeagueDraftPicks(
  leagueId: string,
  season?: string
): Promise<NonNullable<SleeperImportPayload['draftPicks']>> {
  const drafts =
    (await fetchSleeperJson<SleeperDraftSummaryRaw[]>(`${SLEEPER_BASE}/league/${leagueId}/drafts`)) ?? []

  let picks: NonNullable<SleeperImportPayload['draftPicks']> = []
  for (const draft of drafts) {
    const draftId = draft?.draft_id?.trim()
    if (!draftId) continue

    const draftPicks =
      (await fetchSleeperJson<NonNullable<SleeperImportPayload['draftPicks']>>(
        `${SLEEPER_BASE}/draft/${draftId}/picks`
      )) ?? []

    if (!draftPicks.length) continue

    picks = picks.concat(
      draftPicks.map((pick) => ({
        ...pick,
        season: season ?? pick.season,
        draft_id: draftId,
      }))
    )
  }

  return picks
}

/**
 * Fetch a full Sleeper league payload suitable for ImportNormalizationPipeline and legacy-style preview.
 */
export async function fetchSleeperLeagueForImport(
  leagueId: string,
  options: SleeperFetchOptions = {}
): Promise<SleeperImportPayload | null> {
  const opts = { ...DEFAULTS, ...options }
  const cleanId = leagueId.trim()
  if (!cleanId) return null

  // Phase 2.3 — collect non-fatal fetch failures instead of silently dropping data.
  const warnings: string[] = []

  const league = await fetchSleeperJson<SleeperImportPayload['league']>(
    `${SLEEPER_BASE}/league/${cleanId}`,
    { warnings, label: 'league' },
  )
  if (!league?.league_id) return null

  const [users, rosters, currentDraftPicks, tradedPicksRaw] = await Promise.all([
    fetchSleeperJson<SleeperImportPayload['users']>(`${SLEEPER_BASE}/league/${cleanId}/users`, {
      warnings,
      label: 'league users',
    }),
    fetchSleeperJson<SleeperImportPayload['rosters']>(`${SLEEPER_BASE}/league/${cleanId}/rosters`, {
      warnings,
      label: 'league rosters',
    }),
    fetchLeagueDraftPicks(cleanId, league.season),
    // Block F — future traded draft picks (`/league/{id}/traded_picks`). Empty [] is
    // a legitimate result (no picks currently traded), NOT a warning. The resilient
    // fetcher records a warning only on 5xx/timeout after retries.
    fetchSleeperJson<SleeperImportPayload['tradedPicks']>(
      `${SLEEPER_BASE}/league/${cleanId}/traded_picks`,
      { warnings, label: 'traded picks' },
    ),
  ])

  // Phase 2.3 — weekly matchup + transaction fetches run in parallel (were sequential,
  // up to 36 blocking round-trips). Promise.all preserves order; a failed week records a
  // warning via the resilient fetcher rather than being silently skipped.
  const txWeeks = Array.from({ length: opts.maxTransactionWeeks ?? 18 }, (_, i) => i + 1)
  const matchupWeeks = Array.from({ length: opts.maxMatchupWeeks ?? 18 }, (_, i) => i + 1)

  const [txResults, matchupResults] = await Promise.all([
    Promise.all(
      txWeeks.map((week) =>
        fetchSleeperJson<SleeperImportPayload['transactions']>(
          `${SLEEPER_BASE}/league/${cleanId}/transactions/${week}`,
          { warnings, label: `transactions week ${week}` },
        ).then((wk) => ({ week, wk })),
      ),
    ),
    Promise.all(
      matchupWeeks.map((week) =>
        fetchSleeperJson<{ roster_id: number; matchup_id: number; points: number }[]>(
          `${SLEEPER_BASE}/league/${cleanId}/matchups/${week}`,
          { warnings, label: `matchups week ${week}` },
        ).then((m) => ({ week, m })),
      ),
    ),
  ])

  let transactions: SleeperImportPayload['transactions'] = []
  for (const { wk } of txResults) {
    if (wk?.length) transactions = transactions.concat(wk)
  }

  let draftPicks: NonNullable<SleeperImportPayload['draftPicks']> = currentDraftPicks ?? []

  const matchupsByWeek: NonNullable<SleeperImportPayload['matchupsByWeek']> = []
  for (const { week, m } of matchupResults) {
    if (m?.length) matchupsByWeek.push({ week, matchups: m })
  }

  let previousSeasons: SleeperImportPayload['previousSeasons'] = []
  let prevId = league.previous_league_id
  while (prevId && previousSeasons.length < (opts.maxPreviousSeasons ?? 10)) {
    const prevLeague = await fetchSleeperJson<SleeperImportPayload['league']>(
      `${SLEEPER_BASE}/league/${prevId}`,
      { warnings, label: `previous season league ${prevId}` },
    )
    if (!prevLeague) break
    previousSeasons.push({ season: prevLeague.season, league: prevLeague })
    const prevDraftPicks = await fetchLeagueDraftPicks(prevLeague.league_id, prevLeague.season)
    if (prevDraftPicks.length) {
      draftPicks = draftPicks.concat(prevDraftPicks)
    }
    prevId = prevLeague.previous_league_id
  }

  const allPlayerIds = new Set<string>()
  rosters?.forEach((r) => {
    r.players?.forEach((p) => allPlayerIds.add(p))
    r.starters?.forEach((s) => s && s !== '0' && allPlayerIds.add(s))
  })
  draftPicks.forEach((p) => {
    if (p?.player_id) {
      allPlayerIds.add(p.player_id)
    }
  })

  const playerMap: Record<string, { name: string; position: string; team: string }> = {}
  try {
    const sleeperPlayers = await getAllPlayers()
    allPlayerIds.forEach((pid) => {
      const sp = sleeperPlayers[pid]
      if (sp) {
        playerMap[pid] = {
          name: (sp as any).full_name || `${(sp as any).first_name ?? ''} ${(sp as any).last_name ?? ''}`.trim(),
          position: (sp as any).position ?? '',
          team: (sp as any).team ?? '',
        }
      }
    })
  } catch {}

  draftPicks.forEach((p) => {
    if (p?.player_id && p.metadata && !playerMap[p.player_id]) {
      playerMap[p.player_id] = {
        name: `${p.metadata.first_name ?? ''} ${p.metadata.last_name ?? ''}`.trim(),
        position: p.metadata.position ?? '',
        team: p.metadata.team ?? '',
      }
    }
  })

  return {
    league,
    users: users ?? undefined,
    rosters: rosters ?? undefined,
    matchupsByWeek,
    transactions,
    draftPicks,
    // Block F — pass through the raw traded_picks response. Null-safety: the
    // resilient fetcher returns null on unrecoverable failures; treat that as
    // "no traded picks known" so downstream code never explodes.
    tradedPicks: Array.isArray(tradedPicksRaw) ? tradedPicksRaw : undefined,
    playerMap,
    previousSeasons,
    fetchWarnings: warnings.length > 0 ? warnings : undefined,
  }
}
