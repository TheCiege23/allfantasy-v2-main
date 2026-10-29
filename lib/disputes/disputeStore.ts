/**
 * Dispute desk store (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.2) — pure helpers over
 * `League.settings.league_disputes`. No prisma here; `disputeService.ts` does the locked
 * read-merge-write and the notifications.
 *
 * A dispute is filed by a member, ruled on by a commissioner, or withdrawn by its filer. A ruled or
 * withdrawn dispute is closed for good: a second ruling would rewrite a decision the league has
 * already been told about, so a commissioner who changes their mind files a fresh note instead.
 *
 * ⚠ MEMBERS SEE THEIR OWN DISPUTES AND THE RULINGS POSTED TO CHAT — NOT EVERYONE'S. A dispute is
 * often an accusation ("he is tanking", "they colluded"), and the accused reading it before the
 * commissioner does turns a ruling into a feud. Commissioners see everything.
 */

export const DISPUTE_CATEGORIES = ['stat_correction', 'lineup', 'trade', 'waiver', 'rules', 'other'] as const
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number]

export const RULING_OUTCOMES = ['upheld', 'denied', 'partial'] as const
export type RulingOutcome = (typeof RULING_OUTCOMES)[number]

export type DisputeStatus = 'open' | 'ruled' | 'withdrawn'

export type DisputeRuling = {
  outcome: RulingOutcome
  text: string
  ruledByUserId: string
  ruledByName: string | null
  ruledAt: string
  postedToChat: boolean
}

export type LeagueDispute = {
  id: string
  category: DisputeCategory
  subject: string
  details: string
  filedByUserId: string
  filedByName: string | null
  status: DisputeStatus
  createdAt: string
  closedAt: string | null
  ruling: DisputeRuling | null
}

export const DISPUTES_SETTINGS_KEY = 'league_disputes'
export const SUBJECT_MAX = 120
export const DETAILS_MAX = 2000
export const RULING_MAX = 2000
/** One member cannot bury the desk: past this many open disputes they wait for rulings. */
export const OPEN_PER_FILER_MAX = 5
/** Stored history cap. Closed disputes are pruned oldest first; open ones are never dropped. */
export const STORED_MAX = 200

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function parseRuling(v: unknown): DisputeRuling | null {
  const r = asRecord(v)
  const outcome = str(r.outcome)
  if (!outcome || !(RULING_OUTCOMES as readonly string[]).includes(outcome)) return null
  const ruledByUserId = str(r.ruledByUserId)
  const ruledAt = str(r.ruledAt)
  if (!ruledByUserId || !ruledAt) return null
  return {
    outcome: outcome as RulingOutcome,
    text: str(r.text) ?? '',
    ruledByUserId,
    ruledByName: str(r.ruledByName),
    ruledAt,
    postedToChat: r.postedToChat === true,
  }
}

/** Every well-formed dispute on the league, newest first. Malformed rows are skipped, not repaired. */
export function readDisputes(settings: unknown): LeagueDispute[] {
  const raw = asRecord(settings)[DISPUTES_SETTINGS_KEY]
  if (!Array.isArray(raw)) return []
  const out: LeagueDispute[] = []
  for (const row of raw) {
    const r = asRecord(row)
    const id = str(r.id), filedByUserId = str(r.filedByUserId), createdAt = str(r.createdAt), subject = str(r.subject)
    const category = str(r.category), status = str(r.status)
    if (!id || !filedByUserId || !createdAt || !subject) continue
    if (!category || !(DISPUTE_CATEGORIES as readonly string[]).includes(category)) continue
    if (status !== 'open' && status !== 'ruled' && status !== 'withdrawn') continue
    out.push({
      id,
      category: category as DisputeCategory,
      subject,
      details: str(r.details) ?? '',
      filedByUserId,
      filedByName: str(r.filedByName),
      status,
      createdAt,
      closedAt: str(r.closedAt),
      ruling: status === 'ruled' ? parseRuling(r.ruling) : null,
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function withDisputes(settings: unknown, disputes: LeagueDispute[]): Record<string, unknown> {
  return { ...asRecord(settings), [DISPUTES_SETTINGS_KEY]: prune(disputes) }
}

function prune(disputes: LeagueDispute[]): LeagueDispute[] {
  if (disputes.length <= STORED_MAX) return disputes
  const open = disputes.filter((d) => d.status === 'open')
  const closed = disputes
    .filter((d) => d.status !== 'open')
    .sort((a, b) => (b.closedAt ?? b.createdAt).localeCompare(a.closedAt ?? a.createdAt))
  return [...open, ...closed.slice(0, Math.max(0, STORED_MAX - open.length))]
}

export function openDisputes(disputes: LeagueDispute[]): LeagueDispute[] {
  return disputes.filter((d) => d.status === 'open')
}

/** What a viewer may read. Commissioners: all. Members: their own, plus rulings posted to chat. */
export function visibleDisputes(disputes: LeagueDispute[], viewerUserId: string, isCommissioner: boolean): LeagueDispute[] {
  if (isCommissioner) return disputes
  return disputes.filter((d) => d.filedByUserId === viewerUserId || (d.status === 'ruled' && d.ruling?.postedToChat === true))
}

export type DisputeError =
  | 'subject_required'
  | 'invalid_category'
  | 'too_many_open'
  | 'not_found'
  | 'not_open'
  | 'not_filer'
  | 'invalid_outcome'
  | 'ruling_required'

export type FileDisputeInput = {
  category: unknown
  subject: unknown
  details: unknown
  filedByUserId: string
  filedByName: string | null
}

export function fileDispute(
  disputes: LeagueDispute[],
  input: FileDisputeInput,
  now: Date,
  id: string,
): { ok: true; dispute: LeagueDispute; disputes: LeagueDispute[] } | { ok: false; error: DisputeError } {
  const subject = clean(input.subject, SUBJECT_MAX)
  if (!subject) return { ok: false, error: 'subject_required' }
  const category = typeof input.category === 'string' ? input.category : 'other'
  if (!(DISPUTE_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: 'invalid_category' }
  const mine = disputes.filter((d) => d.status === 'open' && d.filedByUserId === input.filedByUserId).length
  if (mine >= OPEN_PER_FILER_MAX) return { ok: false, error: 'too_many_open' }
  const dispute: LeagueDispute = {
    id,
    category: category as DisputeCategory,
    subject,
    details: clean(input.details, DETAILS_MAX),
    filedByUserId: input.filedByUserId,
    filedByName: input.filedByName,
    status: 'open',
    createdAt: now.toISOString(),
    closedAt: null,
    ruling: null,
  }
  return { ok: true, dispute, disputes: [dispute, ...disputes] }
}

export type RuleDisputeInput = {
  outcome: unknown
  text: unknown
  postToChat: boolean
  ruledByUserId: string
  ruledByName: string | null
}

export function ruleDispute(
  disputes: LeagueDispute[],
  disputeId: string,
  input: RuleDisputeInput,
  now: Date,
): { ok: true; dispute: LeagueDispute; disputes: LeagueDispute[] } | { ok: false; error: DisputeError } {
  const current = disputes.find((d) => d.id === disputeId)
  if (!current) return { ok: false, error: 'not_found' }
  if (current.status !== 'open') return { ok: false, error: 'not_open' }
  const outcome = typeof input.outcome === 'string' ? input.outcome : ''
  if (!(RULING_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: 'invalid_outcome' }
  // A ruling with no reason is the thing that starts the next dispute. One sentence is required.
  const text = clean(input.text, RULING_MAX)
  if (!text) return { ok: false, error: 'ruling_required' }
  const at = now.toISOString()
  const dispute: LeagueDispute = {
    ...current,
    status: 'ruled',
    closedAt: at,
    ruling: {
      outcome: outcome as RulingOutcome,
      text,
      ruledByUserId: input.ruledByUserId,
      ruledByName: input.ruledByName,
      ruledAt: at,
      postedToChat: input.postToChat,
    },
  }
  return { ok: true, dispute, disputes: disputes.map((d) => (d.id === disputeId ? dispute : d)) }
}

export function withdrawDispute(
  disputes: LeagueDispute[],
  disputeId: string,
  userId: string,
  now: Date,
): { ok: true; dispute: LeagueDispute; disputes: LeagueDispute[] } | { ok: false; error: DisputeError } {
  const current = disputes.find((d) => d.id === disputeId)
  if (!current) return { ok: false, error: 'not_found' }
  if (current.filedByUserId !== userId) return { ok: false, error: 'not_filer' }
  if (current.status !== 'open') return { ok: false, error: 'not_open' }
  const dispute: LeagueDispute = { ...current, status: 'withdrawn', closedAt: now.toISOString() }
  return { ok: true, dispute, disputes: disputes.map((d) => (d.id === disputeId ? dispute : d)) }
}

const OUTCOME_LABEL: Record<RulingOutcome, string> = { upheld: 'Upheld', denied: 'Denied', partial: 'Partly upheld' }

/** The league-chat line for a ruling the commissioner chose to post. */
export function rulingChatMessage(d: LeagueDispute): string {
  if (!d.ruling) return ''
  return `⚖️ Commissioner ruling — ${d.subject}\n${OUTCOME_LABEL[d.ruling.outcome]}: ${d.ruling.text}`
}

export const DISPUTE_ERROR_STATUS: Record<DisputeError, number> = {
  subject_required: 400,
  invalid_category: 400,
  invalid_outcome: 400,
  ruling_required: 400,
  too_many_open: 429,
  not_found: 404,
  not_open: 409,
  not_filer: 403,
}
