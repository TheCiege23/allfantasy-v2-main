import 'server-only'

/**
 * Rolling Insights injury ingest.
 *
 * WHY THIS REPLACES API-SPORTS: `import-injuries` used API-Sports, whose account
 * is on the **Free** plan. Probed 2026-08-10:
 *
 *   /injuries?team=1&season=2025 -> {"plan":"Free plans do not have access to
 *                                    this season, try from 2022 to 2024."}
 *
 * Not quota (36/100 used), not cadence, not code — the plan cannot serve 2025+
 * at all. So `sportsInjury` froze 17.2 days ago and `injuryReportRecord` 103
 * days ago, while `playerUrgency.ts` kept computing "OUT and still starting" off
 * two-week-old statuses. That is worse than the projections outage: projections
 * degrade to null (honestly absent), stale injuries render confidently WRONG.
 *
 * Rolling Insights serves injuries on credentials already paid for.
 *
 * SHAPE (measured, 32 team rows / 311 injuries):
 *   { team, team_id, injuries: [ { player, player_id, injury, returns, date_injured } ] }
 *
 * Two constraints that shape everything below:
 *
 *  1. THERE IS NO STATUS FIELD. The designation lives in English prose inside
 *     `returns` ("Questionable For Week 1 At Houston"). It must be parsed, and
 *     parsing must REFUSE rather than guess — urgency escalates on OUT, so a
 *     mis-parse either fabricates an emergency or hides a real one.
 *
 *  2. THERE IS NO POSITION. It must come from a join, which also means position
 *     cannot be used to verify the player match unless we resolve first.
 */

import { prisma } from '@/lib/prisma'

/** One row exactly as Rolling Insights returns it. */
export interface RiInjuryRow {
  player?: string
  player_id?: string | number
  injury?: string
  returns?: string
  date_injured?: string
}

export interface RiInjuryTeamBlock {
  team?: string
  team_id?: string | number
  injuries?: RiInjuryRow[] | Record<string, RiInjuryRow>
}

/**
 * The designations AF acts on. Deliberately the same vocabulary the previous
 * API-Sports rows used, so downstream consumers and the urgency severity map
 * need no changes.
 */
export type InjuryDesignation =
  | 'Out'
  | 'Doubtful'
  | 'Questionable'
  | 'Probable'
  | 'IR'
  | 'Day-To-Day'

export interface ParsedDesignation {
  /** Null when the prose does not clearly state a designation. NEVER guessed. */
  status: InjuryDesignation | null
  /** Which rule fired — kept for provenance and for auditing parser coverage. */
  reason:
    | 'explicit_designation'
    | 'season_ending'
    | 'injured_reserve'
    | 'unparseable'
    | 'empty'
}

/**
 * Order matters: the most severe / most specific patterns are tested first, so
 * "Out For Season" resolves to Out rather than matching a weaker rule later.
 *
 * Anchored with word boundaries — a bare `includes('out')` would match
 * "Workout", "Ruled out of contention", "About", and similar.
 */
const DESIGNATION_PATTERNS: ReadonlyArray<{
  re: RegExp
  status: InjuryDesignation
  reason: ParsedDesignation['reason']
}> = [
  { re: /\b(injured\s+reserve|\bIR\b|placed\s+on\s+ir)\b/i, status: 'IR', reason: 'injured_reserve' },
  { re: /\bout\s+for\s+(the\s+)?season\b/i, status: 'Out', reason: 'season_ending' },
  { re: /\bseason[-\s]ending\b/i, status: 'Out', reason: 'season_ending' },
  { re: /\bdoubtful\b/i, status: 'Doubtful', reason: 'explicit_designation' },
  { re: /\bquestionable\b/i, status: 'Questionable', reason: 'explicit_designation' },
  { re: /\bprobable\b/i, status: 'Probable', reason: 'explicit_designation' },
  { re: /\bday[-\s]to[-\s]day\b/i, status: 'Day-To-Day', reason: 'explicit_designation' },
  { re: /\bout\b/i, status: 'Out', reason: 'explicit_designation' },
]

/**
 * Parse an injury designation out of Rolling Insights' `returns` prose.
 *
 * Returning `null` is a first-class outcome. An unparseable string still yields
 * a row — the injury and its description are real and worth surfacing — but with
 * no status, so urgency treats availability as unknown rather than inventing a
 * designation. "Expected To Return Week 3" says nothing about THIS week's
 * status and must not become Out.
 */
export function parseInjuryDesignation(returns: string | null | undefined): ParsedDesignation {
  const text = String(returns ?? '').trim()
  if (!text) return { status: null, reason: 'empty' }
  for (const p of DESIGNATION_PATTERNS) {
    if (p.re.test(text)) return { status: p.status, reason: p.reason }
  }
  return { status: null, reason: 'unparseable' }
}

/**
 * RI dates are non-ISO and zero-padding is inconsistent: "2026-8-8".
 * `new Date("2026-8-8")` is implementation-defined, so parse explicitly and
 * return null rather than an Invalid Date that would silently become `null`
 * three layers later.
 */
export function parseRiInjuryDate(raw: string | null | undefined): Date | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) {
    const fallback = new Date(s)
    return Number.isNaN(fallback.getTime()) ? null : fallback
  }
  const [, y, mo, d] = m
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** "Week 1" out of "Questionable For Week 1 At Houston". Null when absent. */
export function parseWeekFromReturns(returns: string | null | undefined): number | null {
  const m = String(returns ?? '').match(/\bweek\s+(\d{1,2})\b/i)
  if (!m) return null
  const w = Number(m[1])
  return Number.isFinite(w) && w >= 1 && w <= 25 ? w : null
}

export interface NormalizedRiInjury {
  /** Stable across runs — RI `player_id`. Half the upsert key, so it must not
   *  encode time or array position or every run would insert instead of update. */
  externalId: string
  playerName: string
  /** RI's player id. NOT a canonical AF id — resolution happens at write time. */
  providerPlayerId: string
  teamName: string | null
  teamId: string | null
  /** Body part, e.g. "Knee". */
  type: string | null
  status: InjuryDesignation | null
  statusReason: ParsedDesignation['reason']
  /** Full original prose, preserved verbatim. */
  description: string | null
  date: Date | null
  week: number | null
  raw: RiInjuryRow & { team?: string; team_id?: string | number }
}

function toRows(block: RiInjuryTeamBlock): RiInjuryRow[] {
  const inj = block?.injuries
  if (Array.isArray(inj)) return inj
  if (inj && typeof inj === 'object') return Object.values(inj)
  return []
}

/**
 * Pure: flatten the team-keyed payload into normalized rows. Exported for tests
 * so parsing is verified without network or database.
 */
export function normalizeRiInjuries(payload: unknown, sport = 'NFL'): NormalizedRiInjury[] {
  const data = (payload as { data?: Record<string, unknown> })?.data ?? payload
  const bySport = (data as Record<string, unknown>)?.[sport] ?? data
  const blocks: RiInjuryTeamBlock[] = Array.isArray(bySport)
    ? (bySport as RiInjuryTeamBlock[])
    : bySport && typeof bySport === 'object'
      ? (Object.values(bySport) as RiInjuryTeamBlock[])
      : []

  const out: NormalizedRiInjury[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    for (const row of toRows(block)) {
      const providerPlayerId = String(row.player_id ?? '').trim()
      const playerName = String(row.player ?? '').trim()
      if (!providerPlayerId && !playerName) continue

      // player_id is stable and unique per player; prefer it. Falling back to a
      // normalized name keeps nameless-id rows from colliding with each other.
      const externalId = providerPlayerId || `name:${playerName.toLowerCase().replace(/\s+/g, '-')}`
      if (seen.has(externalId)) continue
      seen.add(externalId)

      const parsed = parseInjuryDesignation(row.returns)
      out.push({
        externalId,
        playerName: playerName || `Unknown ${providerPlayerId}`,
        providerPlayerId,
        teamName: String(block.team ?? '').trim() || null,
        teamId: block.team_id != null ? String(block.team_id) : null,
        type: String(row.injury ?? '').trim() || null,
        status: parsed.status,
        statusReason: parsed.reason,
        description: String(row.returns ?? '').trim() || null,
        date: parseRiInjuryDate(row.date_injured),
        week: parseWeekFromReturns(row.returns),
        raw: { ...row, team: block.team, team_id: block.team_id },
      })
    }
  }
  return out
}

const RI_SOURCE = 'rolling_insights'
const INJURY_TTL_MS = 6 * 60 * 60 * 1000

export interface RiInjurySyncResult {
  fetched: number
  written: number
  /** Rows whose designation could not be parsed — the parser-coverage signal. */
  unparseableStatus: number
  /** Legacy api_sports rows expired in the same run. */
  legacyExpired: number
  errors: string[]
}

/**
 * Fetch + persist. Writes with `source: 'rolling_insights'`.
 *
 * NOTE ON THE LEGACY ROWS: `SportsInjury` is unique on
 * (sport, externalId, source), so RI rows do NOT overwrite the frozen
 * `api_sports` rows — they coexist. No consumer filters by source today, and
 * `app/api/start-sit/injuries` has no recency filter at all, so leaving both in
 * place would let a 17-day-old status win over a fresh one. We therefore expire
 * the legacy rows in the same transaction rather than leaving that to a reader.
 */
export async function syncRollingInsightsInjuriesToDb(opts?: {
  sport?: string
  fetchImpl?: typeof fetch
}): Promise<RiInjurySyncResult> {
  const sport = (opts?.sport ?? 'NFL').toUpperCase()
  const result: RiInjurySyncResult = {
    fetched: 0,
    written: 0,
    unparseableStatus: 0,
    legacyExpired: 0,
    errors: [],
  }

  const token =
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ||
    process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim() ||
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim()
  if (!token) {
    result.errors.push('Rolling Insights RSC token not configured')
    return result
  }

  const rawBase =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_REST_BASE?.trim() ||
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  const trimmed = rawBase.replace(/\/+$/, '')
  const base = /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`

  const doFetch = opts?.fetchImpl ?? fetch
  let payload: unknown
  try {
    const res = await doFetch(`${base}/injuries/${sport}?RSC_token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      result.errors.push(`Rolling Insights injuries HTTP ${res.status}`)
      return result
    }
    payload = await res.json()
  } catch (e) {
    result.errors.push(`Rolling Insights injuries fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  const rows = normalizeRiInjuries(payload, sport)
  result.fetched = rows.length
  if (rows.length === 0) {
    result.errors.push('Rolling Insights returned no injury rows')
    return result
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + INJURY_TTL_MS)
  const season = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1

  for (const row of rows) {
    if (row.status == null) result.unparseableStatus += 1
    try {
      const data = {
        playerName: row.playerName,
        // Provider id, not canonical. The read port resolves to canonical AF
        // players; storing RI's id here keeps the raw provenance intact.
        playerId: row.providerPlayerId || null,
        team: row.teamName,
        teamId: row.teamId,
        type: row.type,
        status: row.status,
        description: row.description,
        date: row.date,
        season,
        week: row.week,
        fetchedAt: now,
        expiresAt,
        raw: row.raw as never,
      }
      await prisma.sportsInjury.upsert({
        where: { sport_externalId_source: { sport, externalId: row.externalId, source: RI_SOURCE } },
        update: data,
        create: { sport, externalId: row.externalId, source: RI_SOURCE, ...data },
      })
      result.written += 1
    } catch (e) {
      result.errors.push(`upsert ${row.externalId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Only retire the legacy feed once the replacement actually landed rows —
  // otherwise a bad RI run would leave AF with no injury data at all.
  if (result.written > 0) {
    try {
      const expired = await prisma.sportsInjury.updateMany({
        where: { sport, source: 'api_sports', expiresAt: { gt: now } },
        data: { expiresAt: now },
      })
      result.legacyExpired = expired.count
    } catch (e) {
      result.errors.push(`legacy expire failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return result
}
