import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Pure rules for the Grok touchdown-clip PILOT (`grokTdClipPilot.ts`).
 *
 * The pilot asks one question — "can Grok's X search find the official video
 * post of a specific touchdown, reliably and soon enough to be worth showing?" —
 * and only LOGS the answers. Nothing here renders anything to a user.
 *
 * ⚠ A LINK TO A POST, NEVER A VIDEO FILE. `lib/ai/xNewsSearch.ts` records why:
 * `x_search` returns text and citation URLs, never a media asset, and sports
 * video is licensed content, so re-hosting it is a legal question. The only
 * thing this pilot can ever hand a surface is the URL of a post the league or a
 * team published, which X's own embed can show. That is also why it lives here
 * and not as a mode of that file, which asks not to grow one.
 *
 * ⚠ THE CITATION IS THE EVIDENCE, NOT THE MODEL'S PROSE. A post URL the model
 * writes in its answer is a claim; a URL in the tool's `url_citation`
 * annotations is one the search actually returned. `validateClipCandidate` is
 * only ever handed citation URLs, and the model's pick is accepted only when it
 * is one of them.
 */

/**
 * The official X accounts searched for a play: the league plus both teams.
 *
 * ⚠ UNVERIFIED AGAINST X, ON PURPOSE AND ON THE RECORD. `xNewsSearch.ts` warns
 * that a dead handle silently narrows results rather than erroring. Measuring
 * that is part of what this pilot is for: the report breaks hits down by team,
 * so a team whose handle is wrong reads as a team with zero hits across a whole
 * slate — visible, not silent. Correct a handle here, not in a prompt.
 */
export const NFL_X_HANDLES: Record<string, string> = {
  ARI: 'AZCardinals',
  ATL: 'AtlantaFalcons',
  BAL: 'Ravens',
  BUF: 'BuffaloBills',
  CAR: 'Panthers',
  CHI: 'ChicagoBears',
  CIN: 'Bengals',
  CLE: 'Browns',
  DAL: 'dallascowboys',
  DEN: 'Broncos',
  DET: 'Lions',
  GB: 'packers',
  HOU: 'HoustonTexans',
  IND: 'Colts',
  JAX: 'Jaguars',
  KC: 'Chiefs',
  LAC: 'chargers',
  LAR: 'RamsNFL',
  LV: 'Raiders',
  MIA: 'MiamiDolphins',
  MIN: 'Vikings',
  NE: 'Patriots',
  NO: 'Saints',
  NYG: 'Giants',
  NYJ: 'nyjets',
  PHI: 'Eagles',
  PIT: 'steelers',
  SEA: 'Seahawks',
  SF: '49ers',
  TB: 'Buccaneers',
  TEN: 'Titans',
  WAS: 'Commanders',
}

export const NFL_LEAGUE_HANDLE = 'NFL'

/** The accounts to search for one play. Unknown teams simply contribute nothing. */
export function clipHandlesFor(team: string | null, opponent: string | null): string[] {
  const out = [NFL_LEAGUE_HANDLE]
  for (const raw of [team, opponent]) {
    const abbrev = raw ? normalizeTeamAbbrev(raw) : ''
    const handle = abbrev ? NFL_X_HANDLES[abbrev] : undefined
    if (handle && !out.includes(handle)) out.push(handle)
  }
  return out
}

/** X's epoch for status ids (Twitter snowflakes), in ms. */
const X_SNOWFLAKE_EPOCH_MS = 1288834974657n

export type XPostRef = {
  /** Null for the `x.com/i/status/<id>` form, which names no account. */
  handle: string | null
  statusId: string
  /** Decoded from the id itself — the post's creation time, not a claim about it. */
  postedAt: string
  url: string
}

/**
 * Parse an X/Twitter post URL.
 *
 * ⚠ THE POST'S TIME COMES FROM ITS ID. A status id is a snowflake whose top bits
 * are the creation timestamp, so a post from BEFORE the touchdown — last week's
 * clip, a preview — is rejectable without calling X at all. BigInt, because ids
 * exceed 2^53 and a Number silently rounds the low bits.
 */
export function parseXPostUrl(raw: unknown): XPostRef | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase().replace(/^(www\.|mobile\.)/, '')
  if (host !== 'x.com' && host !== 'twitter.com') return null

  const parts = url.pathname.split('/').filter(Boolean)
  let handle: string | null = null
  let statusId: string | undefined
  if (parts[0] === 'i' && parts[1] === 'status') statusId = parts[2]
  else if (parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status') statusId = parts[3]
  else if (parts[1] === 'status') {
    handle = parts[0] ?? null
    statusId = parts[2]
  }
  if (!statusId || !/^\d{6,20}$/.test(statusId)) return null
  if (handle !== null && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null

  const ms = Number((BigInt(statusId) >> 22n) + X_SNOWFLAKE_EPOCH_MS)
  if (!Number.isFinite(ms)) return null
  return {
    handle,
    statusId,
    postedAt: new Date(ms).toISOString(),
    url: `https://x.com/${handle ?? 'i'}/status/${statusId}`,
  }
}

/*
 * How long before the detected play a post may be and still be its clip. The
 * feed detects a play up to a couple of minutes after it happens (35s polling,
 * plus the vendor's own lag), so a clip can legitimately predate detection.
 */
export const CLIP_EARLIEST_BEFORE_DETECTION_MS = 10 * 60_000
/* A clip posted hours later is a recap package, not this play's clip. */
export const CLIP_LATEST_AFTER_DETECTION_MS = 3 * 60 * 60_000

export type ClipRejection =
  | 'not-an-x-post'
  | 'handle-not-allowed'
  | 'posted-before-play'
  | 'posted-too-late'

export function validateClipCandidate(
  rawUrl: unknown,
  opts: { allowedHandles: readonly string[]; detectedAt: string },
): { ok: true; post: XPostRef; lagSeconds: number } | { ok: false; reason: ClipRejection; url: string } {
  const url = typeof rawUrl === 'string' ? rawUrl : String(rawUrl ?? '')
  const post = parseXPostUrl(rawUrl)
  if (!post) return { ok: false, reason: 'not-an-x-post', url }
  if (post.handle !== null) {
    const allowed = new Set(opts.allowedHandles.map((h) => h.toLowerCase()))
    if (!allowed.has(post.handle.toLowerCase())) return { ok: false, reason: 'handle-not-allowed', url }
  }
  const played = new Date(opts.detectedAt).getTime()
  const posted = new Date(post.postedAt).getTime()
  if (posted < played - CLIP_EARLIEST_BEFORE_DETECTION_MS) return { ok: false, reason: 'posted-before-play', url }
  if (posted > played + CLIP_LATEST_AFTER_DETECTION_MS) return { ok: false, reason: 'posted-too-late', url }
  return { ok: true, post, lagSeconds: Math.round((posted - played) / 1000) }
}

/**
 * When a touchdown is due a search.
 *
 * Clips are posted minutes after a play, so searching at detection finds
 * nothing and pays for it. First attempt at 5 minutes, one retry at 30 if the
 * first found nothing, and nothing past 4 hours — measuring how often the retry
 * rescues a miss is itself one of the pilot's answers.
 */
export const CLIP_ATTEMPT_AGES_MS = [5 * 60_000, 30 * 60_000] as const
export const CLIP_GIVE_UP_AGE_MS = 4 * 60 * 60_000
/** A search claimed this recently is in flight in another invocation. */
export const CLIP_CLAIM_TTL_MS = 3 * 60_000

export type ClipAttempt = {
  at: string
  ok: boolean
  error?: string
  model?: string | null
  modelPick: string | null
  accepted: { url: string; handle: string | null; postedAt: string; lagSeconds: number } | null
  citations: string[]
  rejected: Array<{ url: string; reason: ClipRejection }>
  costTicks?: number | null
  latencyMs: number
}

export type ClipPilotRecord = {
  version: 1
  playId: string
  gameId: string
  playerName: string
  team: string | null
  opponent: string | null
  headline: string
  detectedAt: string
  handles: string[]
  /** Users starting this player when the play was picked up. */
  starterOwners: number
  claimedAt?: string | null
  attempts: ClipAttempt[]
  /** Set once an attempt accepted a post; later attempts are not made. */
  found: boolean
}

export function isClipSearchDue(
  record: Pick<ClipPilotRecord, 'detectedAt' | 'attempts' | 'found' | 'claimedAt'> | null,
  detectedAt: string,
  now: number,
): boolean {
  const age = now - new Date(detectedAt).getTime()
  if (!Number.isFinite(age) || age > CLIP_GIVE_UP_AGE_MS) return false
  if (record?.found) return false
  const made = record?.attempts.length ?? 0
  const nextAge = CLIP_ATTEMPT_AGES_MS[made]
  if (nextAge === undefined || age < nextAge) return false
  if (record?.claimedAt && now - new Date(record.claimedAt).getTime() < CLIP_CLAIM_TTL_MS) return false
  return true
}

/** The model's pick counts only when the search itself returned that post. */
export function pickFromCitations(
  modelPick: string | null,
  citations: readonly string[],
  opts: { allowedHandles: readonly string[]; detectedAt: string },
): { accepted: ClipAttempt['accepted']; rejected: ClipAttempt['rejected'] } {
  const rejected: ClipAttempt['rejected'] = []
  const valid = new Map<string, { url: string; handle: string | null; postedAt: string; lagSeconds: number }>()
  for (const c of citations) {
    const v = validateClipCandidate(c, opts)
    if (v.ok) {
      valid.set(v.post.statusId, { url: v.post.url, handle: v.post.handle, postedAt: v.post.postedAt, lagSeconds: v.lagSeconds })
    } else {
      rejected.push({ url: v.url, reason: v.reason })
    }
  }
  const picked = parseXPostUrl(modelPick)
  const accepted = picked ? (valid.get(picked.statusId) ?? null) : null
  return { accepted, rejected }
}

export type ClipPilotSummary = {
  touchdowns: number
  searches: number
  found: number
  foundOnFirstAttempt: number
  foundOnRetry: number
  /** Searches that failed outright (HTTP error, timeout) — not the same as "found nothing". */
  failedSearches: number
  /** Posts the model named that the gate refused: not among the search's citations, or failing the handle/time check. */
  picksRejected: number
  lagSecondsMedian: number | null
  lagSecondsP90: number | null
  latencyMsMedian: number | null
  costTicksTotal: number
  /** Accepted links whose URL names no account (`x.com/i/status/…`) — the handle filter could not be re-checked. */
  acceptedWithoutHandle: number
  rejectedByReason: Record<string, number>
  /** Per team: searched, found. A team at 0 found across a slate points at a wrong handle. */
  byTeam: Record<string, { searched: number; found: number }>
  /** For the human check the pilot exists for: is each accepted post really that play? */
  foundLinks: Array<{ playerName: string; headline: string; url: string; lagSeconds: number; attempt: number }>
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

export function summarizeClipPilot(records: readonly ClipPilotRecord[]): ClipPilotSummary {
  const s: ClipPilotSummary = {
    touchdowns: 0, searches: 0, found: 0, foundOnFirstAttempt: 0, foundOnRetry: 0, failedSearches: 0,
    picksRejected: 0, lagSecondsMedian: null, lagSecondsP90: null, latencyMsMedian: null, costTicksTotal: 0,
    acceptedWithoutHandle: 0, rejectedByReason: {}, byTeam: {}, foundLinks: [],
  }
  const lags: number[] = []
  const latencies: number[] = []
  for (const r of records) {
    if (r.attempts.length === 0) continue
    s.touchdowns += 1
    const team = r.team ?? 'unknown'
    const t = (s.byTeam[team] ??= { searched: 0, found: 0 })
    t.searched += 1
    r.attempts.forEach((a, i) => {
      s.searches += 1
      latencies.push(a.latencyMs)
      if (!a.ok) s.failedSearches += 1
      if (typeof a.costTicks === 'number') s.costTicksTotal += a.costTicks
      if (a.modelPick && !a.accepted) s.picksRejected += 1
      for (const rej of a.rejected) s.rejectedByReason[rej.reason] = (s.rejectedByReason[rej.reason] ?? 0) + 1
      if (a.accepted) {
        s.found += 1
        t.found += 1
        if (i === 0) s.foundOnFirstAttempt += 1
        else s.foundOnRetry += 1
        if (a.accepted.handle === null) s.acceptedWithoutHandle += 1
        lags.push(a.accepted.lagSeconds)
        s.foundLinks.push({ playerName: r.playerName, headline: r.headline, url: a.accepted.url, lagSeconds: a.accepted.lagSeconds, attempt: i + 1 })
      }
    })
  }
  lags.sort((a, b) => a - b)
  latencies.sort((a, b) => a - b)
  s.lagSecondsMedian = quantile(lags, 0.5)
  s.lagSecondsP90 = quantile(lags, 0.9)
  s.latencyMsMedian = quantile(latencies, 0.5)
  return s
}

/** The dated window for `x_search`, as the UTC calendar days either side of the play. */
export function searchDateWindow(detectedAt: string): { from_date: string; to_date: string } {
  const at = new Date(detectedAt).getTime()
  return {
    from_date: new Date(at - 24 * 60 * 60_000).toISOString().slice(0, 10),
    to_date: new Date(at + 24 * 60 * 60_000).toISOString().slice(0, 10),
  }
}
