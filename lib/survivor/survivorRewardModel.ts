/**
 * Survivor rewards — the pure half (no I/O; safe on the client). The DB half is
 * `survivorRewardEngine.ts`, re-exported from `SurvivorEffectEngine.ts` as the one public reward API.
 *
 * The owner's original league paid prizes the app could not express before: points taken away,
 * FAAB taken from the other tribe, points the winner places on a tribemate, a prize that pays next
 * week, a free same-position trade, and a steal that a "blocker" cancels. Every one of them is a
 * `SurvivorRewardSpec` here, validated by `validateSurvivorRewardSpec`, and stored as an append-only
 * ledger of `SurvivorAuditEntry` rows (category `reward`, relatedEntityType `survivor_reward`,
 * relatedEntityId = the reward id = the caller's idempotency key). `foldSurvivorRewardLedger` turns
 * those rows back into each reward's current state, so there is no new table.
 *
 * Spoiler safety: a reward's ledger rows are commissioner-visible and never public (`isVisibleToPublic`
 * false). A steal blocker in particular is private to its holder; Chimmy never consults blockers when
 * it picks a steal target for a seat it runs.
 */

export const SURVIVOR_REWARD_TYPES = [
  'score_bonus',
  'score_penalty',
  'faab_grant',
  'faab_penalty',
  'faab_transfer',
  'tribemate_points',
  'free_trade_token',
  'steal_blocker',
  'steal',
  'advantage',
] as const
export type SurvivorRewardType = (typeof SURVIVOR_REWARD_TYPES)[number]

export const SURVIVOR_REWARD_SOURCE_KINDS = ['challenge', 'weekly_prize', 'auction', 'pool', 'exile', 'commissioner', 'other'] as const
export type SurvivorRewardSourceKind = (typeof SURVIVOR_REWARD_SOURCE_KINDS)[number]

/** Advantages a reward may hand out (the playable powers of the idol catalog). */
export const SURVIVOR_REWARD_ADVANTAGE_POWERS = ['extra_vote', 'vote_shield', 'vote_steal'] as const
export type SurvivorRewardAdvantagePower = (typeof SURVIVOR_REWARD_ADVANTAGE_POWERS)[number]

export const SURVIVOR_REWARD_LIMITS = {
  /** Largest points prize or penalty, per reward. */
  points: 500,
  /** Largest FAAB prize, transfer or steal, per reward (dollars). */
  faab: 1000,
  idempotencyKeyLength: 200,
} as const

/** Ids are `Roster.id` (what `SurvivorPlayer.redraftRosterId` stores) and `SurvivorTribe.id`. */
export type SurvivorRewardSpec =
  /** Real points added to that manager's weekly Survivor score (boost column; survives re-syncs). */
  | { type: 'score_bonus'; rosterId: string; points: number; targetWeek?: number | null }
  /** Real points taken off that manager's weekly Survivor score (penalty column). */
  | { type: 'score_penalty'; rosterId: string; points: number; targetWeek?: number | null }
  /** FAAB credited to one manager. */
  | { type: 'faab_grant'; rosterId: string; amount: number }
  /**
   * FAAB taken from one manager (a lost challenge wager, a missed prop): never below 0 — a manager
   * who cannot pay gives what they have. Added for the challenge builder.
   */
  | { type: 'faab_penalty'; rosterId: string; amount: number }
  /**
   * FAAB taken from one tribe and given to another. `per_member` (default): each source member
   * gives `amount`; `total`: the source tribe gives `amount` split evenly. Nobody drops below 0 —
   * a member who cannot pay gives what they have. The collected sum is split evenly (whole dollars,
   * remainder to the lowest roster ids) across the receiving tribe.
   */
  | { type: 'faab_transfer'; fromTribeId: string; toTribeId: string; amount: number; basis?: 'per_member' | 'total' }
  /**
   * The winner places `points` on an active tribemate's score for `targetWeek` (default: the week
   * won). With no `targetRosterId` the reward waits for the winner's choice
   * (`chooseSurvivorRewardTarget`); Chimmy chooses for a seat it runs.
   */
  | { type: 'tribemate_points'; chooserRosterId: string; points: number; targetRosterId?: string | null; targetWeek?: number | null; allowSelf?: boolean }
  /**
   * A one-time permission: one trade that bypasses Survivor trade restrictions. Stored, listed and
   * redeemed (`redeemSurvivorTradeToken`); the trade rules decide where it is honoured.
   */
  | { type: 'free_trade_token'; rosterId: string; samePositionOnly?: boolean; expiresAfterWeek?: number | null }
  /** Cancels the next steal aimed at its holder, and is consumed doing so. Private to the holder. */
  | { type: 'steal_blocker'; rosterId: string }
  /**
   * Take `amount` FAAB or points from a target. A target holding a blocker cancels it (the blocker
   * is consumed). With no `targetRosterId` the steal waits for the thief's choice.
   */
  | { type: 'steal'; thiefRosterId: string; what: 'faab' | 'points'; amount: number; targetRosterId?: string | null; targetWeek?: number | null }
  /** A revealed advantage (an idol-table power) handed to one manager. */
  | { type: 'advantage'; rosterId: string; powerType: SurvivorRewardAdvantagePower }

export interface SurvivorRewardSource {
  kind: SurvivorRewardSourceKind
  /** Challenge id, auction id, pool id… */
  id?: string | null
  /** Short public label ("Week 6 First TD challenge"). */
  label?: string | null
}

export interface ApplySurvivorRewardInput {
  leagueId: string
  /**
   * REQUIRED and stable: the same key never pays twice. Build it from the source and the recipient,
   * e.g. `challenge:<challengeId>:<rosterId>:faab`. It becomes the reward id.
   */
  idempotencyKey: string
  source: SurvivorRewardSource
  /** The week the reward was won. */
  week: number
  reward: SurvivorRewardSpec
  /**
   * A deferred reward: recorded now, applied by the season runner once `deferToWeek` is the current
   * week (any type). Must be later than `week`. Points default to land on that week.
   */
  deferToWeek?: number | null
  /** The user who caused it (commissioner) — null for automation. */
  actorUserId?: string | null
}

export type SurvivorRewardStatus =
  | 'applied'
  | 'awaiting_choice'
  | 'deferred'
  | 'available'
  | 'consumed'
  | 'blocked'
  | 'reversed'
  | 'expired'

/** One concrete change a reward made, kept so it can be reversed exactly. */
export type SurvivorRewardChange =
  | { kind: 'faab'; rosterId: string; delta: number }
  | { kind: 'score'; rosterId: string; userId: string; week: number; boost: number; penalty: number }
  | { kind: 'advantage'; rosterId: string; idolId: string; powerType: string }

export const SURVIVOR_REWARD_ACTIONS = {
  granted: 'reward_granted',
  choice: 'reward_choice_made',
  deferredApplied: 'reward_deferred_applied',
  consumed: 'reward_consumed',
  blocked: 'reward_blocked',
  reversed: 'reward_reversed',
} as const
export const SURVIVOR_REWARD_ENTITY = 'survivor_reward'
export const SURVIVOR_REWARD_CATEGORY = 'reward'

export interface SurvivorRewardLedgerRow {
  action: string
  relatedEntityId: string | null
  week?: number | null
  data: unknown
  createdAt: Date | string
}

export interface SurvivorRewardRecord {
  rewardId: string
  type: SurvivorRewardType
  status: SurvivorRewardStatus
  /** Week won. */
  week: number
  /** Week it applies to (deferred / targetWeek), else `week`. */
  applyWeek: number
  spec: SurvivorRewardSpec
  source: SurvivorRewardSource
  /** Who holds / benefits (the token holder, the chooser, the thief…). */
  holderRosterIds: string[]
  changes: SurvivorRewardChange[]
  /** Free text the engine attached ("blocked by a blocker", "trade t-123"). */
  note: string | null
  createdAt: string
  updatedAt: string
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 128
const isWeek = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 60
const isWhole = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= max
const isPoints = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= SURVIVOR_REWARD_LIMITS.points && Math.round(v * 100) === v * 100

/** Null when valid; otherwise the first problem, in plain English. */
export function validateSurvivorRewardSpec(spec: unknown): string | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'A reward needs a type.'
  const r = spec as Record<string, unknown>
  const type = r.type
  if (typeof type !== 'string' || !(SURVIVOR_REWARD_TYPES as readonly string[]).includes(type)) return `Unknown reward type "${String(type)}".`
  const optWeek = (k: string) => r[k] == null || isWeek(r[k])
  switch (type as SurvivorRewardType) {
    case 'score_bonus':
    case 'score_penalty':
      if (!isId(r.rosterId)) return 'Choose the manager.'
      if (!isPoints(r.points)) return `Points must be more than 0 and at most ${SURVIVOR_REWARD_LIMITS.points}.`
      if (!optWeek('targetWeek')) return 'The target week is not valid.'
      return null
    case 'faab_grant':
    case 'faab_penalty':
      if (!isId(r.rosterId)) return 'Choose the manager.'
      if (!isWhole(r.amount, SURVIVOR_REWARD_LIMITS.faab)) return `FAAB must be a whole amount from $1 to $${SURVIVOR_REWARD_LIMITS.faab}.`
      return null
    case 'faab_transfer':
      if (!isId(r.fromTribeId) || !isId(r.toTribeId)) return 'Choose both tribes.'
      if (r.fromTribeId === r.toTribeId) return 'FAAB must move between two different tribes.'
      if (!isWhole(r.amount, SURVIVOR_REWARD_LIMITS.faab)) return `FAAB must be a whole amount from $1 to $${SURVIVOR_REWARD_LIMITS.faab}.`
      if (r.basis != null && r.basis !== 'per_member' && r.basis !== 'total') return 'The FAAB split must be per member or total.'
      return null
    case 'tribemate_points':
      if (!isId(r.chooserRosterId)) return 'Choose the winner.'
      if (!isPoints(r.points)) return `Points must be more than 0 and at most ${SURVIVOR_REWARD_LIMITS.points}.`
      if (r.targetRosterId != null && !isId(r.targetRosterId)) return 'The tribemate is not valid.'
      if (r.targetRosterId != null && r.targetRosterId === r.chooserRosterId && r.allowSelf !== true) return 'The points must go on a tribemate, not the winner.'
      if (!optWeek('targetWeek')) return 'The target week is not valid.'
      return null
    case 'free_trade_token':
      if (!isId(r.rosterId)) return 'Choose the manager.'
      if (!optWeek('expiresAfterWeek')) return 'The expiry week is not valid.'
      return null
    case 'steal_blocker':
      return isId(r.rosterId) ? null : 'Choose the manager.'
    case 'steal':
      if (!isId(r.thiefRosterId)) return 'Choose who steals.'
      if (r.what !== 'faab' && r.what !== 'points') return 'A steal takes FAAB or points.'
      if (r.what === 'faab' ? !isWhole(r.amount, SURVIVOR_REWARD_LIMITS.faab) : !isPoints(r.amount)) return 'The steal amount is not valid.'
      if (r.targetRosterId != null && !isId(r.targetRosterId)) return 'The target is not valid.'
      if (r.targetRosterId != null && r.targetRosterId === r.thiefRosterId) return 'A manager cannot steal from themselves.'
      if (!optWeek('targetWeek')) return 'The target week is not valid.'
      return null
    case 'advantage':
      if (!isId(r.rosterId)) return 'Choose the manager.'
      if (!(SURVIVOR_REWARD_ADVANTAGE_POWERS as readonly string[]).includes(String(r.powerType))) return 'Choose an advantage.'
      return null
  }
}

export function validateApplySurvivorRewardInput(input: ApplySurvivorRewardInput): string | null {
  if (!input || typeof input !== 'object') return 'Send a reward.'
  if (!isId(input.leagueId)) return 'leagueId required'
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > SURVIVOR_REWARD_LIMITS.idempotencyKeyLength) {
    return 'An idempotency key is required (at most 200 characters).'
  }
  if (!input.source || !(SURVIVOR_REWARD_SOURCE_KINDS as readonly string[]).includes(input.source.kind)) return 'Say where the reward came from.'
  if (!isWeek(input.week)) return 'The week is not valid.'
  if (input.deferToWeek != null && (!isWeek(input.deferToWeek) || input.deferToWeek <= input.week)) return 'A deferred reward must land in a later week.'
  return validateSurvivorRewardSpec(input.reward)
}

/** The roster ids a reward belongs to (the holder / chooser / thief). */
export function rewardHolderRosterIds(spec: SurvivorRewardSpec): string[] {
  switch (spec.type) {
    case 'tribemate_points': return [spec.chooserRosterId]
    case 'steal': return [spec.thiefRosterId]
    case 'faab_transfer': return []
    default: return [spec.rosterId]
  }
}

/** The week a points reward lands on. */
export function rewardApplyWeek(input: Pick<ApplySurvivorRewardInput, 'week' | 'deferToWeek' | 'reward'>): number {
  const target = 'targetWeek' in input.reward && typeof input.reward.targetWeek === 'number' ? input.reward.targetWeek : null
  return input.deferToWeek ?? target ?? input.week
}

/** Whether a reward needs its holder's choice before it can apply. */
export function rewardNeedsChoice(spec: SurvivorRewardSpec): boolean {
  return (spec.type === 'tribemate_points' || spec.type === 'steal') && !spec.targetRosterId
}

export interface FaabTransferPlan {
  debits: { rosterId: string; amount: number }[]
  credits: { rosterId: string; amount: number }[]
  collected: number
}

/**
 * The FAAB a transfer moves, whole dollars, never below 0. Deterministic: sources and destinations
 * are taken in roster-id order, and the remainder of an uneven split goes to the lowest ids.
 */
export function computeFaabTransfer(args: {
  sources: readonly { rosterId: string; balance: number }[]
  destinationRosterIds: readonly string[]
  amount: number
  basis?: 'per_member' | 'total'
}): FaabTransferPlan {
  const sources = [...args.sources].sort((a, b) => a.rosterId.localeCompare(b.rosterId))
  const destinations = [...new Set(args.destinationRosterIds)].sort((a, b) => a.localeCompare(b))
  const debits: FaabTransferPlan['debits'] = []
  if (!sources.length || !destinations.length || !(args.amount > 0)) return { debits, credits: [], collected: 0 }
  const owed = new Map<string, number>()
  if ((args.basis ?? 'per_member') === 'per_member') {
    for (const s of sources) owed.set(s.rosterId, Math.floor(args.amount))
  } else {
    const share = Math.floor(args.amount / sources.length)
    let remainder = Math.floor(args.amount) - share * sources.length
    for (const s of sources) {
      owed.set(s.rosterId, share + (remainder > 0 ? 1 : 0))
      if (remainder > 0) remainder--
    }
  }
  for (const s of sources) {
    const available = Math.max(0, Math.floor(Number.isFinite(s.balance) ? s.balance : 0))
    const take = Math.min(owed.get(s.rosterId) ?? 0, available)
    if (take > 0) debits.push({ rosterId: s.rosterId, amount: take })
  }
  const collected = debits.reduce((sum, d) => sum + d.amount, 0)
  const each = Math.floor(collected / destinations.length)
  let extra = collected - each * destinations.length
  const credits: FaabTransferPlan['credits'] = []
  for (const rosterId of destinations) {
    const amount = each + (extra > 0 ? 1 : 0)
    if (extra > 0) extra--
    if (amount > 0) credits.push({ rosterId, amount })
  }
  return { debits, credits, collected }
}

/** A steal's FAAB take: the amount asked, capped at what the target has. */
export function stealFaabTake(amount: number, targetBalance: number): number {
  return Math.max(0, Math.min(Math.floor(amount), Math.floor(Number.isFinite(targetBalance) ? targetBalance : 0)))
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d))

/**
 * Rebuild every reward's state from its ledger rows (any order). The `granted` row carries the
 * spec and initial status; later rows move the status and append changes.
 */
export function foldSurvivorRewardLedger(rows: readonly SurvivorRewardLedgerRow[]): Map<string, SurvivorRewardRecord> {
  const out = new Map<string, SurvivorRewardRecord>()
  const ordered = [...rows].sort((a, b) => iso(a.createdAt).localeCompare(iso(b.createdAt)))
  for (const row of ordered) {
    const id = row.relatedEntityId
    if (!id) continue
    const data = rec(row.data)
    if (row.action === SURVIVOR_REWARD_ACTIONS.granted) {
      const spec = data.spec as SurvivorRewardSpec | undefined
      if (!spec || validateSurvivorRewardSpec(spec)) continue
      out.set(id, {
        rewardId: id,
        type: spec.type,
        status: (data.status as SurvivorRewardStatus) ?? 'applied',
        week: typeof data.week === 'number' ? data.week : (row.week ?? 0),
        applyWeek: typeof data.applyWeek === 'number' ? data.applyWeek : (row.week ?? 0),
        spec,
        source: (data.source as SurvivorRewardSource) ?? { kind: 'other' },
        holderRosterIds: rewardHolderRosterIds(spec),
        changes: Array.isArray(data.changes) ? (data.changes as SurvivorRewardChange[]) : [],
        note: typeof data.note === 'string' ? data.note : null,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.createdAt),
      })
      continue
    }
    const current = out.get(id)
    if (!current) continue
    if (typeof data.status === 'string') current.status = data.status as SurvivorRewardStatus
    if (Array.isArray(data.changes)) current.changes = [...current.changes, ...(data.changes as SurvivorRewardChange[])]
    if (data.spec && !validateSurvivorRewardSpec(data.spec)) current.spec = data.spec as SurvivorRewardSpec
    if (typeof data.note === 'string') current.note = data.note
    current.updatedAt = iso(row.createdAt)
  }
  return out
}

/** Statuses that still mean something to the holder (shown by Chimmy and Decision OS). */
export function isOpenRewardStatus(status: SurvivorRewardStatus): boolean {
  return status === 'awaiting_choice' || status === 'deferred' || status === 'available'
}

/**
 * Chimmy's tribemate for "points on a tribemate": the weakest active tribemate by season points
 * (keeps the tribe strong, the same reasoning Chimmy votes with before the merge). Ties break on
 * roster id. Self only when allowed and nobody else is eligible.
 */
export function pickChimmyTribemate(
  candidates: readonly { rosterId: string; seasonPoints: number }[],
  chooserRosterId: string,
  allowSelf = false,
): string | null {
  const others = candidates.filter((c) => c.rosterId !== chooserRosterId)
  const pool = others.length ? others : allowSelf ? candidates.filter((c) => c.rosterId === chooserRosterId) : []
  const sorted = [...pool].sort((a, b) => a.seasonPoints - b.seasonPoints || a.rosterId.localeCompare(b.rosterId))
  return sorted[0]?.rosterId ?? null
}

/**
 * Chimmy's steal target: the richest opponent in what is being stolen (FAAB balance or that week's
 * points). Blockers are private, so Chimmy never knows or uses them. Ties break on roster id.
 */
export function pickChimmyStealTarget(
  candidates: readonly { rosterId: string; faab: number; points: number }[],
  thiefRosterId: string,
  what: 'faab' | 'points',
): string | null {
  const pool = candidates.filter((c) => c.rosterId !== thiefRosterId)
  const value = (c: { faab: number; points: number }) => (what === 'faab' ? c.faab : c.points)
  const sorted = [...pool].sort((a, b) => value(b) - value(a) || a.rosterId.localeCompare(b.rosterId))
  const top = sorted[0]
  return top && value(top) > 0 ? top.rosterId : null
}

type Lang = 'en' | 'es'
const langOf = (language: string | null | undefined): Lang => (String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en')

const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/**
 * One line a manager reads about a reward they hold or won — English or Spanish (League.language).
 * Never names a steal blocker's holder to anyone else; callers only describe a manager's own rewards.
 */
export function describeSurvivorReward(record: Pick<SurvivorRewardRecord, 'spec' | 'status' | 'applyWeek'>, language?: string | null): string {
  const es = langOf(language) === 'es'
  const s = record.spec
  const wk = record.applyWeek
  const statusSuffix = (() => {
    switch (record.status) {
      case 'awaiting_choice': return es ? ' — falta tu elección' : ' — waiting for your choice'
      case 'deferred': return es ? ` — se aplica en la semana ${wk}` : ` — pays out in week ${wk}`
      case 'available': return es ? ' — disponible' : ' — available'
      case 'consumed': return es ? ' — usado' : ' — used'
      case 'blocked': return es ? ' — bloqueado' : ' — blocked'
      case 'reversed': return es ? ' — anulado por el comisionado' : ' — reversed by the commissioner'
      case 'expired': return es ? ' — vencido' : ' — expired'
      default: return ''
    }
  })()
  let line: string
  switch (s.type) {
    case 'score_bonus': line = es ? `+${fmtPts(s.points)} puntos en la semana ${wk}` : `+${fmtPts(s.points)} points in week ${wk}`; break
    case 'score_penalty': line = es ? `−${fmtPts(s.points)} puntos en la semana ${wk}` : `−${fmtPts(s.points)} points in week ${wk}`; break
    case 'faab_grant': line = es ? `$${s.amount} de FAAB` : `$${s.amount} FAAB`; break
    case 'faab_penalty': line = es ? `−$${s.amount} de FAAB` : `−$${s.amount} FAAB`; break
    case 'faab_transfer': line = es ? `FAAB tomado de la otra tribu ($${s.amount}${(s.basis ?? 'per_member') === 'per_member' ? ' por jugador' : ' en total'})` : `FAAB taken from the other tribe ($${s.amount}${(s.basis ?? 'per_member') === 'per_member' ? ' per player' : ' total'})`; break
    case 'tribemate_points': line = es ? `${fmtPts(s.points)} puntos para colocar en un compañero de tribu (semana ${wk})` : `${fmtPts(s.points)} points to place on a tribemate (week ${wk})`; break
    case 'free_trade_token': line = es ? `Un intercambio libre${s.samePositionOnly === false ? '' : ' de la misma posición'} que se salta las reglas de intercambio de Survivor` : `A free${s.samePositionOnly === false ? '' : ' same-position'} trade that skips the Survivor trade rules`; break
    case 'steal_blocker': line = es ? 'Un bloqueador: cancela el próximo robo contra ti' : 'A blocker: cancels the next steal aimed at you'; break
    case 'steal': line = es ? `Robo de ${s.what === 'faab' ? `$${s.amount} de FAAB` : `${fmtPts(s.amount)} puntos`}` : `A steal of ${s.what === 'faab' ? `$${s.amount} FAAB` : `${fmtPts(s.amount)} points`}`; break
    case 'advantage': line = es ? `Ventaja: ${s.powerType.replace(/_/g, ' ')}` : `Advantage: ${s.powerType.replace(/_/g, ' ')}`; break
  }
  return `${line}${statusSuffix}`
}
