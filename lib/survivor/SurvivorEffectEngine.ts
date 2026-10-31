import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { getMinigameDef } from './SurvivorMiniGameRegistry'
import { resolveSurvivorCurrentWeek } from './SurvivorTimelineResolver'
import { getTribeForRoster } from './SurvivorTribeService'
import { runShuffle } from './SurvivorTribeShuffleEngine'
import { stealPlayerForSurvivor, swapStarterForSurvivor } from './SurvivorRosterMutationEngine'
import type { SurvivorChallengeType } from './types'
import { applySurvivorReward } from './survivorRewardEngine'
import { SURVIVOR_REWARD_TYPES, type SurvivorRewardSpec } from './survivorRewardModel'

/**
 * THE Survivor reward API (survivorRewardEngine.ts): every feature that pays a prize — challenge
 * builder, Auction Week, Survivor Pool, Exile side games, weekly tribe prizes, the commissioner —
 * calls `applySurvivorReward`. See survivorRewardModel.ts for the reward types and their rules.
 */
export {
  applySurvivorReward,
  applyDueDeferredSurvivorRewards,
  chooseSurvivorRewardTarget,
  getSurvivorTradeTokens,
  listSurvivorRewards,
  redeemSurvivorTradeToken,
  reverseSurvivorReward,
  type ApplySurvivorRewardResult,
} from './survivorRewardEngine'
export type { ApplySurvivorRewardInput, SurvivorRewardRecord, SurvivorRewardSpec, SurvivorRewardStatus, SurvivorRewardType } from './survivorRewardModel'

const EFFECT_EVENT_TYPES = ['challenge_reward_awarded', 'idol_effect_applied'] as const

export interface SurvivorAppliedEffect {
  rewardType: string
  week: number
  rosterId?: string | null
  tribeId?: string | null
  amount?: number | null
  idolId?: string | null
  powerType?: string | null
  appliedMode?: 'full' | 'record_only'
}

export interface SurvivorWeeklyEffectState {
  protectedRosterIds: Set<string>
  immuneTribeIds: Set<string>
  frozenWaiverRosterIds: Set<string>
  scoreBoostByRoster: Map<string, number>
}

export interface SurvivorIdolEffectResult {
  rewardType: string
  week: number
  rosterId?: string | null
  tribeId?: string | null
  amount?: number | null
  appliedMode?: 'full' | 'record_only' | 'queued'
  playerId?: string | null
  secondaryPlayerId?: string | null
}

export interface SurvivorActiveEffectSummary {
  rewardType: string
  week: number
  appliedMode: 'full' | 'record_only' | 'queued'
  rosterId?: string | null
  tribeId?: string | null
  sourceRosterId?: string | null
}

interface SurvivorEffectMetadata {
  week: number
  rewardType: string
  rosterId?: string | null
  tribeId?: string | null
  amount?: number | null
}

interface SurvivorResolvedRewardInput {
  rewardType: string
  rosterId?: string | null
  tribeId?: string | null
  amount?: number | null
  powerType?: string | null
  /** The reward's own JSON (for the newer reward types, which carry more than an amount). */
  raw?: Prisma.JsonObject | null
}

function asJsonObject(value: unknown): Prisma.JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Prisma.JsonObject
}

function readString(obj: Prisma.JsonObject | null, key: string): string | null {
  if (!obj) return null
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(obj: Prisma.JsonObject | null, key: string): number | null {
  if (!obj) return null
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function appendEffectAudit(
  leagueId: string,
  eventType: typeof EFFECT_EVENT_TYPES[number],
  metadata: Record<string, unknown>
): Promise<void> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return
  await appendSurvivorAudit(leagueId, config.configId, eventType as any, metadata)
}

async function getTribeMemberRosterIds(tribeId: string): Promise<string[]> {
  const members = await prisma.survivorTribeMember.findMany({
    where: { tribeId },
    select: { rosterId: true },
  })
  return members.map((member) => member.rosterId)
}

function normalizeChallengeRewards(
  challenge: {
    id: string
    week: number
    challengeType: string
    configJson: Prisma.JsonValue | null
    /** The row's own reward columns (challengeEngine writes these, not configJson). */
    rewardType?: string | null
    rewardAmount?: number | null
  },
  resultJson: Record<string, unknown>
): SurvivorResolvedRewardInput[] {
  const config = asJsonObject(challenge.configJson)
  const definition = getMinigameDef(challenge.challengeType as SurvivorChallengeType)
  const rowRewardType = typeof challenge.rewardType === 'string' && challenge.rewardType.trim() ? challenge.rewardType.trim() : null
  const rowAmount = typeof challenge.rewardAmount === 'number' && Number.isFinite(challenge.rewardAmount) ? challenge.rewardAmount : null
  const fallbackRewardType =
    readString(config, 'rewardType') ??
    rowRewardType ??
    (definition?.rewardTypes.length === 1 ? definition.rewardTypes[0] : definition?.rewardTypes[0] ?? null)

  const winnerRosterId = typeof resultJson.winnerRosterId === 'string' ? resultJson.winnerRosterId.trim() : ''
  const winnerTribeId = typeof resultJson.winnerTribeId === 'string' ? resultJson.winnerTribeId.trim() : ''
  const rewards = Array.isArray(resultJson.rewards) ? resultJson.rewards : []

  if (rewards.length === 0 && fallbackRewardType && (winnerRosterId || winnerTribeId)) {
    return [
      {
        rewardType: fallbackRewardType,
        rosterId: winnerRosterId || null,
        tribeId: winnerTribeId || null,
        amount: readNumber(config, 'rewardAmount') ?? readNumber(config, 'scoreBoost') ?? rowAmount,
        powerType: readString(config, 'powerType'),
      },
    ]
  }

  const normalizedRewards: Array<SurvivorResolvedRewardInput | null> = rewards
    .map((reward) => {
      if (typeof reward === 'string' && reward.trim()) {
        return {
          rewardType: reward.trim(),
          rosterId: winnerRosterId || null,
          tribeId: winnerTribeId || null,
          amount: readNumber(config, 'rewardAmount') ?? readNumber(config, 'scoreBoost') ?? rowAmount,
          powerType: readString(config, 'powerType'),
        }
      }
      const rewardJson = asJsonObject(reward)
      const rewardType =
        readString(rewardJson, 'rewardType') ??
        readString(rewardJson, 'type') ??
        fallbackRewardType
      if (!rewardType) return null
      return {
        rewardType,
        rosterId: readString(rewardJson, 'rosterId') ?? (winnerRosterId || null),
        tribeId: readString(rewardJson, 'tribeId') ?? (winnerTribeId || null),
        amount:
          readNumber(rewardJson, 'amount') ??
          readNumber(rewardJson, 'scoreBoost') ??
          readNumber(config, 'rewardAmount') ??
          readNumber(config, 'scoreBoost') ??
          rowAmount,
        powerType: readString(rewardJson, 'powerType') ?? readString(config, 'powerType'),
        raw: rewardJson,
      }
    })
  return normalizedRewards.filter((reward): reward is SurvivorResolvedRewardInput => Boolean(reward?.rewardType))
}

async function resolveRewardRosterTargets(reward: SurvivorResolvedRewardInput): Promise<string[]> {
  if (reward.rosterId) return [reward.rosterId]
  if (reward.tribeId) return getTribeMemberRosterIds(reward.tribeId)
  return []
}

/** Reward types a challenge result may name that only the reward engine (applySurvivorReward) pays. */
const CHALLENGE_ENGINE_REWARD_TYPES = new Set<string>(SURVIVOR_REWARD_TYPES.filter((type) => type !== 'advantage'))
/** Older challenge reward names that still apply here, mapped onto the reward engine when deferred. */
const LEGACY_DEFERRABLE: Record<string, 'faab_grant' | 'score_bonus' | 'advantage' | undefined> = {
  faab: 'faab_grant',
  score_boost: 'score_bonus',
  advantage: 'advantage',
}

/** `deferToWeek: N`, or `deferred: true` (= next week), on a challenge reward. */
function challengeDeferWeek(raw: Prisma.JsonObject | null, week: number): number | null {
  const explicit = readNumber(raw, 'deferToWeek')
  if (explicit != null && Number.isInteger(explicit) && explicit > week) return explicit
  return raw?.deferred === true ? week + 1 : null
}

function challengeRewardSpec(reward: SurvivorResolvedRewardInput, rosterId: string | null): SurvivorRewardSpec | null {
  const raw = reward.raw ?? null
  const amount = reward.amount ?? 0
  const type = LEGACY_DEFERRABLE[reward.rewardType] ?? reward.rewardType
  const targetRosterId = readString(raw, 'targetRosterId')
  switch (type) {
    case 'score_bonus':
    case 'score_penalty':
      return rosterId ? { type, rosterId, points: amount } : null
    case 'faab_grant':
      return rosterId ? { type, rosterId, amount } : null
    case 'faab_transfer': {
      const fromTribeId = readString(raw, 'fromTribeId')
      const toTribeId = reward.tribeId ?? readString(raw, 'toTribeId')
      const basis = readString(raw, 'basis') === 'total' ? 'total' : 'per_member'
      return fromTribeId && toTribeId ? { type, fromTribeId, toTribeId, amount, basis } : null
    }
    case 'tribemate_points':
      return rosterId ? { type, chooserRosterId: rosterId, points: amount, targetRosterId } : null
    case 'free_trade_token':
      return rosterId ? { type, rosterId, samePositionOnly: raw?.samePositionOnly !== false } : null
    case 'steal_blocker':
      return rosterId ? { type, rosterId } : null
    case 'steal':
      return rosterId ? { type, thiefRosterId: rosterId, what: readString(raw, 'what') === 'points' ? 'points' : 'faab', amount, targetRosterId } : null
    case 'advantage': {
      const powerType = reward.powerType ?? 'extra_vote'
      return rosterId && (powerType === 'extra_vote' || powerType === 'vote_shield' || powerType === 'vote_steal') ? { type, rosterId, powerType } : null
    }
    default:
      return null
  }
}

type FaabCredit = { credited: boolean; detail: Record<string, unknown> }

/**
 * A FAAB reward is real budget. Waiver claims spend `RedraftRoster.faabBalance`
 * (lib/redraft/waiverEngine.ts), reached from the Survivor roster through `Roster.redraftRosterId`;
 * `Roster.faabRemaining` is the older mirror some readers still show, so both move together when
 * both exist. A reward id that is already a RedraftRoster id is credited directly. When there is
 * nothing to credit (no roster, no amount, no balance) the reward is recorded, never invented.
 */
async function creditChallengeFaab(leagueId: string, rosterId: string, amount: number | null): Promise<FaabCredit> {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return { credited: false, detail: { faabReason: 'no_amount' } }
  const detail: Record<string, unknown> = {}
  let credited = false
  const creditRedraft = async (redraftRosterId: string) => {
    const redraft = await prisma.redraftRoster.findFirst({ where: { id: redraftRosterId, leagueId }, select: { id: true, faabBalance: true } })
    if (!redraft || typeof redraft.faabBalance !== 'number' || !Number.isFinite(redraft.faabBalance)) return
    const next = redraft.faabBalance + amount
    await prisma.redraftRoster.update({ where: { id: redraft.id }, data: { faabBalance: next } })
    detail.redraftRosterId = redraft.id
    detail.faabBalanceBefore = redraft.faabBalance
    detail.faabBalanceAfter = next
    credited = true
  }
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, redraftRosterId: true, faabRemaining: true } })
  if (roster) {
    if (roster.redraftRosterId) await creditRedraft(roster.redraftRosterId)
    if (typeof roster.faabRemaining === 'number' && Number.isFinite(roster.faabRemaining)) {
      const next = roster.faabRemaining + Math.round(amount)
      await prisma.roster.update({ where: { id: roster.id }, data: { faabRemaining: next } })
      detail.faabRemainingBefore = roster.faabRemaining
      detail.faabRemainingAfter = next
      credited = true
    }
  } else {
    await creditRedraft(rosterId)
    if (!credited) detail.faabReason = 'roster_not_found'
  }
  if (!credited && !detail.faabReason) detail.faabReason = 'no_budget_to_credit'
  return { credited, detail }
}

/**
 * Individual immunity won in a challenge: the flag the canonical council reads
 * (survivorCouncilService.loadScopePlayers) to keep the manager off that week's ballot. Cleared
 * at the week flip with every other non-necklace source.
 */
async function grantChallengeImmunity(leagueId: string, rosterId: string): Promise<boolean> {
  const result = await prisma.survivorPlayer.updateMany({
    where: { leagueId, redraftRosterId: rosterId, playerState: 'active' },
    data: { hasImmunityThisWeek: true, immunitySource: 'challenge_win' },
  })
  return result.count > 0
}

export async function applyChallengeRewards(
  challengeId: string,
  resultJson: Record<string, unknown>
): Promise<SurvivorAppliedEffect[]> {
  const challenge = await prisma.survivorChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      leagueId: true,
      week: true,
      challengeType: true,
      configJson: true,
      rewardType: true,
      rewardAmount: true,
    },
  })
  if (!challenge) return []

  const rewards = normalizeChallengeRewards(challenge, resultJson)
  if (rewards.length === 0) return []
  const config = await getSurvivorConfig(challenge.leagueId)
  if (!config) return []

  const applied: SurvivorAppliedEffect[] = []
  for (let index = 0; index < rewards.length; index++) {
    const reward = rewards[index]
    // The newer reward types (and any reward marked deferred) go through the one reward API.
    const deferToWeek = challengeDeferWeek(reward.raw ?? null, challenge.week)
    if (CHALLENGE_ENGINE_REWARD_TYPES.has(reward.rewardType) || (deferToWeek != null && LEGACY_DEFERRABLE[reward.rewardType])) {
      const targets: Array<string | null> = reward.rewardType === 'faab_transfer' ? [null] : await resolveRewardRosterTargets(reward)
      for (const rosterId of targets) {
        const spec = challengeRewardSpec(reward, rosterId)
        if (!spec) continue
        const result = await applySurvivorReward({
          leagueId: challenge.leagueId,
          idempotencyKey: `challenge:${challenge.id}:${index}:${rosterId ?? reward.tribeId ?? 'tribe'}`,
          source: { kind: 'challenge', id: challenge.id },
          week: challenge.week,
          reward: spec,
          deferToWeek,
        })
        applied.push({
          rewardType: spec.type,
          week: challenge.week,
          rosterId,
          tribeId: reward.tribeId ?? null,
          amount: reward.amount ?? null,
          appliedMode: result.ok && result.status === 'applied' ? 'full' : 'record_only',
        })
      }
      continue
    }
    if (reward.rewardType === 'tribe_immunity') {
      if (!reward.tribeId) continue
      await appendEffectAudit(challenge.leagueId, 'challenge_reward_awarded', {
        challengeId: challenge.id,
        week: challenge.week,
        rewardType: reward.rewardType,
        tribeId: reward.tribeId,
      })
      applied.push({
        rewardType: reward.rewardType,
        week: challenge.week,
        tribeId: reward.tribeId,
        appliedMode: 'full',
      })
      continue
    }

    if (reward.rewardType === 'advantage') {
      const rosterTargets = await resolveRewardRosterTargets(reward)
      for (const rosterId of rosterTargets) {
        const powerType = reward.powerType ?? 'extra_vote'
        const syntheticPlayerId = `challenge-advantage:${challenge.id}:${index}:${rosterId}`
        const idol = await prisma.survivorIdol.create({
          data: {
            leagueId: challenge.leagueId,
            configId: config.configId,
            rosterId,
            playerId: syntheticPlayerId,
            powerType,
            status: 'revealed',
          },
        })
        await prisma.survivorIdolLedgerEntry.create({
          data: {
            leagueId: challenge.leagueId,
            idolId: idol.id,
            eventType: 'assigned',
            toRosterId: rosterId,
            metadata: {
              source: 'challenge_reward',
              challengeId: challenge.id,
              rewardType: reward.rewardType,
              powerType,
            },
          },
        })
        await appendEffectAudit(challenge.leagueId, 'challenge_reward_awarded', {
          challengeId: challenge.id,
          week: challenge.week,
          rewardType: reward.rewardType,
          rosterId,
          idolId: idol.id,
          powerType,
        })
        applied.push({
          rewardType: reward.rewardType,
          week: challenge.week,
          rosterId,
          idolId: idol.id,
          powerType,
          appliedMode: 'full',
        })
      }
      continue
    }

    const rosterTargets = await resolveRewardRosterTargets(reward)
    if (rosterTargets.length === 0) {
      await appendEffectAudit(challenge.leagueId, 'challenge_reward_awarded', {
        challengeId: challenge.id,
        week: challenge.week,
        rewardType: reward.rewardType,
        rosterId: reward.rosterId ?? null,
        tribeId: reward.tribeId ?? null,
        amount: reward.amount ?? null,
        appliedMode: reward.rewardType === 'faab' ? 'record_only' : 'full',
      })
      applied.push({
        rewardType: reward.rewardType,
        week: challenge.week,
        rosterId: reward.rosterId ?? null,
        tribeId: reward.tribeId ?? null,
        amount: reward.amount ?? null,
        appliedMode: reward.rewardType === 'faab' ? 'record_only' : 'full',
      })
      continue
    }

    for (const rosterId of rosterTargets) {
      const amount = reward.rewardType === 'score_boost' ? reward.amount ?? 10 : reward.amount ?? null
      let appliedMode: 'full' | 'record_only' = 'full'
      let detail: Record<string, unknown> = {}
      if (reward.rewardType === 'faab') {
        const credit = await creditChallengeFaab(challenge.leagueId, rosterId, amount)
        appliedMode = credit.credited ? 'full' : 'record_only'
        detail = credit.detail
      } else if (reward.rewardType === 'immunity' || reward.rewardType === 'voting_safety') {
        appliedMode = (await grantChallengeImmunity(challenge.leagueId, rosterId)) ? 'full' : 'record_only'
      }
      await appendEffectAudit(challenge.leagueId, 'challenge_reward_awarded', {
        challengeId: challenge.id,
        week: challenge.week,
        rewardType: reward.rewardType,
        rosterId,
        tribeId: reward.tribeId ?? null,
        amount,
        appliedMode,
        ...detail,
      })
      applied.push({
        rewardType: reward.rewardType,
        week: challenge.week,
        rosterId,
        tribeId: reward.tribeId ?? null,
        amount,
        appliedMode,
      })
    }
  }

  return applied
}

export async function getWeeklyEffectState(
  leagueId: string,
  week: number
): Promise<SurvivorWeeklyEffectState> {
  const rows = await prisma.survivorAuditLog.findMany({
    where: {
      leagueId,
      eventType: { in: [...EFFECT_EVENT_TYPES] },
    },
    orderBy: { createdAt: 'asc' },
    select: { metadata: true },
  })

  const protectedRosterIds = new Set<string>()
  const immuneTribeIds = new Set<string>()
  const frozenWaiverRosterIds = new Set<string>()
  const scoreBoostByRoster = new Map<string, number>()

  for (const row of rows) {
    const metadata = asJsonObject(row.metadata) as Prisma.JsonObject | null
    const effectWeek = readNumber(metadata, 'week')
    if (effectWeek == null || effectWeek !== week) continue
    const rewardType = readString(metadata, 'rewardType')
    const rosterId = readString(metadata, 'rosterId')
    const tribeId = readString(metadata, 'tribeId')
    const amount = readNumber(metadata, 'amount') ?? 0

    if ((rewardType === 'immunity' || rewardType === 'voting_safety') && rosterId) {
      protectedRosterIds.add(rosterId)
    }
    if ((rewardType === 'tribe_immunity' || rewardType === 'tribe_immunity_modifier') && tribeId) {
      immuneTribeIds.add(tribeId)
    }
    if (rewardType === 'freeze_waivers' && rosterId) {
      frozenWaiverRosterIds.add(rosterId)
    }
    if (rewardType === 'score_boost' && rosterId) {
      scoreBoostByRoster.set(rosterId, (scoreBoostByRoster.get(rosterId) ?? 0) + amount)
    }
  }

  return {
    protectedRosterIds,
    immuneTribeIds,
    frozenWaiverRosterIds,
    scoreBoostByRoster,
  }
}

export async function getScoreBoostTotalForRoster(
  leagueId: string,
  rosterId: string,
  throughWeek: number
): Promise<number> {
  const rows = await prisma.survivorAuditLog.findMany({
    where: {
      leagueId,
      eventType: { in: [...EFFECT_EVENT_TYPES] },
    },
    select: { metadata: true },
  })

  let total = 0
  for (const row of rows) {
    const metadata = asJsonObject(row.metadata) as Prisma.JsonObject | null
    const rewardType = readString(metadata, 'rewardType')
    const effectRosterId = readString(metadata, 'rosterId')
    const effectWeek = readNumber(metadata, 'week')
    if (rewardType !== 'score_boost' || effectRosterId !== rosterId || effectWeek == null || effectWeek > throughWeek) {
      continue
    }
    total += readNumber(metadata, 'amount') ?? 0
  }
  return total
}

export async function isWaiverFrozenForRoster(
  leagueId: string,
  rosterId: string,
  week?: number | null
): Promise<boolean> {
  const resolvedWeek = week ?? (await resolveSurvivorCurrentWeek(leagueId))
  const state = await getWeeklyEffectState(leagueId, resolvedWeek)
  return state.frozenWaiverRosterIds.has(rosterId)
}

export async function shouldForceTribeShuffleAfterCouncil(
  leagueId: string,
  councilId: string,
  week: number
): Promise<boolean> {
  const rows = await prisma.survivorAuditLog.findMany({
    where: {
      leagueId,
      eventType: 'idol_effect_applied',
    },
    select: { metadata: true },
  })

  for (const row of rows) {
    const metadata = asJsonObject(row.metadata)
    const rewardType = readString(metadata, 'rewardType')
    const effectWeek = readNumber(metadata, 'week')
    const effectCouncilId = readString(metadata, 'councilId')
    if (rewardType === 'force_tribe_shuffle' && effectWeek === week && effectCouncilId === councilId) {
      return true
    }
  }
  return false
}

export async function applyIdolPowerEffect(args: {
  leagueId: string
  idolId: string
  rosterId: string
  powerType: string
  context?: Record<string, unknown>
}): Promise<{ ok: boolean; error?: string; effect?: SurvivorIdolEffectResult }> {
  const week =
    typeof args.context?.week === 'number'
      ? args.context.week
      : typeof args.context?.currentWeek === 'number'
        ? args.context.currentWeek
        : await resolveSurvivorCurrentWeek(args.leagueId)

  const targetRosterId =
    typeof args.context?.targetRosterId === 'string' && args.context.targetRosterId.trim()
      ? args.context.targetRosterId.trim()
      : null
  const councilId =
    typeof args.context?.councilId === 'string' && args.context.councilId.trim()
      ? args.context.councilId.trim()
      : null

  const baseMetadata: Record<string, unknown> = {
    idolId: args.idolId,
    sourceRosterId: args.rosterId,
    rosterId: targetRosterId ?? args.rosterId,
    powerType: args.powerType,
    rewardType: args.powerType,
    week,
    councilId,
  }

  if (args.powerType === 'score_boost') {
    const amount =
      typeof args.context?.amount === 'number'
        ? args.context.amount
        : typeof args.context?.scoreBoost === 'number'
          ? args.context.scoreBoost
          : 10
    await appendEffectAudit(args.leagueId, 'idol_effect_applied', {
      ...baseMetadata,
      amount,
    })
    return {
      ok: true,
      effect: {
        rewardType: 'score_boost',
        week,
        rosterId: targetRosterId ?? args.rosterId,
        amount,
        appliedMode: 'full',
      },
    }
  }

  if (args.powerType === 'freeze_waivers') {
    if (!targetRosterId) {
      return { ok: false, error: 'Freeze waivers requires a target manager' }
    }
    await appendEffectAudit(args.leagueId, 'idol_effect_applied', {
      ...baseMetadata,
      rosterId: targetRosterId,
    })
    return {
      ok: true,
      effect: {
        rewardType: 'freeze_waivers',
        week,
        rosterId: targetRosterId,
        appliedMode: 'full',
      },
    }
  }

  if (args.powerType === 'tribe_immunity_modifier') {
    const tribe = await getTribeForRoster(args.leagueId, targetRosterId ?? args.rosterId)
    if (!tribe) {
      return { ok: false, error: 'Tribe immunity can only be played while tribes are active' }
    }
    await appendEffectAudit(args.leagueId, 'idol_effect_applied', {
      ...baseMetadata,
      rosterId: targetRosterId ?? args.rosterId,
      tribeId: tribe.id,
    })
    return {
      ok: true,
      effect: {
        rewardType: 'tribe_immunity_modifier',
        week,
        rosterId: targetRosterId ?? args.rosterId,
        tribeId: tribe.id,
        appliedMode: 'full',
      },
    }
  }

  if (args.powerType === 'force_tribe_shuffle') {
    const tribe = await getTribeForRoster(args.leagueId, args.rosterId)
    if (!tribe) {
      return { ok: false, error: 'Force tribe shuffle can only be played before the merge' }
    }
    await appendEffectAudit(args.leagueId, 'idol_effect_applied', baseMetadata)
    return {
      ok: true,
      effect: {
        rewardType: 'force_tribe_shuffle',
        week,
        rosterId: args.rosterId,
        appliedMode: 'queued',
      },
    }
  }

  if (args.powerType === 'steal_player') {
    if (!targetRosterId) {
      return { ok: false, error: 'Steal player requires a target manager' }
    }

    const playerId =
      typeof args.context?.playerId === 'string' && args.context.playerId.trim()
        ? args.context.playerId.trim()
        : null
    if (!playerId) {
      return { ok: false, error: 'Choose which player to steal' }
    }

    const stealResult = await stealPlayerForSurvivor({
      leagueId: args.leagueId,
      fromRosterId: args.rosterId,
      toRosterId: targetRosterId,
      playerId,
    })
    if (!stealResult.ok) {
      return { ok: false, error: stealResult.error ?? 'Unable to steal player right now' }
    }

    await appendEffectAudit(args.leagueId, 'idol_effect_applied', {
      ...baseMetadata,
      rosterId: targetRosterId,
      playerId,
      resultingRosterId: args.rosterId,
    })
    return {
      ok: true,
      effect: {
        rewardType: 'steal_player',
        week,
        rosterId: targetRosterId,
        playerId,
        appliedMode: 'full',
      },
    }
  }

  if (args.powerType === 'swap_starter') {
    const affectedRosterId = targetRosterId ?? args.rosterId
    const benchPlayerId =
      typeof args.context?.benchPlayerId === 'string' && args.context.benchPlayerId.trim()
        ? args.context.benchPlayerId.trim()
        : null
    const starterPlayerId =
      typeof args.context?.starterPlayerId === 'string' && args.context.starterPlayerId.trim()
        ? args.context.starterPlayerId.trim()
        : null

    if (!benchPlayerId || !starterPlayerId) {
      return { ok: false, error: 'Swap starter requires both a bench player and a starter' }
    }

    const swapResult = await swapStarterForSurvivor({
      leagueId: args.leagueId,
      rosterId: affectedRosterId,
      benchPlayerId,
      starterPlayerId,
    })
    if (!swapResult.ok) {
      return { ok: false, error: swapResult.error ?? 'Unable to swap starters right now' }
    }

    await appendEffectAudit(args.leagueId, 'idol_effect_applied', {
      ...baseMetadata,
      rosterId: affectedRosterId,
      playerId: benchPlayerId,
      secondaryPlayerId: starterPlayerId,
    })
    return {
      ok: true,
      effect: {
        rewardType: 'swap_starter',
        week,
        rosterId: affectedRosterId,
        playerId: benchPlayerId,
        secondaryPlayerId: starterPlayerId,
        appliedMode: 'full',
      },
    }
  }

  if (args.powerType === 'jury_influence' || args.powerType === 'finale_advantage') {
    const affectedRosterId = targetRosterId ?? args.rosterId
    await appendEffectAudit(args.leagueId, 'idol_effect_applied', {
      ...baseMetadata,
      rosterId: affectedRosterId,
      appliedMode: 'record_only',
    })
    return {
      ok: true,
      effect: {
        rewardType: args.powerType,
        week,
        rosterId: affectedRosterId,
        appliedMode: 'record_only',
      },
    }
  }

  return { ok: true }
}

export async function executeQueuedShuffleForCouncil(
  leagueId: string,
  councilId: string,
  week: number
): Promise<{ ok: boolean; shuffled: boolean; error?: string }> {
  const shouldShuffle = await shouldForceTribeShuffleAfterCouncil(leagueId, councilId, week)
  if (!shouldShuffle) {
    return { ok: true, shuffled: false }
  }

  const shuffleResult = await runShuffle(leagueId)
  if (!shuffleResult.ok) {
    return { ok: false, shuffled: false, error: shuffleResult.error ?? 'Unable to run tribe shuffle' }
  }
  return { ok: true, shuffled: true }
}

export async function getActiveEffectsForRoster(
  leagueId: string,
  rosterId: string,
  week: number
): Promise<SurvivorActiveEffectSummary[]> {
  const [rows, tribe] = await Promise.all([
    prisma.survivorAuditLog.findMany({
      where: {
        leagueId,
        eventType: { in: [...EFFECT_EVENT_TYPES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    }),
    getTribeForRoster(leagueId, rosterId),
  ])

  const effects: SurvivorActiveEffectSummary[] = []
  for (const row of rows) {
    const metadata = asJsonObject(row.metadata)
    const effectWeek = readNumber(metadata, 'week')
    if (effectWeek == null || effectWeek !== week) continue

    const rewardType = readString(metadata, 'rewardType')
    if (!rewardType) continue
    const effectRosterId = readString(metadata, 'rosterId')
    const effectTribeId = readString(metadata, 'tribeId')
    const sourceRosterId = readString(metadata, 'sourceRosterId')
    const appliesToRoster = effectRosterId === rosterId || sourceRosterId === rosterId
    const appliesToTribe = Boolean(tribe?.id && effectTribeId === tribe.id)
    if (!appliesToRoster && !appliesToTribe) continue

    const appliedMode =
      readString(metadata, 'appliedMode') === 'record_only'
        ? 'record_only'
        : readString(metadata, 'appliedMode') === 'queued'
          ? 'queued'
          : 'full'

    effects.push({
      rewardType,
      week,
      appliedMode,
      rosterId: effectRosterId,
      tribeId: effectTribeId,
      sourceRosterId,
    })
  }

  return effects
}
