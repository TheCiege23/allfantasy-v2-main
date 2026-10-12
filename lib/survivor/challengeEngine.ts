import { prisma } from '@/lib/prisma'
import { createChallenge as createChallengeCore, submitChallengeAnswer } from './SurvivorChallengeEngine'
import type { SurvivorChallengeType } from './types'
import { postHostMessage } from './hostEngine'
import { logSurvivorAuditEntry } from './auditEntry'
import { shouldBlockTwist } from './twistEngine'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'

export type ChallengeResult = { challengeId: string; winners: string[] }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function inferCategoryFromChallengeRow(row: {
  challengeType: string
  configJson: unknown
}): string {
  const j = row.configJson && typeof row.configJson === 'object' ? (row.configJson as Record<string, unknown>) : {}
  if (typeof j.challengeCategory === 'string') return j.challengeCategory
  if (row.challengeType === 'score_prediction') return 'sports_prediction'
  return 'general'
}

async function recentChallengeCategories(leagueId: string, take = 3): Promise<string[]> {
  const rows = await prisma.survivorChallenge.findMany({
    where: { leagueId },
    orderBy: { week: 'desc' },
    take,
    select: { challengeType: true, configJson: true },
  })
  return rows.map((r) => inferCategoryFromChallengeRow(r))
}

/** No more than two sports_prediction-style challenges in a row. */
export async function assertChallengeCategoryVariety(
  leagueId: string,
  nextCategory: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (nextCategory !== 'sports_prediction') return { ok: true }
  const cats = await recentChallengeCategories(leagueId, 2)
  if (cats.filter((c) => c === 'sports_prediction').length >= 2) {
    return { ok: false, reason: 'Rotate categories: not more than two sports_prediction challenges in a row.' }
  }
  return { ok: true }
}

/** Same-week reward caps: one immunity-granting challenge, FAAB reward cap, idol/disadvantage pacing. */
export async function assertWeeklyChallengeRewardBalance(
  leagueId: string,
  week: number,
  draft: {
    affectsImmunity?: boolean
    rewardFaabAmount?: number
    grantsIdol?: boolean
    grantsDisadvantage?: boolean
  },
): Promise<{ ok: boolean; reason?: string }> {
  const sameWeek = await prisma.survivorChallenge.findMany({
    where: { leagueId, week },
    select: {
      rewardType: true,
      rewardAmount: true,
      configJson: true,
    },
  })

  let immunityCount = 0
  let totalFaab = 0

  for (const c of sameWeek) {
    const rt = (c.rewardType ?? '').toLowerCase()
    if (rt.includes('immunity') || rt === 'immunity_bonus') immunityCount += 1
    if (typeof c.rewardAmount === 'number' && rt.includes('faab')) totalFaab += c.rewardAmount
  }

  if (draft.affectsImmunity && immunityCount >= 1) {
    return { ok: false, reason: 'No two immunity-granting challenges in the same week.' }
  }
  if (draft.rewardFaabAmount != null && totalFaab + draft.rewardFaabAmount > 40) {
    return { ok: false, reason: 'FAAB rewards capped at $40 per challenge week aggregate.' }
  }

  if (draft.grantsIdol) {
    const start = Math.max(1, week - 2)
    const idolWindow = await prisma.survivorChallenge.findMany({
      where: { leagueId, week: { gte: start, lte: week } },
      select: { configJson: true },
    })
    let idolGrants = 0
    for (const c of idolWindow) {
      const j = c.configJson && typeof c.configJson === 'object' ? (c.configJson as Record<string, unknown>) : {}
      if (j.grantsIdol === true) idolGrants += 1
    }
    if (idolGrants >= 1) {
      return { ok: false, reason: 'Idol grants from challenges: max one per 3-week window.' }
    }
  }

  if (draft.grantsDisadvantage) {
    const disStart = Math.max(1, week - 3)
    const disWindow = await prisma.survivorChallenge.findMany({
      where: { leagueId, week: { gte: disStart, lte: week - 1 } },
      select: { configJson: true },
    })
    let dis = 0
    for (const c of disWindow) {
      const j = c.configJson && typeof c.configJson === 'object' ? (c.configJson as Record<string, unknown>) : {}
      if (j.grantsDisadvantage === true) dis += 1
    }
    if (dis >= 1) {
      return { ok: false, reason: 'Disadvantage from challenges: max one per 4-week window.' }
    }
  }

  return { ok: true }
}

async function pickCatalogTemplate(leagueId: string, week: number) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorPhase: true },
  })
  const phase = league?.survivorPhase ?? 'pre_merge'
  const post = phase === 'merge' || phase === 'jury' || phase === 'finale'
  const validity = post ? 'post_merge' : 'pre_merge'

  const candidates = await prisma.survivorChallengeTemplate.findMany({
    where: {
      phaseValidity: validity,
      aiCanAutoGenerate: true,
    },
  })
  for (const t of shuffle(candidates)) {
    const v = await assertChallengeCategoryVariety(leagueId, t.category)
    if (!v.ok) continue
    const rb = await assertWeeklyChallengeRewardBalance(leagueId, week, {
      affectsImmunity: t.affectsImmunity,
      grantsIdol: t.grantsIdol,
      grantsDisadvantage: t.grantsDisadvantage,
      rewardFaabAmount: t.affectsFaab ? 15 : undefined,
    })
    if (!rb.ok) continue
    return t
  }
  return candidates[0] ?? null
}

export async function createWeeklyChallenge(
  leagueId: string,
  week: number,
  mode: 'auto' | 'manual',
  twistOpts?: { twistType?: string },
): Promise<{ id: string }> {
  if (twistOpts?.twistType) {
    const block = await shouldBlockTwist(leagueId, twistOpts.twistType, week)
    if (block.blocked) {
      throw new Error(block.reason ?? 'Twist blocked by pacing rules')
    }
  }

  if (mode === 'manual') {
    const cfg = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId } })
    if (!cfg) throw new Error('No survivor config')
    const shell = await prisma.survivorChallenge.create({
      data: {
        leagueId,
        configId: cfg.id,
        week,
        challengeNumber: 1,
        challengeType: 'trivia',
        title: 'Commissioner challenge',
        description: 'Fill in details in commissioner tools.',
        instructions: 'TBD',
        status: 'open',
        configJson: { challengeCategory: 'strategy_social', commissionerManual: true } as object,
      },
    })
    await logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'challenge',
      action: 'CHALLENGE_CREATED',
      relatedEntityId: shell.id,
      relatedEntityType: 'challenge',
      data: { challengeId: shell.id, week, aiGenerated: false, mode: 'manual' },
      isVisibleToPublic: true,
    })
    return { id: shell.id }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorPhase: true },
  })
  if (league?.survivorPhase === 'finale') {
    throw new Error('Finale week: no mechanical challenge — social only.')
  }

  const template = await pickCatalogTemplate(leagueId, week)

  const challengeType = (template?.category === 'sports_prediction' ? 'score_prediction' : 'trivia') as SurvivorChallengeType
  const configJson: Record<string, unknown> = {
    challengeKey: template?.challengeKey ?? 'auto_fallback',
    challengeCategory: template?.category ?? 'general',
    templateName: template?.name ?? null,
    commissionerApprovalRecommended: template?.commissionerApprovalRecommended ?? false,
  }

  const created = await createChallengeCore(
    leagueId,
    week,
    challengeType,
    configJson,
    undefined,
  )
  if (!created.ok || !created.challengeId) throw new Error(created.error ?? 'Challenge failed')

  await prisma.survivorChallenge.update({
    where: { id: created.challengeId },
    data: {
      status: 'open',
      locksAt: new Date(Date.now() + 86400000),
      title: template?.name ?? 'Weekly challenge',
      description: template?.theme ?? '',
      instructions: template?.inputDescription ?? '',
      rewardType: template?.defaultRewardType ?? undefined,
      type: template?.challengeKey ?? null,
    },
  })

  await logSurvivorAuditEntry({
    leagueId,
    week,
    category: 'challenge',
    action: 'CHALLENGE_CREATED',
    relatedEntityId: created.challengeId,
    relatedEntityType: 'challenge',
    data: {
      challengeId: created.challengeId,
      week,
      aiGenerated: true,
      challengeKey: template?.challengeKey,
      category: template?.category,
    },
    isVisibleToPublic: true,
  })

  await postHostMessage(leagueId, 'challenge_post', { week }, 'league_chat').catch(() => {})
  return { id: created.challengeId }
}

export async function lockChallengeSubmissions(challengeId: string): Promise<void> {
  const ch = await prisma.survivorChallenge.findUnique({
    where: { id: challengeId },
    select: { leagueId: true, week: true },
  })
  const total = await prisma.survivorChallengeSubmission.count({ where: { challengeId } })
  await prisma.survivorChallengeSubmission.updateMany({
    where: { challengeId },
    data: { isLocked: true },
  })
  await prisma.survivorChallenge.update({
    where: { id: challengeId },
    data: { status: 'locked', lockAt: new Date() },
  })
  if (ch) {
    await logSurvivorAuditEntry({
      leagueId: ch.leagueId,
      week: ch.week,
      category: 'challenge',
      action: 'CHALLENGE_LOCKED',
      relatedEntityId: challengeId,
      relatedEntityType: 'challenge',
      data: { challengeId, lockTimestamp: new Date().toISOString(), totalSubmissions: total },
      isVisibleToPublic: true,
    })
  }
}

/**
 * Creates one system challenge for the week when `challengesSystemRun` is on and none exists.
 * Avoids commissioner-authored props (reduces collusion when the commissioner plays).
 */
export async function ensureSystemWeeklyChallenge(leagueId: string, week: number): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (readSurvivorFullSeasonPlan(league?.settings)) return // Planned seasons use verified slate contests.
  const cfg = await prisma.survivorLeagueConfig.findUnique({
    where: { leagueId },
    select: { challengesSystemRun: true },
  })
  if (!cfg?.challengesSystemRun) return
  const existing = await prisma.survivorChallenge.findFirst({ where: { leagueId, week } })
  if (existing) return
  try {
    await createWeeklyChallenge(leagueId, week, 'auto')
  } catch (e) {
    console.warn('[Survivor] ensureSystemWeeklyChallenge', e)
  }
}

export async function tallyChallengeResults(challengeId: string): Promise<ChallengeResult> {
  const ch = await prisma.survivorChallenge.findUnique({ where: { id: challengeId } })
  if (!ch) throw new Error('Not found')
  if (ch.status === 'complete' && ch.resultJson) return { challengeId, winners: ch.winnerUserIds }
  // A template does not carry an answer key or a verified game result. Keep it
  // locked until a scoring adapter can prove an outcome; never publish a fake winner.
  throw new Error(`Challenge ${challengeId} has no verified scoring adapter`)
}

export { submitChallengeAnswer }
