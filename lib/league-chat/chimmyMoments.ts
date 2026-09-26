import 'server-only'

import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import {
  CHIMMY_DISPLAY_NAME,
  CHIMMY_SERVER_KEYS,
  isChimmyMomentKind,
  readChimmySpeaksUp,
  type ChimmyMomentKind,
} from '@/lib/league-chat/chimmyIdentity'

/**
 * `postChimmyMoment` — THE one way Chimmy speaks up in a league's chat on its own.
 *
 * Weekly awards, trade takes (AllFantasy, redraft and imported Sleeper trades), commissioner notices,
 * close finishes and upsets (weekMatchupMoments.ts) and starter injuries (starterInjuryMoment.ts) all
 * post through it. Everything a moment needs to be safe to fire from a cron, a request path or a retry
 * loop lives here, so a new moment is one call:
 *
 * ```ts
 * import { postChimmyMoment } from '@/lib/league-chat/chimmyMoments'
 *
 * const result = await postChimmyMoment({
 *   leagueId,                       // AllFantasy League.id
 *   kind: 'close_finish',           // one of CHIMMY_MOMENT_KINDS (chimmyIdentity.ts)
 *   dedupeKey: `${season}:${week}:${matchupId}`, // unique per moment within league + kind
 *   text: 'Alex held off Sam by 0.4. Survive and advance.',
 *   card: { matchupCard: { … } },   // optional server-built rich payload, merged into metadata
 * })
 * // → { posted: true, messageId } or { posted: false, reason }
 * ```
 *
 * ─── What it guarantees ─────────────────────────────────────────────────────────────────────────
 *
 * IDENTITY. The row is marked `metadata.chimmy = true` plus `chimmyMoment: { v: 1, kind }`, which every
 * reader renders as Chimmy (see chimmyIdentity.ts). The technical author is the league owner, because
 * `LeagueChatMessage.userId` is a required FK and there is no bot user. `card` cannot override any of
 * that: the identity keys and `discordAuthorName` / `discordAuthorAvatarUrl` are stripped from it.
 *
 * ONCE PER MOMENT. `dedupeKey` is CLAIMED before anything is posted, by inserting
 * `chimmy-moment:v1:<leagueId>:<kind>:<dedupeKey>` into `SportsDataCache` (its primary key makes the
 * insert the lock — two concurrent callers cannot both win). A year's TTL. Keep the key free of
 * emails and secrets; it is only ever stored in that cache row, never in the message.
 *
 * SOMETIMES, NOT CONSTANTLY. At most `CHIMMY_DAILY_CAP` (4) moments per league per US-Eastern day,
 * counted by claiming one of four numbered day slots — also a primary-key insert, so the cap holds
 * under concurrency. Two kinds are EXEMPT and do not use a slot:
 *   - weekly awards: one scheduled post a week that the commissioner already controls with its own
 *     switch;
 *   - a commissioner notice: the commissioner pressed "Send notice". The cap exists so Chimmy does not
 *     speak up TOO OFTEN ON ITS OWN; a person asking for a post is not that, and refusing them because
 *     Chimmy already carded four trades that day would be the wrong way round. The automatic
 *     governance summary (`commissioner_alerts`) is Chimmy on its own, so it IS capped.
 * ⚠ A moment that finds the day full is SPENT, not queued — its dedupe claim stays, so a Sunday-night
 * close finish cannot surface on Monday morning as stale news.
 *
 * THE LEAGUE'S SWITCH. `League.settings.chimmySpeaksUp === false` (Commissioner Hub → Automations)
 * silences every moment, awards included. Default ON.
 *
 * NEVER FAILS THE CALLER. It never throws. A failed post releases its claims (so a retry can land it)
 * and logs the moment kind and the error's NAME only — no league id, user id, email or URL.
 *
 * DISCORD. A league that copies its chat to Discord gets the moment there too, as "Chimmy" — the relay
 * reads the marker off the row itself (lib/discord/sync-outbound.ts), so no caller can relay a Chimmy
 * post under the commissioner's name. Best-effort and never awaited by the caller's outcome.
 */

export const CHIMMY_DAILY_CAP = 4

/** Kinds that neither check nor spend a daily slot. */
const CAP_EXEMPT_KINDS: ReadonlySet<ChimmyMomentKind> = new Set<ChimmyMomentKind>(['weekly_awards', 'commissioner_notice'])

const DEDUPE_PREFIX = 'chimmy-moment:v1:'
const SLOT_PREFIX = 'chimmy-moment-slot:v1:'
const DEDUPE_TTL_MS = 365 * 24 * 60 * 60 * 1000
/** Two days, so a slot row outlives its own day in every timezone. */
const SLOT_TTL_MS = 2 * 24 * 60 * 60 * 1000
const MAX_TEXT = 4000
const MAX_DEDUPE_KEY = 200

/** Keys a caller's `card` may not set: the identity is this module's decision, not the caller's. */
const RESERVED_CARD_KEYS: ReadonlySet<string> = new Set<string>([
  ...CHIMMY_SERVER_KEYS,
  'isSystem',
  'discordAuthorName',
  'discordAuthorAvatarUrl',
])

export type PostChimmyMomentInput = {
  /** AllFantasy `League.id`. */
  leagueId: string
  kind: ChimmyMomentKind
  /** Unique per moment within this league and kind — a week, a trade id, a matchup id. */
  dedupeKey: string
  /** What Chimmy says. Plain text, trimmed; longer than 4,000 characters is cut with an ellipsis. */
  text: string
  /** Server-built rich payload merged into the message metadata, e.g. `{ tradeCard: {...} }`. */
  card?: Record<string, unknown> | null
  /** `LeagueChatMessage.type`. Default `'system'`; a trade card uses `'trade'`. */
  messageType?: string
  /** Test seam: the clock the day cap and TTLs are read from. */
  now?: Date
}

export type ChimmyMomentSkipReason =
  | 'invalid' /* missing league id, unknown kind, empty text or key */
  | 'no_league' /* no such league, or it has no owner to author the row */
  | 'disabled' /* the commissioner switched "Chimmy speaks up" off */
  | 'duplicate' /* this moment was already posted (or spent) */
  | 'daily_cap' /* the league already heard from Chimmy CHIMMY_DAILY_CAP times today */
  | 'error' /* the store or the insert failed — nothing was posted, claims released */

export type PostChimmyMomentResult =
  | { posted: true; messageId: string }
  | { posted: false; reason: ChimmyMomentSkipReason }

/** 'YYYY-MM-DD' in US Eastern — the day a league's chat actually lives in. */
export function chimmyDayKey(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function chimmyMomentDedupeCacheKey(leagueId: string, kind: ChimmyMomentKind, dedupeKey: string): string {
  return `${DEDUPE_PREFIX}${leagueId}:${kind}:${dedupeKey}`
}

export function chimmyMomentSlotCacheKey(leagueId: string, dayKey: string, slot: number): string {
  return `${SLOT_PREFIX}${leagueId}:${dayKey}:${slot}`
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : typeof e
}

/**
 * Insert `cacheKey` if nobody holds it. True means this caller now owns it.
 *
 * An EXPIRED row with the same key would block the insert forever, so those go first (the same
 * move `playerNewsRepeatGuard.recordToldAbout` makes).
 */
async function claim(cacheKey: string, now: Date, ttlMs: number, data: Record<string, unknown>): Promise<boolean> {
  await prisma.sportsDataCache.deleteMany({ where: { cacheKey, expiresAt: { lte: now } } })
  const res = await prisma.sportsDataCache.createMany({
    data: [{ cacheKey, data: data as never, expiresAt: new Date(now.getTime() + ttlMs) }],
    skipDuplicates: true,
  })
  return res.count === 1
}

async function release(cacheKeys: string[]): Promise<void> {
  if (cacheKeys.length === 0) return
  await prisma.sportsDataCache.deleteMany({ where: { cacheKey: { in: cacheKeys } } }).catch(() => undefined)
}

function cleanCard(card: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(card)) {
    if (!RESERVED_CARD_KEYS.has(key)) out[key] = value
  }
  return out
}

function clampText(text: string): string {
  const t = text.trim()
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t
}

function relayToDiscord(input: { leagueId: string; messageId: string; text: string; kind: ChimmyMomentKind }): void {
  void import('@/lib/discord/sync-outbound')
    .then(({ syncOutboundLeagueChat }) =>
      syncOutboundLeagueChat({
        leagueId: input.leagueId,
        messageId: input.messageId,
        authorName: CHIMMY_DISPLAY_NAME,
        authorAvatarUrl: null,
        text: input.text,
      }),
    )
    .catch((e: unknown) => {
      console.warn('[chimmyMoments] discord relay failed', { kind: input.kind, error: errorName(e) })
    })
}

export async function postChimmyMoment(input: PostChimmyMomentInput): Promise<PostChimmyMomentResult> {
  const leagueId = typeof input?.leagueId === 'string' ? input.leagueId.trim() : ''
  const dedupeKey = typeof input?.dedupeKey === 'string' ? input.dedupeKey.trim() : ''
  const text = typeof input?.text === 'string' ? clampText(input.text) : ''
  if (!leagueId || !isChimmyMomentKind(input?.kind) || !text || !dedupeKey || dedupeKey.length > MAX_DEDUPE_KEY) {
    return { posted: false, reason: 'invalid' }
  }
  const kind = input.kind
  const now = input.now ?? new Date()
  const held: string[] = []

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, userId: true, settings: true },
    })
    if (!league?.userId) return { posted: false, reason: 'no_league' }
    if (!readChimmySpeaksUp(league.settings)) return { posted: false, reason: 'disabled' }

    const dedupeCacheKey = chimmyMomentDedupeCacheKey(leagueId, kind, dedupeKey)
    if (!(await claim(dedupeCacheKey, now, DEDUPE_TTL_MS, { v: 1, kind, claimedAt: now.toISOString() }))) {
      return { posted: false, reason: 'duplicate' }
    }
    held.push(dedupeCacheKey)

    if (!CAP_EXEMPT_KINDS.has(kind)) {
      const day = chimmyDayKey(now)
      let slotKey: string | null = null
      for (let slot = 1; slot <= CHIMMY_DAILY_CAP; slot += 1) {
        const candidate = chimmyMomentSlotCacheKey(leagueId, day, slot)
        if (await claim(candidate, now, SLOT_TTL_MS, { v: 1, kind, claimedAt: now.toISOString() })) {
          slotKey = candidate
          break
        }
      }
      // Spent, not queued: the dedupe claim is deliberately KEPT (see the header).
      if (!slotKey) return { posted: false, reason: 'daily_cap' }
      held.push(slotKey)
    }

    const created = await createLeagueChatMessage(leagueId, league.userId, text, {
      type: typeof input.messageType === 'string' && input.messageType.trim() ? input.messageType.trim() : 'system',
      metadata: {
        ...cleanCard(input.card),
        isSystem: true,
        chimmy: true,
        chimmyMoment: { v: 1, kind },
      },
    })
    if (!created?.id) {
      await release(held)
      console.warn('[chimmyMoments] post failed', { kind, error: 'no_row' })
      return { posted: false, reason: 'error' }
    }

    relayToDiscord({ leagueId, messageId: created.id, text, kind })
    return { posted: true, messageId: created.id }
  } catch (e) {
    await release(held)
    console.warn('[chimmyMoments] post failed', { kind, error: errorName(e) })
    return { posted: false, reason: 'error' }
  }
}
