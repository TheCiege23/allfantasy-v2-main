import 'server-only'

import { prisma } from '@/lib/prisma'
import { readPlayByPlayFeed } from '@/lib/live/playByPlayFeed'
import { getPlayFeed } from '@/lib/live/playFeedPresentation'
import { ownersByPlayerId } from '@/lib/live/bigPlayNotifier'
import { extractAnnotations, parseTextFromXaiResponse, xaiResponsesJson } from '@/lib/xai-client'
import { isAiSpendDisabledError } from '@/lib/ai/aiSpendGuard'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import {
  clipHandlesFor,
  isClipSearchDue,
  pickFromCitations,
  searchDateWindow,
  type ClipAttempt,
  type ClipPilotRecord,
} from '@/lib/live/tdClipMatch'

/**
 * PILOT: can Grok's X search find the official video post of a touchdown?
 *
 * Runs inside `/api/cron/live-score-tick` (no new route — the repo is at its
 * route ceiling) and LOGS what it finds to `SportsDataCache`. It renders nothing
 * and notifies no one; `scripts/report-grok-td-clip-pilot.ts` reads the log so a
 * human can check hit rate, lag, cost, and — by opening the links — whether the
 * accepted post really is that play.
 *
 * Scope, all deliberate:
 *   - NFL TOUCHDOWNs only, by a player at least one AllFantasy user STARTS —
 *     the only clips a fantasy surface would ever show.
 *   - Searched at 5 minutes and, if nothing, again at 30 (`isClipSearchDue`).
 *   - Only the league's and the two teams' official accounts.
 *
 * ⚠ OFF UNLESS `GROK_TD_CLIP_PILOT=1`, AND BEHIND THE GLOBAL AI SPEND SWITCH.
 * `xaiResponsesJson` asserts `AI_FEATURES_ENABLED` itself; this flag is the
 * pilot's own, so it can be stopped without touching every other AI feature.
 * Caps: `GROK_TD_CLIP_PILOT_MAX_PER_RUN` (default 2) and
 * `GROK_TD_CLIP_PILOT_DAILY_CAP` (default 60, per UTC day).
 *
 * ⚠ IT MUST NEVER COST THE SCORING TICK ANYTHING. Every failure is caught and
 * reported in the result; a deadline stops it starting a search that would
 * outlive the invocation.
 */

const RECORD_PREFIX = 'grok-clip-pilot:NFL:'
const BUDGET_PREFIX = 'grok-clip-pilot:budget:'
/** Long enough to review a whole season's Sundays, short enough to clean itself up. */
const RECORD_TTL_MS = 60 * 24 * 60 * 60_000
const SEARCH_TIMEOUT_MS = 25_000
/** Leave this much of the caller's deadline unused before starting a search. */
const DEADLINE_MARGIN_MS = SEARCH_TIMEOUT_MS + 5_000

export function recordKey(playId: string): string {
  return `${RECORD_PREFIX}${playId}`
}

export type ClipPilotResult = {
  skipped: 'disabled' | 'ai-spend-disabled' | 'no-touchdowns' | 'none-due' | 'daily-cap' | null
  touchdownsSeen: number
  due: number
  searched: number
  found: number
  errors: number
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

async function readJson<T>(key: string): Promise<T | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  if (!row || row.expiresAt.getTime() < Date.now()) return null
  return row.data as T
}

async function writeJson(key: string, data: unknown, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: key },
      update: { data: data as never, expiresAt },
      create: { cacheKey: key, data: data as never, expiresAt },
    })
    .catch((err) => console.error('[grok-clip-pilot] write failed:', err instanceof Error ? err.message : err))
}

const SYSTEM_PROMPT = [
  'You find the official highlight video post on X for ONE specific NFL touchdown.',
  '',
  'Rules:',
  '- Search X. Only consider posts from the accounts the search is restricted to.',
  '- The post must show THIS play: this player scoring this touchdown in this game. A different play, a recap of the whole game, or a post from another week is NOT a match.',
  '- Never invent a URL. Only answer with a post URL the search actually returned.',
  '- If no post clearly matches, answer null. A null answer is correct and useful.',
  '',
  'Respond with a single JSON object and no surrounding text:',
  '{"postUrl": string | null, "reason": string}',
].join('\n')

function buildUserPrompt(p: { headline: string; playerName: string; team: string | null; opponent: string | null; detectedAt: string }): string {
  const teams = [p.team, p.opponent].filter(Boolean).join(' vs ')
  return [
    `Touchdown: ${p.headline}`,
    `Player: ${p.playerName}${p.team ? ` (${p.team})` : ''}`,
    teams ? `Game: ${teams}` : null,
    `The play happened shortly before ${p.detectedAt} (UTC).`,
    'Find the X post with the video of this touchdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

function parsePick(text: string | null): string | null {
  if (!text) return null
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned) as { postUrl?: unknown }
    return typeof parsed.postUrl === 'string' && parsed.postUrl.trim() ? parsed.postUrl.trim() : null
  } catch {
    return null
  }
}

async function opponentFor(gameId: string, team: string | null): Promise<string | null> {
  if (!team) return null
  const row = await prisma.sportsGame
    .findFirst({
      where: { sport: 'NFL', source: 'rolling_insights', externalId: gameId },
      select: { homeTeam: true, awayTeam: true },
    })
    .catch(() => null)
  if (!row) return null
  const mine = normalizeTeamAbbrev(team)
  const home = normalizeTeamAbbrev(row.homeTeam)
  const away = normalizeTeamAbbrev(row.awayTeam)
  if (mine && home === mine) return away
  if (mine && away === mine) return home
  return null
}

async function searchOnce(record: ClipPilotRecord): Promise<ClipAttempt> {
  const started = Date.now()
  const at = new Date(started).toISOString()
  try {
    const result = await xaiResponsesJson({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(record) },
      ],
      tools: [{ type: 'x_search', allowed_x_handles: record.handles, ...searchDateWindow(record.detectedAt) }],
      temperature: 0,
      maxTokens: 300,
      skipCache: true,
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!result.ok) {
      return {
        at, ok: false, error: `xAI HTTP ${result.status}`, modelPick: null, accepted: null,
        citations: [], rejected: [], latencyMs: Date.now() - started,
      }
    }
    const citations = [
      ...new Set(
        extractAnnotations(result.json)
          .map((a) => a?.url?.trim())
          .filter((u): u is string => typeof u === 'string' && u.length > 0),
      ),
    ]
    const modelPick = parsePick(parseTextFromXaiResponse(result.json))
    const { accepted, rejected } = pickFromCitations(modelPick, citations, {
      allowedHandles: record.handles,
      detectedAt: record.detectedAt,
    })
    return {
      at,
      ok: true,
      model: result.json.model ?? null,
      modelPick,
      accepted,
      citations: citations.slice(0, 20),
      rejected: rejected.slice(0, 20),
      costTicks: result.json.usage?.cost_in_usd_ticks ?? null,
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    if (isAiSpendDisabledError(err)) throw err
    return {
      at, ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'search failed',
      modelPick: null, accepted: null, citations: [], rejected: [], latencyMs: Date.now() - started,
    }
  }
}

export async function runGrokTdClipPilot(opts: { now?: Date; deadline?: number } = {}): Promise<ClipPilotResult> {
  const result: ClipPilotResult = { skipped: null, touchdownsSeen: 0, due: 0, searched: 0, found: 0, errors: 0 }
  if (process.env.GROK_TD_CLIP_PILOT?.trim() !== '1') return { ...result, skipped: 'disabled' }

  const now = (opts.now ?? new Date()).getTime()
  // ⚠ WALL CLOCK, NOT `now`. `now` decides which plays are due and may be
  // injected; the deadline bounds real elapsed time and is compared against
  // `Date.now()` below. Deriving it from an injected `now` made it already past.
  const deadline = opts.deadline ?? Date.now() + 90_000

  const events = await readPlayByPlayFeed(200).catch(() => [])
  const touchdowns = events.filter((e) => e.type === 'TOUCHDOWN')
  result.touchdownsSeen = touchdowns.length
  if (touchdowns.length === 0) return { ...result, skipped: 'no-touchdowns' }

  // One read for every existing record, rather than one per play.
  const rows = await prisma.sportsDataCache
    .findMany({
      where: { cacheKey: { in: touchdowns.map((e) => recordKey(e.idempotencyKey)) } },
      select: { cacheKey: true, data: true },
    })
    .catch(() => [] as Array<{ cacheKey: string; data: unknown }>)
  const existing = new Map(rows.map((r) => [r.cacheKey, r.data as ClipPilotRecord]))

  const detectedIso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString()
  const due = touchdowns.filter((e) =>
    isClipSearchDue(existing.get(recordKey(e.idempotencyKey)) ?? null, detectedIso(e.detectedAt), now),
  )
  if (due.length === 0) return { ...result, skipped: 'none-due' }

  // Starters only: the clips a fantasy surface would show are of players someone starts.
  const owners = await ownersByPlayerId([...new Set(due.map((e) => e.playerId))], { startersOnly: true }).catch(
    () => new Map<string, string[]>(),
  )
  const started = due.filter((e) => (owners.get(e.playerId)?.length ?? 0) > 0)
  result.due = started.length
  if (started.length === 0) return { ...result, skipped: 'none-due' }

  const budgetKey = `${BUDGET_PREFIX}${new Date(now).toISOString().slice(0, 10)}`
  const budget = (await readJson<{ count: number }>(budgetKey)) ?? { count: 0 }
  const dailyCap = envInt('GROK_TD_CLIP_PILOT_DAILY_CAP', 60)
  const perRun = envInt('GROK_TD_CLIP_PILOT_MAX_PER_RUN', 2)
  if (budget.count >= dailyCap) return { ...result, skipped: 'daily-cap' }

  const feed = await getPlayFeed(200).catch(() => [])
  const presented = new Map(feed.map((p) => [p.id, p]))

  // Oldest first: a play near its retry deadline should not lose to a fresh one.
  started.sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime())

  for (const e of started) {
    if (result.searched >= perRun || budget.count >= dailyCap) break
    if (Date.now() > deadline - DEADLINE_MARGIN_MS) break

    const key = recordKey(e.idempotencyKey)
    const shown = presented.get(e.idempotencyKey)
    const team = shown?.team ?? e.team ?? null
    const prior = existing.get(key)
    const record: ClipPilotRecord = prior ?? {
      version: 1,
      playId: e.idempotencyKey,
      gameId: e.gameId,
      playerName: e.playerName,
      team,
      opponent: await opponentFor(e.gameId, team),
      headline: shown?.headline ?? e.detail,
      detectedAt: detectedIso(e.detectedAt),
      handles: [],
      starterOwners: owners.get(e.playerId)?.length ?? 0,
      attempts: [],
      found: false,
    }
    record.handles = clipHandlesFor(record.team, record.opponent)

    // Claim before spending, so an overlapping invocation does not search it too.
    record.claimedAt = new Date().toISOString()
    await writeJson(key, record, RECORD_TTL_MS)
    budget.count += 1
    await writeJson(budgetKey, budget, 2 * 24 * 60 * 60_000)

    let attempt: ClipAttempt
    try {
      attempt = await searchOnce(record)
    } catch (err) {
      if (isAiSpendDisabledError(err)) {
        record.claimedAt = null
        await writeJson(key, record, RECORD_TTL_MS)
        return { ...result, skipped: 'ai-spend-disabled' }
      }
      throw err
    }
    record.attempts.push(attempt)
    record.found = attempt.accepted != null
    record.claimedAt = null
    await writeJson(key, record, RECORD_TTL_MS)

    result.searched += 1
    if (record.found) result.found += 1
    if (!attempt.ok) result.errors += 1
  }
  return result
}
