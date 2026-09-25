import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'

/**
 * Player news alerts must not repeat themselves to the same person.
 *
 * 🛑 MEASURED 2026-09-25 IN PRODUCTION: one manager got "🏥 Injury Update: Puka Nacua" SEVEN times in
 * two days. Four of those were the SAME ESPN headline ("McVay says Nacua's injury not 'long-term'
 * concern…"), dispatched 09-23 22:50, 23:22, 23:35 and 09-24 11:20. `player_news` is unique on
 * (sport, player, headline, publishedAt), so a source that re-publishes a story with a fresh timestamp
 * becomes a NEW row, and the dispatcher's `notificationDispatchedAt` stamp — correct per row — sends
 * every copy. `dedupePrefix` only collapses the in-app bell row; email and push went out every time.
 *
 * Two keys per person, checked before sending and written after:
 *   - STORY  — the same headline about the same player, once per 7 days, however many rows carry it.
 *   - TOPIC  — the same player, the same kind of news and the same injury status, once per 24 hours.
 *              "questionable" → "ruled out" is a new status and goes through; five outlets repeating
 *              "questionable" do not.
 *
 * ⚠ FAILS OPEN. If the store cannot be read the alert goes out, exactly as before this existed — a
 * repeated alert is annoying, a swallowed "ruled out" before kickoff costs someone their week.
 */

export const STORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const TOPIC_TTL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'player-news-told:v1:'

export type InjuryStatusTag = 'out' | 'ir' | 'doubtful' | 'questionable' | 'limited' | 'dnp' | 'active'

/** Ordered: the first match wins, so "ruled out … after limited practice" reads as out. */
const STATUS_PATTERNS: Array<[InjuryStatusTag, RegExp]> = [
  ['ir', /\binjured reserve\b|\bplaced on (?:the )?ir\b|\bto ir\b/i],
  ['out', /\bruled out\b|\bwon['’]t play\b|\bwill not play\b|\bwill miss\b|\bout for\b|\bis out\b|\bsidelined\b|\bseason[- ]ending\b/i],
  ['doubtful', /\bdoubtful\b|\bin doubt\b/i],
  ['questionable', /\bquestionable\b|\bgame[- ]time decision\b/i],
  ['dnp', /\bdid not practice\b|\bdnp\b|\bsat out practice\b|\bmissed practice\b/i],
  ['limited', /\blimited\b/i],
  ['active', /\bcleared\b|\bactivated\b|\bwill play\b|\bexpected to play\b|\bfull participant\b|\bfully practic/i],
]

export function injuryStatusTag(headline: string): InjuryStatusTag | null {
  for (const [tag, re] of STATUS_PATTERNS) if (re.test(headline)) return tag
  return null
}

function norm(s: string): string {
  return s
    .toLowerCase()
    // Quote marks and punctuation become spaces, so 'long-term', “long-term” and Nacua’s/Nacua's all match.
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 24)
}

export type PlayerNewsIdentity = { sport: string; playerName: string; headline: string; category: string }

export function storyKey(userId: string, n: PlayerNewsIdentity): string {
  return `${PREFIX}story:${userId}:${hash(`${n.sport}|${norm(n.playerName)}|${norm(n.headline)}`)}`
}

export function topicKey(userId: string, n: PlayerNewsIdentity): string {
  const status = n.category === 'injury' ? (injuryStatusTag(n.headline) ?? 'update') : 'any'
  return `${PREFIX}topic:${userId}:${hash(`${n.sport}|${norm(n.playerName)}|${n.category}|${status}`)}`
}

/** Of `userIds`, who has already been told this story or this topic. Empty on any read failure. */
export async function alreadyToldAbout(userIds: readonly string[], news: PlayerNewsIdentity, now = new Date()): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const byKey = new Map<string, string>()
  for (const id of userIds) {
    byKey.set(storyKey(id, news), id)
    byKey.set(topicKey(id, news), id)
  }
  try {
    const rows = await prisma.sportsDataCache.findMany({
      where: { cacheKey: { in: [...byKey.keys()] }, expiresAt: { gt: now } },
      select: { cacheKey: true },
    })
    const told = new Set<string>()
    for (const r of rows) {
      const id = byKey.get(r.cacheKey)
      if (id) told.add(id)
    }
    return told
  } catch {
    return new Set()
  }
}

/** Record that these people were told. Best-effort: a failed write only means a later repeat. */
export async function recordToldAbout(userIds: readonly string[], news: PlayerNewsIdentity, now = new Date()): Promise<void> {
  if (userIds.length === 0) return
  const data = { v: 1, at: now.toISOString() }
  const rows = userIds.flatMap((id) => [
    { cacheKey: storyKey(id, news), data, expiresAt: new Date(now.getTime() + STORY_TTL_MS) },
    { cacheKey: topicKey(id, news), data, expiresAt: new Date(now.getTime() + TOPIC_TTL_MS) },
  ])
  try {
    // An expired row with the same key would block createMany's insert; clear those first.
    await prisma.sportsDataCache.deleteMany({
      where: { cacheKey: { in: rows.map((r) => r.cacheKey) }, expiresAt: { lte: now } },
    })
    await prisma.sportsDataCache.createMany({ data: rows, skipDuplicates: true })
  } catch {
    /* best-effort */
  }
}
