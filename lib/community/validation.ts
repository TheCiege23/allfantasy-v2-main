import { z } from 'zod'
import { REPORT_REASONS } from '@/lib/moderation/shared'
import { COMMUNITY_REACTIONS, SPORT_TAGS, isChannelSlug } from './channels'

/**
 * Input shapes for every Clubhouse write, plus the posting-limit rules. Pure — no
 * database, no session — so the rules are tested directly rather than through a route.
 */

export const POST_TITLE_MAX = 160
export const POST_BODY_MAX = 10_000
export const REPLY_BODY_MAX = 5_000
export const MAX_TAGS = 3

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

/** Upper-cases and dedupes, and drops anything that is not a known sport tag. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const known = new Set<string>(SPORT_TAGS)
  const out: string[] = []
  for (const t of raw) {
    const tag = String(t ?? '').trim().toUpperCase()
    if (known.has(tag) && !out.includes(tag)) out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export const createPostSchema = z.object({
  channel: z.string().refine(isChannelSlug, 'Pick a channel'),
  title: trimmed(3, POST_TITLE_MAX),
  body: trimmed(1, POST_BODY_MAX),
  tags: z.unknown().optional().transform(normalizeTags),
})

export const editPostSchema = z.object({
  title: trimmed(3, POST_TITLE_MAX),
  body: trimmed(1, POST_BODY_MAX),
  tags: z.unknown().optional().transform(normalizeTags),
})

export const replySchema = z.object({
  body: trimmed(1, REPLY_BODY_MAX),
})

export const moderatePostSchema = z.object({
  action: z.enum(['pin', 'unpin', 'lock', 'unlock', 'remove', 'restore']),
})

export const reactionSchema = z.object({
  targetType: z.enum(['post', 'reply']),
  targetId: z.string().min(1).max(64),
  emoji: z.enum(COMMUNITY_REACTIONS),
})

export const reportSchema = z.object({
  targetType: z.enum(['post', 'reply']),
  targetId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).optional(),
})

export const resolveReportSchema = z.object({
  action: z.enum(['dismiss', 'remove']),
})

/** The first readable message out of a zod failure, for a form to show as-is. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid input'
  const field = issue.path[0]
  if (issue.code === 'too_small' && field === 'title') return 'Give your post a title (at least 3 characters).'
  if (issue.code === 'too_small' && field === 'body') return 'Write something first.'
  if (issue.code === 'too_big') return `${String(field ?? 'Text')} is too long.`
  return issue.message
}

/**
 * Brand-new accounts get a lower daily ceiling. This is the cheapest spam brake there
 * is: a throwaway account has to wait a day before it can flood a channel, and a real
 * newcomer is nowhere near three posts on day one.
 *
 * Counted from the database rather than the in-process limiter, so it holds across
 * replicas and restarts — the in-process limiter is only a burst brake.
 */
export const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000
export const NEW_ACCOUNT_DAILY_POSTS = 3
export const NEW_ACCOUNT_DAILY_REPLIES = 15

export function newAccountLimitFor(kind: 'post' | 'reply'): number {
  return kind === 'post' ? NEW_ACCOUNT_DAILY_POSTS : NEW_ACCOUNT_DAILY_REPLIES
}

export function isNewAccount(accountCreatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - accountCreatedAt.getTime() < NEW_ACCOUNT_WINDOW_MS
}

/** Null when allowed, otherwise the message to show. */
export function newAccountLimitMessage(args: {
  kind: 'post' | 'reply'
  accountCreatedAt: Date
  countInLastDay: number
  now?: Date
}): string | null {
  if (!isNewAccount(args.accountCreatedAt, args.now)) return null
  const limit = newAccountLimitFor(args.kind)
  if (args.countInLastDay < limit) return null
  return args.kind === 'post'
    ? `New accounts can start ${limit} posts on their first day. Reply to others in the meantime, or come back tomorrow.`
    : `New accounts can post ${limit} replies on their first day. Come back tomorrow for more.`
}
