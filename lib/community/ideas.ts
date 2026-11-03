import { z } from 'zod'
import { SPORT_TAGS } from './channels'

/**
 * League Lab ideas: a short pitch anyone signed in can post, everyone can upvote, and
 * staff move through a public status. Pure — no database — so client and server share
 * the vocabulary and the form rules are tested directly.
 *
 * An idea is a `CommunityPost` with `kind = 'idea'` in the `league-lab` channel, so it
 * gets replies, reactions, reports and moderation for free.
 */

export const IDEA_CHANNEL = 'league-lab'
export const IDEA_KIND = 'idea'

/** ⚠ Stored on the row. Relabel freely; never rename a value. */
export const IDEA_STATUSES = ['under_review', 'building', 'shipped'] as const
export type IdeaStatus = (typeof IDEA_STATUSES)[number]

export const IDEA_STATUS_COPY: Record<IdeaStatus, { label: string; emoji: string; blurb: string }> = {
  under_review: { label: 'Under review', emoji: '👀', blurb: 'The AllFantasy team is looking at this one.' },
  building: { label: 'Building', emoji: '🛠️', blurb: 'This is being built.' },
  shipped: { label: 'Shipped', emoji: '🚀', blurb: 'Live on AllFantasy. Thank the person who pitched it.' },
}

export function isIdeaStatus(v: unknown): v is IdeaStatus {
  return typeof v === 'string' && (IDEA_STATUSES as readonly string[]).includes(v)
}

export const DRAFT_TYPES = ['snake', 'auction', 'linear', 'no draft', 'other'] as const

export const IDEA_HOOK_MAX = 200
export const IDEA_BODY_MAX = 4_000

export type IdeaDetails = {
  hook: string
  sport: string | null
  teamSize: number | null
  draftType: string | null
}

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

export const createIdeaSchema = z.object({
  title: z.string().trim().min(3).max(80),
  hook: z.string().trim().min(10).max(IDEA_HOOK_MAX),
  body: z.string().trim().min(20).max(IDEA_BODY_MAX),
  sport: optionalText.pipe(z.enum(SPORT_TAGS).optional()),
  teamSize: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
    .pipe(z.number().int().min(2).max(32).optional()),
  draftType: optionalText.pipe(z.enum(DRAFT_TYPES).optional()),
})

export type CreateIdeaInput = z.infer<typeof createIdeaSchema>

/** `null` clears the status back to "open". */
export const ideaStatusSchema = z.object({
  status: z.enum(IDEA_STATUSES).nullable(),
})

export function ideaIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid input'
  const field = String(issue.path[0] ?? '')
  if (field === 'title') return 'Give the idea a name, 3 to 80 characters.'
  if (field === 'hook') return `Sum it up in one line, 10 to ${IDEA_HOOK_MAX} characters.`
  if (field === 'body') return 'Explain how it works in at least 20 characters.'
  if (field === 'teamSize') return 'Team size should be between 2 and 32.'
  if (field === 'sport') return 'Pick a sport from the list.'
  if (field === 'draftType') return 'Pick a draft type from the list.'
  return issue.message
}

export function ideaDetailsFrom(input: CreateIdeaInput): IdeaDetails {
  return {
    hook: input.hook,
    sport: input.sport ?? null,
    teamSize: input.teamSize ?? null,
    draftType: input.draftType ?? null,
  }
}

/** Defensive read of the `ideaDetails` JSON column: anything malformed becomes empty. */
export function parseIdeaDetails(raw: unknown): IdeaDetails {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const teamSize = typeof o.teamSize === 'number' && Number.isFinite(o.teamSize) ? o.teamSize : null
  return {
    hook: typeof o.hook === 'string' ? o.hook : '',
    sport: typeof o.sport === 'string' ? o.sport : null,
    teamSize,
    draftType: typeof o.draftType === 'string' ? o.draftType : null,
  }
}

export type IdeaSort = 'top' | 'new'
export type IdeaFilter = IdeaStatus | 'open' | 'all'

export function parseIdeaSort(v: unknown): IdeaSort {
  return v === 'new' ? 'new' : 'top'
}

export function parseIdeaFilter(v: unknown): IdeaFilter {
  if (v === 'open' || isIdeaStatus(v)) return v
  return 'all'
}

export function ideaBoardHref(opts: { sort?: IdeaSort; status?: IdeaFilter; page?: number } = {}): string {
  const q = new URLSearchParams()
  if (opts.sort && opts.sort !== 'top') q.set('sort', opts.sort)
  if (opts.status && opts.status !== 'all') q.set('status', opts.status)
  if (opts.page && opts.page > 1) q.set('page', String(opts.page))
  const qs = q.toString()
  return `/clubhouse/${IDEA_CHANNEL}${qs ? `?${qs}` : ''}`
}

export const NEW_IDEA_HREF = '/clubhouse/ideas/new'
