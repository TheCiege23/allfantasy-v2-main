/**
 * League events in a NATIVE REDRAFT league's chat, read off what the messages already carry.
 * Redraft visual upgrade, batch A4 (docs/design/redraft-tab-inventory.md). Pure and client-safe.
 *
 * Four kinds — trade, claim, score, recap — and two presentations, because two different things
 * post them:
 *
 *   'card'   — an AUTHORLESS league notice. The G42 communication runtime
 *              (lib/league-notifications/nflRedraftCommunicationRuntime.ts) mirrors trades, waiver
 *              claims, scores and finals into chat as `trade_accepted` / `trade_notice` /
 *              `waiver_notice` / `scoring_notice` / `matchup_notice`, authored by the league owner only
 *              because `LeagueChatMessage.userId` is a required FK. Drawn as a bubble, that read as
 *              the commissioner saying "Final score: 98.6-87.2." These become a system row
 *              (ChatMessageList `renderSystem`): nobody to reply to, nothing to react to.
 *   'bubble' — a CHIMMY post with a league event in it: the trade take (`tradeCard`,
 *              chimmyTradeMoment.ts) and the weekly recap (`weeklyRecap`, nativeWeeklyRecap.ts /
 *              weeklyRecapMoment.ts). People reply to and react to these, so they stay messages and
 *              only LOOK like an event card (ChatMessageList `eventKindFor` → `data-event-kind`).
 *
 * ⚠ KEYED ON `messageType`, WHICH A CLIENT CANNOT SET. `sanitizeClientMessageType`
 * (lib/chat-core/clientMessageInput.ts) stores anything but text / poll / image / gif / file as
 * 'text', so a member cannot post a fake "Trade accepted" card. The Chimmy marker is likewise
 * server-owned (chimmyIdentity.ts).
 *
 * ⚠ NO INVENTED NUMBERS. FAAB is shown only when the event payload carries a spend
 * (`faabSpent` / `bidAmount`) — and today's `waiver.claim.won` event does NOT
 * (lib/waiver-runtime/canonicalNflRedraftWaiverRuntime.ts sends claimId / rosterId / addPlayerId),
 * so a real claim card shows no FAAB until a producer adds it. A score line needs both scores as
 * finite numbers; team names are shown only when the payload names them.
 */
import { isChimmyAuthored } from '@/lib/league-chat/chimmyIdentity'
import { isWeeklyRecap } from '@/lib/league-chat/recapShare'

export type RedraftChatEventKind = 'trade' | 'claim' | 'score' | 'recap'

export type RedraftChatScoreLine = {
  homeName: string | null
  homeScore: number
  awayName: string | null
  awayScore: number
}

export type RedraftChatEvent = {
  kind: RedraftChatEventKind
  presentation: 'card' | 'bubble'
  /** The card's eyebrow, e.g. "Trade accepted", "Claim won", "Week 8 recap". */
  label: string
  /** Whole-dollar FAAB spend, claims only, and only when the payload carries one. */
  faab: number | null
  score: RedraftChatScoreLine | null
  /** The message text as posted. */
  body: string
}

export type RedraftChatEventInput = {
  messageType?: string | null
  metadata?: Record<string, unknown> | null
  body?: string | null
}

const CARD_KIND: Record<string, RedraftChatEventKind> = {
  trade_accepted: 'trade',
  trade_notice: 'trade',
  waiver_notice: 'claim',
  waiver_result: 'claim',
  waiver_bot: 'claim',
  scoring_notice: 'score',
  matchup_notice: 'score',
}

/** The runtime event behind a G42 notice → the label it reads as. */
const EVENT_LABEL: Record<string, string> = {
  'trade.accepted': 'Trade accepted',
  'trade.processed': 'Trade accepted',
  'trade.proposed': 'Trade proposed',
  'trade.vetoed': 'Trade vetoed',
  'waiver.claim.won': 'Claim won',
  'waiver.claim.submitted': 'Claim submitted',
  'waiver.free_agent.added': 'Free agent added',
  'waiver.processed': 'Waivers processed',
  'matchup.finalized': 'Final',
  'scoring.updated': 'Score update',
  'scoring.team_score.updated': 'Score update',
  'scoring.matchup_score.updated': 'Score update',
  'standings.updated': 'Standings updated',
  'standings.recalculated': 'Standings updated',
}

const DEFAULT_LABEL: Record<string, string> = {
  trade_accepted: 'Trade accepted',
  trade_notice: 'Trade',
  waiver_notice: 'Waivers',
  waiver_result: 'Waivers',
  waiver_bot: 'Waivers',
  scoring_notice: 'Score update',
  matchup_notice: 'Final',
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function text(v: unknown, max = 80): string | null {
  return typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function isDeleted(meta: Record<string, unknown> | null): boolean {
  return Boolean(meta && typeof meta.deletedAt === 'string' && meta.deletedAt)
}

function payloadOf(meta: Record<string, unknown>): Record<string, unknown> {
  return record(record(meta.relatedRuntimeEvent)?.payload) ?? {}
}

function faabOf(payload: Record<string, unknown>): number | null {
  for (const key of ['faabSpent', 'bidAmount']) {
    const n = num(payload[key])
    if (n != null && n > 0) return Math.round(n)
  }
  return null
}

function scoreOf(payload: Record<string, unknown>): RedraftChatScoreLine | null {
  const homeScore = num(payload.homeScore)
  const awayScore = num(payload.awayScore)
  if (homeScore == null || awayScore == null) return null
  return {
    homeName: text(payload.homeTeamName) ?? text(payload.homeName),
    homeScore,
    awayName: text(payload.awayTeamName) ?? text(payload.awayName),
    awayScore,
  }
}

function weekOf(meta: Record<string, unknown>): number | null {
  const w = num(meta.week) ?? (typeof meta.week === 'string' && /^\d{1,2}$/.test(meta.week) ? Number(meta.week) : null)
  return w != null && w > 0 ? w : null
}

/** The league event a message is, or null for an ordinary message (and for any deleted row). */
export function readRedraftChatEvent(m: RedraftChatEventInput): RedraftChatEvent | null {
  const meta = record(m.metadata)
  if (isDeleted(meta)) return null
  const type = String(m.messageType ?? '').trim().toLowerCase()
  const body = typeof m.body === 'string' ? m.body.trim() : ''

  if (meta && isWeeklyRecap(meta)) {
    const week = weekOf(meta)
    return { kind: 'recap', presentation: 'bubble', label: week ? `Week ${week} recap` : 'Weekly recap', faab: null, score: null, body }
  }
  if (meta && type === 'trade' && isChimmyAuthored(meta) && record(meta.tradeCard)) {
    return { kind: 'trade', presentation: 'bubble', label: 'Trade', faab: null, score: null, body }
  }

  const kind = CARD_KIND[type]
  if (!kind) return null
  // A Chimmy row is Chimmy talking, never an authorless notice — whatever its type.
  if (meta && isChimmyAuthored(meta)) return null
  const payload = meta ? payloadOf(meta) : {}
  const eventType = meta ? text(meta.relatedRuntimeEventType, 60) : null
  const label = (eventType && EVENT_LABEL[eventType]) ?? (meta ? text(meta.notificationTitle, 40) : null) ?? DEFAULT_LABEL[type]
  return {
    kind,
    presentation: 'card',
    label,
    faab: kind === 'claim' && eventType === 'waiver.claim.won' ? faabOf(payload) : null,
    score: kind === 'score' ? scoreOf(payload) : null,
    body,
  }
}

/** For ChatMessageList `eventKindFor`: the kind, for either presentation. */
export function redraftChatEventKind(m: RedraftChatEventInput): RedraftChatEventKind | null {
  return readRedraftChatEvent(m)?.kind ?? null
}

// ── The pinned score ────────────────────────────────────────────────────────────────────────────

/** The fields of the rail's `RailMatchupSummary` the pinned score reads (a structural subset). */
export type PinnedMatchupInput = {
  week?: number
  yourTeam: string | null
  yourScore: number
  opponentTeam: string | null
  opponentScore: number
  unpaired?: boolean
  scored: boolean
  freshAt?: string | null
  source?: 'live_cache' | 'history_fallback'
}

export type PinnedScore = {
  /** Scores moved within the last 15 minutes (the rail's own "live" window). */
  live: boolean
  week: number | null
  you: { name: string; score: number | null }
  them: { name: string; score: number | null }
  leader: 'you' | 'them' | null
}

/** The rail's live window (LeagueRail `useLeagueRail`): a live-cache row younger than 15 minutes. */
const LIVE_WINDOW_MS = 15 * 60_000

/**
 * The user's matchup for the chat header, from the rail snapshot the league page already loaded
 * (app/league/[leagueId]/page.tsx → `getRailMatchups`). Null when there is no head-to-head to show:
 * no snapshot, an unpaired week (an elimination field or an unpaired schedule), or no opponent name.
 */
export function readPinnedScore(m: PinnedMatchupInput | null | undefined, now: number): PinnedScore | null {
  if (!m || m.unpaired) return null
  const you = typeof m.yourTeam === 'string' && m.yourTeam.trim() ? m.yourTeam.trim() : null
  const them = typeof m.opponentTeam === 'string' && m.opponentTeam.trim() ? m.opponentTeam.trim() : null
  if (!you || !them) return null
  const scored = m.scored && Number.isFinite(m.yourScore) && Number.isFinite(m.opponentScore)
  const fresh = m.source === 'live_cache' && typeof m.freshAt === 'string' ? Date.parse(m.freshAt) : NaN
  return {
    live: scored && Number.isFinite(fresh) && now - fresh >= 0 && now - fresh < LIVE_WINDOW_MS,
    week: typeof m.week === 'number' && m.week > 0 ? m.week : null,
    you: { name: you, score: scored ? m.yourScore : null },
    them: { name: them, score: scored ? m.opponentScore : null },
    leader: !scored || m.yourScore === m.opponentScore ? null : m.yourScore > m.opponentScore ? 'you' : 'them',
  }
}
