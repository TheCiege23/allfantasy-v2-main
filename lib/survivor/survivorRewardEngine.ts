/**
 * Survivor rewards — the DB half. ONE entry point for every feature that pays a prize (the
 * challenge builder, Auction Week, the Survivor Pool, Exile side games, the weekly tribe prizes and
 * the commissioner): `applySurvivorReward`. Re-exported from `SurvivorEffectEngine.ts`.
 *
 * Guarantees, for every reward type in `survivorRewardModel.ts`:
 *  - VALIDATED: the spec and every id are checked; a target that is not an active castaway of this
 *    league is refused (`{ ok: false, code }`), never half-applied.
 *  - IDEMPOTENT: the caller's `idempotencyKey` is the reward id. A second call with the same key
 *    returns `{ ok: true, duplicate: true }` and changes nothing. Every write for one reward runs in
 *    one transaction under a per-league advisory lock, so two runner ticks cannot both pay it.
 *  - AUDITED: an append-only `SurvivorAuditEntry` ledger (category `reward`), commissioner-visible,
 *    never public. Each concrete change (FAAB moved, points added) is recorded on the row.
 *  - REVERSIBLE: `reverseSurvivorReward` undoes the recorded changes (the Commissioner Hub's
 *    `reverse_reward` action). FAAB already spent cannot be clawed below 0; the row records what
 *    was actually taken back.
 *
 * Real effects: points live in `SurvivorWeeklyScore.pointBoostApplied` / `pointPenaltyApplied`, the
 * columns the score sync preserves (`gameStateMachine.syncWeeklyScores`), exactly like the Hub's
 * "adjust score". FAAB moves `RedraftRoster.faabBalance` (what waivers spend) and its
 * `Roster.faabRemaining` mirror, like challenge FAAB (`SurvivorEffectEngine.creditChallengeFaab`).
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  computeFaabTransfer,
  foldSurvivorRewardLedger,
  isThiefThisWeek,
  readThievesCannotStealFromEachOther,
  thievesRuleRefusal,
  rewardApplyWeek,
  rewardNeedsChoice,
  stealFaabTake,
  SURVIVOR_REWARD_ACTIONS,
  SURVIVOR_REWARD_CATEGORY,
  SURVIVOR_REWARD_ENTITY,
  validateApplySurvivorRewardInput,
  validateSurvivorRewardSpec,
  type ApplySurvivorRewardInput,
  type SurvivorRewardChange,
  type SurvivorRewardRecord,
  type SurvivorRewardSpec,
  type SurvivorRewardStatus,
} from './survivorRewardModel'

type Db = Prisma.TransactionClient | PrismaClient

export type SurvivorRewardErrorCode = 'invalid' | 'not_found' | 'conflict' | 'forbidden'

export type ApplySurvivorRewardResult =
  | {
      ok: true
      rewardId: string
      status: SurvivorRewardStatus
      /** True when this key had already been applied; nothing changed this call. */
      duplicate: boolean
      changes: SurvivorRewardChange[]
      note: string | null
    }
  | { ok: false; code: SurvivorRewardErrorCode; error: string }

const fail = (code: SurvivorRewardErrorCode, error: string): ApplySurvivorRewardResult => ({ ok: false, code, error })
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

class RewardRefusal extends Error {
  constructor(readonly code: SurvivorRewardErrorCode, message: string) {
    super(message)
  }
}

/** All writes for one reward: one transaction, one per-league lock. */
async function inRewardLock<T>(leagueId: string, work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-reward:${leagueId}`}, 0))::text`
      return work(db)
    },
    { timeout: 30_000, maxWait: 10_000 },
  )
}

async function loadLedger(db: Db, leagueId: string): Promise<Map<string, SurvivorRewardRecord>> {
  const rows = await db.survivorAuditEntry.findMany({
    where: { leagueId, relatedEntityType: SURVIVOR_REWARD_ENTITY },
    orderBy: { createdAt: 'asc' },
    select: { action: true, relatedEntityId: true, week: true, data: true, createdAt: true },
  })
  return foldSurvivorRewardLedger(rows)
}

async function writeLedgerRow(
  db: Db,
  args: { leagueId: string; rewardId: string; action: string; week: number; actorUserId?: string | null; targetUserId?: string | null; targetTribeId?: string | null; data: Record<string, unknown> },
): Promise<void> {
  await db.survivorAuditEntry.create({
    data: {
      leagueId: args.leagueId,
      week: args.week,
      category: SURVIVOR_REWARD_CATEGORY,
      action: args.action,
      actorUserId: args.actorUserId ?? null,
      targetUserId: args.targetUserId ?? null,
      targetTribeId: args.targetTribeId ?? null,
      relatedEntityId: args.rewardId,
      relatedEntityType: SURVIVOR_REWARD_ENTITY,
      data: args.data as Prisma.InputJsonValue,
      isVisibleToCommissioner: true,
      // Blockers, steals and tokens are private game state; the season-end reveal may show them.
      isVisibleToPublic: false,
      isRevealablePostSeason: true,
    },
  })
}

type Castaway = { rosterId: string; userId: string; tribeId: string | null; playerState: string }

async function castawayForRoster(db: Db, leagueId: string, rosterId: string): Promise<Castaway | null> {
  const row = await db.survivorPlayer.findFirst({
    where: { leagueId, redraftRosterId: rosterId },
    select: { userId: true, tribeId: true, playerState: true, redraftRosterId: true },
  })
  return row?.redraftRosterId ? { rosterId: row.redraftRosterId, userId: row.userId, tribeId: row.tribeId, playerState: row.playerState } : null
}

async function activeTribeRosterIds(db: Db, leagueId: string, tribeId: string): Promise<string[]> {
  const rows = await db.survivorPlayer.findMany({
    where: { leagueId, tribeId, playerState: 'active' },
    select: { redraftRosterId: true },
  })
  return rows.map((r) => r.redraftRosterId).filter((id): id is string => Boolean(id))
}

type FaabTarget = { roster: { id: string; faabRemaining: number | null } | null; redraft: { id: string; faabBalance: number | null } | null }

async function loadFaabTarget(db: Db, leagueId: string, rosterId: string): Promise<FaabTarget> {
  const roster = await db.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, redraftRosterId: true, faabRemaining: true } })
  const redraftId = roster ? roster.redraftRosterId : rosterId
  const redraft = redraftId ? await db.redraftRoster.findFirst({ where: { id: redraftId, leagueId }, select: { id: true, faabBalance: true } }) : null
  return { roster: roster ? { id: roster.id, faabRemaining: roster.faabRemaining } : null, redraft }
}

/** The balance waivers spend, or null when this manager has no FAAB budget at all. */
function faabBalanceOf(t: FaabTarget): number | null {
  if (t.redraft && finite(t.redraft.faabBalance)) return t.redraft.faabBalance
  if (t.roster && finite(t.roster.faabRemaining)) return t.roster.faabRemaining
  return null
}

export async function readSurvivorFaabBalance(db: Db, leagueId: string, rosterId: string): Promise<number | null> {
  return faabBalanceOf(await loadFaabTarget(db, leagueId, rosterId))
}

/**
 * Move a manager's FAAB by `delta`. A credit lands in full; a debit never takes the balance below 0.
 * Returns the delta actually applied (0 when there is no budget to move).
 */
async function adjustFaab(db: Db, leagueId: string, rosterId: string, delta: number): Promise<number> {
  if (!delta) return 0
  const t = await loadFaabTarget(db, leagueId, rosterId)
  const balance = faabBalanceOf(t)
  if (balance == null) return 0
  const applied = delta > 0 ? delta : -Math.min(-delta, Math.max(0, balance))
  if (!applied) return 0
  if (t.redraft && finite(t.redraft.faabBalance)) {
    await db.redraftRoster.update({ where: { id: t.redraft.id }, data: { faabBalance: Math.max(0, t.redraft.faabBalance + applied) } })
  }
  if (t.roster && finite(t.roster.faabRemaining)) {
    await db.roster.update({ where: { id: t.roster.id }, data: { faabRemaining: Math.max(0, Math.round(t.roster.faabRemaining + applied)) } })
  }
  return applied
}

/** Add (or, negative, take away) real points on a castaway's weekly Survivor score. */
async function adjustScore(db: Db, leagueId: string, castaway: Castaway, week: number, points: number): Promise<SurvivorRewardChange> {
  const key = { leagueId_userId_week: { leagueId, userId: castaway.userId, week } }
  const existing = await db.survivorWeeklyScore.findUnique({ where: key })
  const boostAdd = Math.max(0, points)
  const penaltyAdd = Math.max(0, -points)
  const boost = (existing?.pointBoostApplied ?? 0) + boostAdd
  const penalty = (existing?.pointPenaltyApplied ?? 0) + penaltyAdd
  const finalScore = (existing?.fantasyScore ?? 0) + boost - penalty
  await db.survivorWeeklyScore.upsert({
    where: key,
    create: { leagueId, userId: castaway.userId, week, fantasyScore: 0, pointBoostApplied: boost, pointPenaltyApplied: penalty, finalScore, tribeId: castaway.tribeId, correctionApplied: true },
    update: { pointBoostApplied: boost, pointPenaltyApplied: penalty, finalScore, correctionApplied: true },
  })
  return { kind: 'score', rosterId: castaway.rosterId, userId: castaway.userId, week, boost: boostAdd, penalty: penaltyAdd }
}

async function undoScore(db: Db, leagueId: string, change: Extract<SurvivorRewardChange, { kind: 'score' }>): Promise<void> {
  const key = { leagueId_userId_week: { leagueId, userId: change.userId, week: change.week } }
  const existing = await db.survivorWeeklyScore.findUnique({ where: key })
  if (!existing) return
  const boost = Math.max(0, (existing.pointBoostApplied ?? 0) - change.boost)
  const penalty = Math.max(0, (existing.pointPenaltyApplied ?? 0) - change.penalty)
  await db.survivorWeeklyScore.update({ where: key, data: { pointBoostApplied: boost, pointPenaltyApplied: penalty, finalScore: (existing.fantasyScore ?? 0) + boost - penalty } })
}

async function requireActive(db: Db, leagueId: string, rosterId: string, who: string): Promise<Castaway> {
  const c = await castawayForRoster(db, leagueId, rosterId)
  if (!c || c.playerState !== 'active') throw new RewardRefusal('not_found', `${who} is not an active castaway in this league.`)
  return c
}

type Execution = { status: SurvivorRewardStatus; changes: SurvivorRewardChange[]; note: string | null; blockedBy?: string | null; spec?: SurvivorRewardSpec }

/** Carry a reward out now. Throws RewardRefusal for anything that must not be half-applied. */
async function executeReward(
  db: Db,
  leagueId: string,
  rewardId: string,
  spec: SurvivorRewardSpec,
  applyWeek: number,
  ledger: Map<string, SurvivorRewardRecord>,
): Promise<Execution> {
  switch (spec.type) {
    case 'score_bonus':
    case 'score_penalty': {
      const c = await requireActive(db, leagueId, spec.rosterId, 'That manager')
      const change = await adjustScore(db, leagueId, c, applyWeek, spec.type === 'score_bonus' ? spec.points : -spec.points)
      return { status: 'applied', changes: [change], note: null }
    }
    case 'faab_grant': {
      await requireActive(db, leagueId, spec.rosterId, 'That manager')
      const applied = await adjustFaab(db, leagueId, spec.rosterId, spec.amount)
      return { status: 'applied', changes: applied ? [{ kind: 'faab', rosterId: spec.rosterId, delta: applied }] : [], note: applied ? null : 'no_budget_to_credit' }
    }
    case 'faab_penalty': {
      await requireActive(db, leagueId, spec.rosterId, 'That manager')
      // adjustFaab never takes a balance below 0; the change records what was really taken.
      const applied = await adjustFaab(db, leagueId, spec.rosterId, -spec.amount)
      return { status: 'applied', changes: applied ? [{ kind: 'faab', rosterId: spec.rosterId, delta: applied }] : [], note: applied ? null : 'nothing_to_take' }
    }
    case 'faab_transfer': {
      const [from, to] = await Promise.all([activeTribeRosterIds(db, leagueId, spec.fromTribeId), activeTribeRosterIds(db, leagueId, spec.toTribeId)])
      if (!from.length || !to.length) throw new RewardRefusal('not_found', 'Both tribes need active castaways for a FAAB transfer.')
      const sources = await Promise.all(from.map(async (rosterId) => ({ rosterId, balance: (await readSurvivorFaabBalance(db, leagueId, rosterId)) ?? 0 })))
      const plan = computeFaabTransfer({ sources, destinationRosterIds: to, amount: spec.amount, basis: spec.basis })
      const changes: SurvivorRewardChange[] = []
      let collected = 0
      for (const debit of plan.debits) {
        const applied = await adjustFaab(db, leagueId, debit.rosterId, -debit.amount)
        if (applied) changes.push({ kind: 'faab', rosterId: debit.rosterId, delta: applied })
        collected += -applied
      }
      // Re-split what was really collected (identical to the plan unless a balance moved under us).
      const credits = collected === plan.collected ? plan.credits : computeFaabTransfer({ sources: [{ rosterId: '_', balance: collected }], destinationRosterIds: to, amount: collected, basis: 'total' }).credits
      for (const credit of credits) {
        const applied = await adjustFaab(db, leagueId, credit.rosterId, credit.amount)
        if (applied) changes.push({ kind: 'faab', rosterId: credit.rosterId, delta: applied })
      }
      return { status: 'applied', changes, note: collected ? null : 'nothing_to_collect' }
    }
    case 'tribemate_points': {
      const chooser = await requireActive(db, leagueId, spec.chooserRosterId, 'The winner')
      if (!spec.targetRosterId) return { status: 'awaiting_choice', changes: [], note: null }
      const target = await requireActive(db, leagueId, spec.targetRosterId, 'That tribemate')
      if (target.rosterId === chooser.rosterId && spec.allowSelf !== true) throw new RewardRefusal('invalid', 'The points must go on a tribemate, not the winner.')
      // Before the merge "tribemate" means the same tribe; once merged everyone is one tribe.
      if (chooser.tribeId && target.tribeId !== chooser.tribeId) throw new RewardRefusal('invalid', 'Choose someone on your own tribe.')
      const change = await adjustScore(db, leagueId, target, applyWeek, spec.points)
      return { status: 'applied', changes: [change], note: null }
    }
    case 'free_trade_token':
    case 'steal_blocker':
      await requireActive(db, leagueId, spec.rosterId, 'That manager')
      return { status: 'available', changes: [], note: null }
    case 'steal': {
      const thief = await requireActive(db, leagueId, spec.thiefRosterId, 'The thief')
      if (!spec.targetRosterId) return { status: 'awaiting_choice', changes: [], note: null }
      const target = await requireActive(db, leagueId, spec.targetRosterId, 'The target')
      if (target.rosterId === thief.rosterId) throw new RewardRefusal('invalid', 'A manager cannot steal from themselves.')
      // Optional house rule (off by default): thieves cannot steal from each other that week.
      const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } })
      if (readThievesCannotStealFromEachOther(league?.settings) && isThiefThisWeek(ledger.values(), target.rosterId, applyWeek, rewardId)) {
        throw new RewardRefusal('conflict', thievesRuleRefusal(league?.language))
      }
      const blocker =[...ledger.values()]
        .filter((r) => r.type === 'steal_blocker' && r.status === 'available' && r.holderRosterIds.includes(target.rosterId) && r.rewardId !== rewardId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (blocker) {
        await writeLedgerRow(db, {
          leagueId, rewardId: blocker.rewardId, action: SURVIVOR_REWARD_ACTIONS.consumed, week: applyWeek,
          data: { status: 'consumed', note: `blocked_steal:${rewardId}` },
        })
        blocker.status = 'consumed'
        return { status: 'blocked', changes: [], note: 'blocked_by_blocker', blockedBy: blocker.rewardId }
      }
      const changes: SurvivorRewardChange[] = []
      if (spec.what === 'faab') {
        const take = stealFaabTake(spec.amount, (await readSurvivorFaabBalance(db, leagueId, target.rosterId)) ?? 0)
        const taken = take ? -(await adjustFaab(db, leagueId, target.rosterId, -take)) : 0
        if (taken) {
          changes.push({ kind: 'faab', rosterId: target.rosterId, delta: -taken })
          const given = await adjustFaab(db, leagueId, thief.rosterId, taken)
          if (given) changes.push({ kind: 'faab', rosterId: thief.rosterId, delta: given })
        }
        return { status: 'applied', changes, note: taken ? null : 'nothing_to_steal' }
      }
      changes.push(await adjustScore(db, leagueId, target, applyWeek, -spec.amount))
      changes.push(await adjustScore(db, leagueId, thief, applyWeek, spec.amount))
      return { status: 'applied', changes, note: null }
    }
    case 'advantage': {
      await requireActive(db, leagueId, spec.rosterId, 'That manager')
      const config = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
      if (!config) throw new RewardRefusal('not_found', 'This league has no Survivor configuration yet.')
      const idol = await db.survivorIdol.create({
        data: { leagueId, configId: config.id, rosterId: spec.rosterId, playerId: `reward-advantage:${rewardId}`, powerType: spec.powerType, status: 'revealed' },
      })
      await db.survivorIdolLedgerEntry.create({
        data: { leagueId, idolId: idol.id, eventType: 'assigned', toRosterId: spec.rosterId, metadata: { source: 'survivor_reward', rewardId, powerType: spec.powerType } },
      })
      return { status: 'applied', changes: [{ kind: 'advantage', rosterId: spec.rosterId, idolId: idol.id, powerType: spec.powerType }], note: null }
    }
    case 'opponent_penalty': {
      const chooser = await requireActive(db, leagueId, spec.chooserRosterId, 'The winner')
      if (!spec.targetRosterId) return { status: 'awaiting_choice', changes: [], note: null }
      const target = await requireActive(db, leagueId, spec.targetRosterId, 'That opponent')
      if (target.rosterId === chooser.rosterId) throw new RewardRefusal('invalid', 'Choose an opponent, not yourself.')
      const change = await adjustScore(db, leagueId, target, applyWeek, -spec.points)
      return { status: 'applied', changes: [change], note: null }
    }
    case 'vote_taken': {
      const chooser = await requireActive(db, leagueId, spec.chooserRosterId, 'The winner')
      if (!spec.targetRosterId) return { status: 'awaiting_choice', changes: [], note: null }
      const target = await requireActive(db, leagueId, spec.targetRosterId, 'That opponent')
      if (target.rosterId === chooser.rosterId) throw new RewardRefusal('invalid', 'Choose an opponent, not yourself.')
      // Held until the target's next Tribal Council opens; the season runner places it there.
      return { status: 'available', changes: [], note: 'vote_taken_pending' }
    }
    case 'forced_bench': {
      const chooser = await requireActive(db, leagueId, spec.chooserRosterId, 'The winner')
      if (!spec.targetRosterId) return { status: 'awaiting_choice', changes: [], note: null }
      const target = await requireActive(db, leagueId, spec.targetRosterId, 'That opponent')
      if (target.rosterId === chooser.rosterId) throw new RewardRefusal('invalid', 'Choose an opponent, not yourself.')
      const { firstStarterId, lineupIds } = await import('./survivorForcedBench')
      const roster = await db.roster.findFirst({ where: { id: target.rosterId, leagueId }, select: { playerData: true } })
      const playerId = spec.playerId ?? firstStarterId(roster?.playerData)
      if (!playerId) throw new RewardRefusal('not_found', 'That opponent has no starter to bench.')
      if (spec.playerId && !lineupIds(roster?.playerData).includes(spec.playerId)) throw new RewardRefusal('invalid', 'That player is not on the opponent’s roster.')
      // The resolved player is written back onto the spec, so every check reads one fact.
      return { status: 'applied', changes: [], note: `forced_bench:${playerId}:week:${applyWeek}`, spec: { ...spec, playerId } }
    }
  }
}

/** The taken-vote record on a council's `idolsPlayed` (read by the tally as a stolen vote). */
export function voteTakenPlayId(rewardId: string): string {
  return `reward-vote-taken:${rewardId}`
}

/**
 * Place every held `vote_taken` disadvantage on the first Tribal Council its target votes at: an
 * open council (`voting_open`) whose attending tribe is the target's (or every tribe, after the
 * merge). The record reuses the vote-steal shape the tally already reads — the target's ballot is
 * read as taken — with no extra ballot. Idempotent: the play id is the reward id, and the reward is
 * consumed in the same transaction. A target who has left the island lets the disadvantage lapse.
 * Run by the season runner each tick. Returns the reward ids placed.
 */
export async function applyPendingVoteTakenRewards(leagueId: string): Promise<string[]> {
  const pending = [...(await loadLedger(prisma, leagueId)).values()].filter((r) => r.spec.type === 'vote_taken' && r.status === 'available')
  if (!pending.length) return []
  const placed: string[] = []
  for (const candidate of pending) {
    const done = await inRewardLock(leagueId, async (db) => {
      const record = (await loadLedger(db, leagueId)).get(candidate.rewardId)
      if (!record || record.status !== 'available' || record.spec.type !== 'vote_taken' || !record.spec.targetRosterId) return false
      const [chooser, target] = await Promise.all([castawayForRoster(db, leagueId, record.spec.chooserRosterId), castawayForRoster(db, leagueId, record.spec.targetRosterId)])
      if (!target || target.playerState !== 'active') {
        await writeLedgerRow(db, { leagueId, rewardId: record.rewardId, action: SURVIVOR_REWARD_ACTIONS.consumed, week: record.applyWeek, data: { status: 'expired', note: 'target_left_the_island' } })
        return true
      }
      const council = await db.survivorTribalCouncil.findFirst({
        where: { leagueId, status: 'voting_open', week: { gte: record.week }, OR: [{ attendingTribeId: null }, ...(target.tribeId ? [{ attendingTribeId: target.tribeId }] : [])] },
        orderBy: [{ week: 'asc' }, { councilNumber: 'asc' }],
        select: { id: true, week: true, idolsPlayed: true },
      })
      if (!council) return false
      const plays = Array.isArray(council.idolsPlayed) ? (council.idolsPlayed as unknown[]) : []
      const playId = voteTakenPlayId(record.rewardId)
      const already = plays.some((p) => p && typeof p === 'object' && (p as Record<string, unknown>).idolId === playId)
      if (!already) {
        const play = {
          idolId: playId, powerType: 'vote_steal', source: 'survivor_reward_vote_taken',
          playerUserId: chooser?.userId ?? 'survivor-reward', playerRosterId: record.spec.chooserRosterId,
          stolenVoterUserId: target.userId, stolenVoterRosterId: target.rosterId, playedAt: new Date().toISOString(),
        }
        await db.survivorTribalCouncil.update({ where: { id: council.id }, data: { idolsPlayed: [...plays, play] as Prisma.InputJsonValue } })
      }
      await writeLedgerRow(db, {
        leagueId, rewardId: record.rewardId, action: SURVIVOR_REWARD_ACTIONS.consumed, week: council.week,
        data: { status: 'consumed', note: `council:${council.id}`, changes: [{ kind: 'council_vote', rosterId: target.rosterId, councilId: council.id, playId }] },
      })
      return true
    }).catch((error) => {
      console.warn('[survivor] vote_taken placement failed', candidate.rewardId, error instanceof Error ? error.message : error)
      return false
    })
    if (done) placed.push(candidate.rewardId)
  }
  return placed
}

function targetTribeOf(spec: SurvivorRewardSpec): string | null {
  return spec.type === 'faab_transfer' ? spec.toTribeId : null
}

/**
 * THE reward API. Validate, then (once per `idempotencyKey`) apply a Survivor reward and record it.
 *
 * Statuses returned: `applied` (done), `awaiting_choice` (tribemate points / steal with no target —
 * call `chooseSurvivorRewardTarget`), `deferred` (`deferToWeek` set — the season runner applies it
 * when that week is current), `available` (a free trade token or steal blocker, held until used),
 * `blocked` (a steal its target's blocker cancelled; the blocker is consumed).
 *
 * Never throws for a bad reward: it returns `{ ok: false, code, error }` with `code` `invalid`
 * (bad input), `not_found` (no such active castaway / tribe) or `conflict`.
 */
export async function applySurvivorReward(input: ApplySurvivorRewardInput): Promise<ApplySurvivorRewardResult> {
  const invalid = validateApplySurvivorRewardInput(input)
  if (invalid) return fail('invalid', invalid)
  const rewardId = input.idempotencyKey.trim()
  const applyWeek = rewardApplyWeek(input)
  try {
    return await inRewardLock(input.leagueId, async (db) => {
      const ledger = await loadLedger(db, input.leagueId)
      const existing = ledger.get(rewardId)
      if (existing) return { ok: true as const, rewardId, status: existing.status, duplicate: true, changes: existing.changes, note: existing.note }
      const execution: Execution = input.deferToWeek != null
        ? { status: 'deferred', changes: [], note: null }
        : await executeReward(db, input.leagueId, rewardId, input.reward, applyWeek, ledger)
      await writeLedgerRow(db, {
        leagueId: input.leagueId,
        rewardId,
        action: SURVIVOR_REWARD_ACTIONS.granted,
        week: input.week,
        actorUserId: input.actorUserId ?? null,
        targetTribeId: targetTribeOf(input.reward),
        data: {
          spec: execution.spec ?? input.reward,
          status: execution.status,
          week: input.week,
          applyWeek,
          deferToWeek: input.deferToWeek ?? null,
          source: input.source,
          changes: execution.changes,
          note: execution.note,
          blockedBy: execution.blockedBy ?? null,
        },
      })
      return { ok: true as const, rewardId, status: execution.status, duplicate: false, changes: execution.changes, note: execution.note }
    })
  } catch (error) {
    if (error instanceof RewardRefusal) return fail(error.code, error.message)
    throw error
  }
}

/**
 * The holder's choice for a reward `awaiting_choice`: the tribemate who gets the points, or the
 * steal's target. Only the holder (or the commissioner, `asCommissioner`) may choose, once.
 */
export async function chooseSurvivorRewardTarget(args: {
  leagueId: string
  rewardId: string
  /** The roster choosing. Must hold the reward unless `asCommissioner`. */
  actorRosterId: string | null
  targetRosterId: string
  /** forced_bench only: the opponent's player who sits (default: their first starter). */
  targetPlayerId?: string | null
  actorUserId?: string | null
  asCommissioner?: boolean
  /** Recorded on the row ("chimmy" when Chimmy chose for a seat it runs). */
  chosenBy?: 'manager' | 'commissioner' | 'chimmy'
}): Promise<ApplySurvivorRewardResult> {
  if (!args.leagueId || !args.rewardId || !args.targetRosterId) return fail('invalid', 'leagueId, rewardId and targetRosterId are required.')
  try {
    return await inRewardLock(args.leagueId, async (db) => {
      const ledger = await loadLedger(db, args.leagueId)
      const record = ledger.get(args.rewardId)
      if (!record) throw new RewardRefusal('not_found', 'No such reward.')
      if (record.status !== 'awaiting_choice') throw new RewardRefusal('conflict', 'This reward is not waiting for a choice.')
      if (!args.asCommissioner && (!args.actorRosterId || !record.holderRosterIds.includes(args.actorRosterId))) throw new RewardRefusal('forbidden', 'Only the winner can make this choice.')
      if (!rewardNeedsChoice({ ...record.spec, targetRosterId: null } as SurvivorRewardSpec)) throw new RewardRefusal('conflict', 'This reward has no choice to make.')
      const spec = {
        ...record.spec,
        targetRosterId: args.targetRosterId,
        // A forced bench may also name WHICH of the opponent's players sits.
        ...(record.spec.type === 'forced_bench' && args.targetPlayerId ? { playerId: args.targetPlayerId } : {}),
      } as SurvivorRewardSpec
      const specError = validateSurvivorRewardSpec(spec)
      if (specError) throw new RewardRefusal('invalid', specError)
      const execution = await executeReward(db, args.leagueId, args.rewardId, spec, record.applyWeek, ledger)
      await writeLedgerRow(db, {
        leagueId: args.leagueId, rewardId: args.rewardId, action: SURVIVOR_REWARD_ACTIONS.choice, week: record.applyWeek, actorUserId: args.actorUserId ?? null,
        data: { spec: execution.spec ?? spec, status: execution.status, changes: execution.changes, note: execution.note, chosenBy: args.chosenBy ?? (args.asCommissioner ? 'commissioner' : 'manager'), blockedBy: execution.blockedBy ?? null },
      })
      return { ok: true as const, rewardId: args.rewardId, status: execution.status, duplicate: false, changes: execution.changes, note: execution.note }
    })
  } catch (error) {
    if (error instanceof RewardRefusal) return fail(error.code, error.message)
    throw error
  }
}

/**
 * Apply every deferred reward whose week has come. Called by the season runner each tick;
 * idempotent (an applied reward is no longer `deferred`). Returns the reward ids applied.
 */
export async function applyDueDeferredSurvivorRewards(leagueId: string, currentWeek: number): Promise<string[]> {
  const due = [...(await loadLedger(prisma, leagueId)).values()].filter((r) => r.status === 'deferred' && r.applyWeek <= currentWeek)
  const applied: string[] = []
  for (const candidate of due) {
    const done = await inRewardLock(leagueId, async (db) => {
      const ledger = await loadLedger(db, leagueId)
      const record = ledger.get(candidate.rewardId)
      if (!record || record.status !== 'deferred') return false
      let execution: Execution
      try {
        execution = await executeReward(db, leagueId, record.rewardId, record.spec, record.applyWeek, ledger)
      } catch (error) {
        if (!(error instanceof RewardRefusal)) throw error
        // The winner left the game before the reward landed: it lapses, on the record.
        execution = { status: 'expired', changes: [], note: error.message }
      }
      await writeLedgerRow(db, {
        leagueId, rewardId: record.rewardId, action: SURVIVOR_REWARD_ACTIONS.deferredApplied, week: record.applyWeek,
        data: { status: execution.status, changes: execution.changes, note: execution.note, blockedBy: execution.blockedBy ?? null, ...(execution.spec ? { spec: execution.spec } : {}) },
      })
      return true
    }).catch((error) => {
      console.warn('[survivor] deferred reward failed', candidate.rewardId, error instanceof Error ? error.message : error)
      return false
    })
    if (done) applied.push(candidate.rewardId)
  }
  return applied
}

/** Every reward in the league (commissioner view), or only one manager's own (`rosterId`). */
export async function listSurvivorRewards(leagueId: string, opts: { rosterId?: string | null } = {}): Promise<SurvivorRewardRecord[]> {
  const all = [...(await loadLedger(prisma, leagueId)).values()]
  // A manager's own: what they hold, plus what landed on them as a gift (a tribe FAAB share, points
  // a tribemate placed). Never a steal against them, which names nobody's secret but is not theirs.
  const received = (c: SurvivorRewardChange, rosterId: string) =>
    c.rosterId === rosterId && ((c.kind === 'faab' && c.delta > 0) || (c.kind === 'score' && c.boost > 0))
  const mine = opts.rosterId
    ? all.filter((r) => r.holderRosterIds.includes(opts.rosterId!) || (r.type !== 'steal' && r.changes.some((c) => received(c, opts.rosterId!))))
    : all
  return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** The manager's unused free trade tokens for `week` (oldest first). For the Survivor trade rules. */
export async function getSurvivorTradeTokens(leagueId: string, rosterId: string, week: number): Promise<SurvivorRewardRecord[]> {
  return (await listSurvivorRewards(leagueId, { rosterId }))
    .filter((r) => r.spec.type === 'free_trade_token' && r.status === 'available' && r.holderRosterIds.includes(rosterId))
    .filter((r) => r.spec.type !== 'free_trade_token' || r.spec.expiresAfterWeek == null || r.spec.expiresAfterWeek >= week)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Spend one free trade token on a trade (`tradeRef` = the trade id). The caller — the Survivor trade
 * rules — decides whether the trade qualifies (`samePositionOnly`) BEFORE redeeming. Idempotent per
 * `tradeRef`: redeeming the same trade twice spends one token.
 */
export async function redeemSurvivorTradeToken(args: { leagueId: string; rosterId: string; tradeRef: string; week: number; actorUserId?: string | null }): Promise<ApplySurvivorRewardResult> {
  if (!args.leagueId || !args.rosterId || !args.tradeRef) return fail('invalid', 'leagueId, rosterId and tradeRef are required.')
  try {
    return await inRewardLock(args.leagueId, async (db) => {
      const ledger = [...(await loadLedger(db, args.leagueId)).values()]
      const already = ledger.find((r) => r.type === 'free_trade_token' && r.status === 'consumed' && r.note === `trade:${args.tradeRef}`)
      if (already) return { ok: true as const, rewardId: already.rewardId, status: already.status, duplicate: true, changes: [], note: already.note }
      const token = ledger
        .filter((r) => r.spec.type === 'free_trade_token' && r.status === 'available' && r.holderRosterIds.includes(args.rosterId))
        .filter((r) => r.spec.type !== 'free_trade_token' || r.spec.expiresAfterWeek == null || r.spec.expiresAfterWeek >= args.week)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (!token) throw new RewardRefusal('not_found', 'You have no free trade to use.')
      const note = `trade:${args.tradeRef}`
      await writeLedgerRow(db, { leagueId: args.leagueId, rewardId: token.rewardId, action: SURVIVOR_REWARD_ACTIONS.consumed, week: args.week, actorUserId: args.actorUserId ?? null, data: { status: 'consumed', note } })
      return { ok: true as const, rewardId: token.rewardId, status: 'consumed' as const, duplicate: false, changes: [], note }
    })
  } catch (error) {
    if (error instanceof RewardRefusal) return fail(error.code, error.message)
    throw error
  }
}

/**
 * The commissioner's undo for a reward: every recorded change is taken back (points removed, FAAB
 * returned — never below 0 — and an awarded advantage expired), and a token or deferred reward is
 * cancelled. Reversing a steal that a blocker stopped hands the blocker back. Idempotent.
 */
export async function reverseSurvivorReward(args: { leagueId: string; rewardId: string; actorUserId: string; reason?: string | null }): Promise<ApplySurvivorRewardResult> {
  if (!args.leagueId || !args.rewardId) return fail('invalid', 'leagueId and rewardId are required.')
  try {
    return await inRewardLock(args.leagueId, async (db) => {
      const ledger = await loadLedger(db, args.leagueId)
      const record = ledger.get(args.rewardId)
      if (!record) throw new RewardRefusal('not_found', 'No such reward.')
      if (record.status === 'reversed') return { ok: true as const, rewardId: record.rewardId, status: record.status, duplicate: true, changes: [], note: record.note }
      const undone: SurvivorRewardChange[] = []
      for (const change of [...record.changes].reverse()) {
        if (change.kind === 'faab') {
          const applied = await adjustFaab(db, args.leagueId, change.rosterId, -change.delta)
          if (applied) undone.push({ kind: 'faab', rosterId: change.rosterId, delta: applied })
        } else if (change.kind === 'score') {
          await undoScore(db, args.leagueId, change)
          undone.push({ ...change, boost: -change.boost, penalty: -change.penalty })
        } else if (change.kind === 'council_vote') {
          // A taken vote comes off a council that has not closed yet; a closed council's read stands.
          const council = await db.survivorTribalCouncil.findFirst({ where: { id: change.councilId, leagueId: args.leagueId, closedAt: null }, select: { id: true, idolsPlayed: true } })
          if (council && Array.isArray(council.idolsPlayed)) {
            const kept = (council.idolsPlayed as unknown[]).filter((p) => !(p && typeof p === 'object' && (p as Record<string, unknown>).idolId === change.playId))
            await db.survivorTribalCouncil.update({ where: { id: council.id }, data: { idolsPlayed: kept as Prisma.InputJsonValue } })
            undone.push(change)
          }
        } else {
          await db.survivorIdol.updateMany({ where: { id: change.idolId, leagueId: args.leagueId, status: 'revealed' }, data: { status: 'expired' } })
          undone.push(change)
        }
      }
      // A steal its target's blocker stopped consumed that blocker; undoing the steal returns it.
      const blockedRow = record.status === 'blocked'
        ? [...ledger.values()].find((r) => r.type === 'steal_blocker' && r.status === 'consumed' && r.note === `blocked_steal:${record.rewardId}`)
        : null
      if (blockedRow) {
        await writeLedgerRow(db, { leagueId: args.leagueId, rewardId: blockedRow.rewardId, action: SURVIVOR_REWARD_ACTIONS.reversed, week: record.applyWeek, actorUserId: args.actorUserId, data: { status: 'available', note: `restored_after_reverse:${record.rewardId}` } })
      }
      await writeLedgerRow(db, {
        leagueId: args.leagueId, rewardId: record.rewardId, action: SURVIVOR_REWARD_ACTIONS.reversed, week: record.applyWeek, actorUserId: args.actorUserId,
        data: { status: 'reversed', previousStatus: record.status, undone, note: args.reason?.slice(0, 300) || 'reversed_by_commissioner' },
      })
      return { ok: true as const, rewardId: record.rewardId, status: 'reversed' as const, duplicate: false, changes: undone, note: args.reason ?? null }
    })
  } catch (error) {
    if (error instanceof RewardRefusal) return fail(error.code, error.message)
    throw error
  }
}

export { rewardNeedsChoice }
