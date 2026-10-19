import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { logSurvivorAuditEntry } from './auditEntry'
import { postHostMessage } from './hostEngine'
import type { IdolPowerType } from './types'
import { survivorIdolPlayBlockReason } from './juryGuards'

export type IdolPlayResult = { ok: true; message: string } | { ok: false; error: string }

const DEFAULT_POOL: IdolPowerType[] = ['protect_self', 'extra_vote', 'vote_nullifier']

const IMMUNITY_CATS = new Set(['immunity'])
const VOTE_CONTROL_CATS = new Set(['vote_control'])

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function isPostMergePhase(phase: string | null | undefined): boolean {
  if (!phase) return false
  return ['merge', 'jury', 'finale'].includes(phase)
}

export type PowerBalanceLimits = {
  activeMax: number
  immunityMax: number
  voteMax: number
  scoreMax: number
  tribeMax: number
  maxPerPlayerAtSeed: number
  postMergeActiveMax: number
}

export function getPowerBalanceLimitsForPlayerCount(n: number): PowerBalanceLimits {
  if (n <= 16) {
    return {
      activeMax: 8,
      immunityMax: 2,
      voteMax: 2,
      scoreMax: 4,
      tribeMax: 1,
      maxPerPlayerAtSeed: 1,
      postMergeActiveMax: 3,
    }
  }
  if (n <= 18) {
    return {
      activeMax: 9,
      immunityMax: 3,
      voteMax: 2,
      scoreMax: 4,
      tribeMax: 1,
      maxPerPlayerAtSeed: 1,
      postMergeActiveMax: 3,
    }
  }
  return {
    activeMax: 12,
    immunityMax: 3,
    voteMax: 3,
    scoreMax: 4,
    tribeMax: 1,
    maxPerPlayerAtSeed: 1,
    postMergeActiveMax: 3,
  }
}

export type PowerBalanceCheck = {
  ok: boolean
  violations: string[]
  limits: PowerBalanceLimits
  counts: {
    active: number
    immunity: number
    vote: number
    score: number
    tribe: number
    info: number
  }
  powersByPlayer: Record<string, number>
  snowballUserIds: string[]
  postMergeOverCap: boolean
}

function bucketForCategory(cat: string): keyof PowerBalanceCheck['counts'] {
  if (cat === 'immunity' || cat === 'merge_endgame') return 'immunity'
  if (cat === 'vote_control') return 'vote'
  if (cat === 'score_performance') return 'score'
  if (cat === 'tribe_control') return 'tribe'
  if (cat === 'information') return 'info'
  return 'active'
}

function countFromHiddenIdols(
  idols: { powerType: string; powerCategory: string | null; rosterId: string; currentOwnerUserId: string | null }[],
  templateCat: Map<string, string>,
): { counts: PowerBalanceCheck['counts']; powersByPlayer: Record<string, number> } {
  const counts: PowerBalanceCheck['counts'] = {
    active: 0,
    immunity: 0,
    vote: 0,
    score: 0,
    tribe: 0,
    info: 0,
  }
  const powersByPlayer: Record<string, number> = {}

  for (const id of idols) {
    const cat = id.powerCategory ?? templateCat.get(id.powerType) ?? 'information'
    counts.active += 1
    const b = bucketForCategory(cat)
    if (b === 'active') {
      /* roster_movement, exile_token, disadvantage, etc. */
    } else {
      counts[b] += 1
    }

    const key = id.currentOwnerUserId ?? id.rosterId
    powersByPlayer[key] = (powersByPlayer[key] ?? 0) + 1
  }

  return { counts, powersByPlayer }
}

/** Recompute and persist SurvivorPowerBalance from hidden idols. */
export async function reconcileSurvivorPowerBalance(leagueId: string): Promise<void> {
  const templates = await prisma.survivorPowerTemplate.findMany({
    select: { powerType: true, powerCategory: true },
  })
  const templateCat = new Map(templates.map((t) => [t.powerType, t.powerCategory]))

  const hidden = await prisma.survivorIdol.findMany({
    where: { leagueId, status: 'hidden' },
    select: { powerType: true, powerCategory: true, rosterId: true, currentOwnerUserId: true },
  })

  const { counts, powersByPlayer } = countFromHiddenIdols(hidden, templateCat)

  await prisma.survivorPowerBalance.upsert({
    where: { leagueId },
    create: {
      leagueId,
      activePowerCount: counts.active,
      immunityPowerCount: counts.immunity,
      voteControlCount: counts.vote,
      scorePowerCount: counts.score,
      tribeControlCount: counts.tribe,
      infoPowerCount: counts.info,
      powersByPlayer: powersByPlayer as object,
    },
    update: {
      activePowerCount: counts.active,
      immunityPowerCount: counts.immunity,
      voteControlCount: counts.vote,
      scorePowerCount: counts.score,
      tribeControlCount: counts.tribe,
      infoPowerCount: counts.info,
      powersByPlayer: powersByPlayer as object,
      lastUpdated: new Date(),
    },
  })
}

export async function checkPowerBalance(leagueId: string): Promise<PowerBalanceCheck> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorPlayerCount: true, survivorPhase: true },
  })
  const rosterCount = await prisma.roster.count({ where: { leagueId } })
  const n = league?.survivorPlayerCount ?? (rosterCount || 20)
  const limits = getPowerBalanceLimitsForPlayerCount(n)

  const templates = await prisma.survivorPowerTemplate.findMany({
    select: { powerType: true, powerCategory: true },
  })
  const templateCat = new Map(templates.map((t) => [t.powerType, t.powerCategory]))

  const hidden = await prisma.survivorIdol.findMany({
    where: { leagueId, status: 'hidden' },
    select: { powerType: true, powerCategory: true, rosterId: true, currentOwnerUserId: true },
  })

  const { counts, powersByPlayer } = countFromHiddenIdols(hidden, templateCat)
  const violations: string[] = []

  const postMerge = isPostMergePhase(league?.survivorPhase)
  const activeCap = postMerge ? limits.postMergeActiveMax : limits.activeMax

  if (counts.active > activeCap) {
    violations.push(
      postMerge
        ? `Post-merge active powers ${counts.active} exceed cap ${activeCap}.`
        : `Active powers ${counts.active} exceed league cap ${activeCap}.`,
    )
  }
  if (counts.immunity > limits.immunityMax) {
    violations.push(`Immunity-class powers ${counts.immunity} exceed cap ${limits.immunityMax}.`)
  }
  if (counts.vote > limits.voteMax) {
    violations.push(`Vote-control powers ${counts.vote} exceed cap ${limits.voteMax}.`)
  }
  if (counts.score > limits.scoreMax) {
    violations.push(`Score-performance powers ${counts.score} exceed cap ${limits.scoreMax}.`)
  }
  if (counts.tribe > limits.tribeMax) {
    violations.push(`Tribe-control powers ${counts.tribe} exceed cap ${limits.tribeMax}.`)
  }

  const snowballUserIds = Object.entries(powersByPlayer)
    .filter(([, c]) => c >= 3)
    .map(([uid]) => uid)
  if (snowballUserIds.length) {
    violations.push('One or more players hold 3+ active powers (commissioner review).')
  }

  return {
    ok: violations.length === 0,
    violations,
    limits,
    counts,
    powersByPlayer,
    snowballUserIds,
    postMergeOverCap: postMerge && counts.active > limits.postMergeActiveMax,
  }
}

async function rosterHiddenBuckets(
  leagueId: string,
  rosterId: string,
  templateCat: Map<string, string>,
): Promise<{ immunity: number; vote: number; total: number }> {
  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, rosterId, status: 'hidden' },
    select: { powerType: true, powerCategory: true },
  })
  let immunity = 0
  let vote = 0
  for (const i of idols) {
    const cat = i.powerCategory ?? templateCat.get(i.powerType) ?? ''
    if (IMMUNITY_CATS.has(cat) || cat === 'merge_endgame') immunity += 1 // merge_endgame idols count as immunity-class for stacking
    if (VOTE_CONTROL_CATS.has(cat)) vote += 1
  }
  return { immunity, vote, total: idols.length }
}

function templateFromPoolRow(row: {
  powerType: string
  powerLabel: string
  powerCategory: string
  isTradable: boolean
  expirationRule: string
}): {
  powerType: string
  powerLabel: string
  powerCategory: string
  isTradable: boolean
  expiresAtMerge: boolean
} {
  return {
    powerType: row.powerType,
    powerLabel: row.powerLabel,
    powerCategory: row.powerCategory,
    isTradable: row.isTradable,
    expiresAtMerge: row.expirationRule === 'at_merge',
  }
}

export async function seedIdolsAfterDraft(
  leagueId: string,
  assignmentMode: 'random' | 'weighted' | 'manual',
): Promise<void> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) throw new Error('Survivor config not found')

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorIdolCount: true, survivorPlayerCount: true, survivorPhase: true },
  })
  const rosterRows = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
  const count = league?.survivorIdolCount ?? config.idolCount
  const n = league?.survivorPlayerCount ?? (rosterRows.length || 20)
  const limits = getPowerBalanceLimitsForPlayerCount(n)

  const templateCat = new Map(
    (await prisma.survivorPowerTemplate.findMany({ select: { powerType: true, powerCategory: true } })).map((t) => [
      t.powerType,
      t.powerCategory,
    ]),
  )

  const configPool = (config.idolPowerPool as string[] | null)?.length
    ? (config.idolPowerPool as string[])
    : null

  let catalog = await prisma.survivorPowerTemplate.findMany({
    where: configPool ? { powerType: { in: configPool } } : { isDraftDefault: true },
  })

  if (catalog.length === 0) {
    await reconcileSurvivorPowerBalance(leagueId)
    let i = 0
    for (const r of shuffle(rosterRows)) {
      if (i >= count) break
      const powerType = DEFAULT_POOL[i % DEFAULT_POOL.length]!
      const playerId = `bound_${r.id}`
      await prisma.survivorIdol.create({
        data: {
          leagueId,
          configId: config.configId,
          rosterId: r.id,
          playerId,
          powerType,
          powerLabel: powerType.replace(/_/g, ' '),
          status: 'hidden',
        },
      })
      await appendSurvivorAudit(leagueId, config.configId, 'idol_assigned', {
        rosterId: r.id,
        powerType,
        mode: assignmentMode,
      })
      await logSurvivorAuditEntry({
        leagueId,
        category: 'power',
        action: 'POWER_SEEDED',
        actorUserId: r.platformUserId,
        relatedEntityType: 'idol',
        data: { rosterId: r.id, powerType, assignmentMode, templateBacked: false },
        isVisibleToPublic: false,
      })
      i++
      await reconcileSurvivorPowerBalance(leagueId)
    }
    return
  }

  catalog = shuffle(catalog)
  const rosters = shuffle(rosterRows)

  let assigned = 0
  let ti = 0

  for (const r of rosters) {
    if (assigned >= count) break

    const balance = await checkPowerBalance(leagueId)
    if (balance.counts.active >= balance.limits.activeMax) break

    const buckets = await rosterHiddenBuckets(leagueId, r.id, templateCat)
    if (buckets.total >= 3) continue

    let placed = false
    const attempts = catalog.length
    for (let k = 0; k < attempts; k++) {
      const row = catalog[(ti + k) % catalog.length]!
      const t = templateFromPoolRow(row)

      if (buckets.total >= limits.maxPerPlayerAtSeed) break

    const isImmunityClass =
      IMMUNITY_CATS.has(t.powerCategory) || t.powerCategory === 'merge_endgame'
    if (isImmunityClass && buckets.immunity >= 1) continue
    if (VOTE_CONTROL_CATS.has(t.powerCategory) && buckets.vote >= 1) continue

      const nextImm = balance.counts.immunity + (isImmunityClass ? 1 : 0)
      const nextVote = balance.counts.vote + (VOTE_CONTROL_CATS.has(t.powerCategory) ? 1 : 0)
      const nextScore = balance.counts.score + (t.powerCategory === 'score_performance' ? 1 : 0)
      const nextTribe = balance.counts.tribe + (t.powerCategory === 'tribe_control' ? 1 : 0)
      const nextActive = balance.counts.active + 1

      if (nextImm > limits.immunityMax) continue
      if (nextVote > limits.voteMax) continue
      if (nextScore > limits.scoreMax) continue
      if (nextTribe > limits.tribeMax) continue
      if (nextActive > limits.activeMax) continue

      const playerId = `bound_${r.id}`
      const idol = await prisma.survivorIdol.create({
        data: {
          leagueId,
          configId: config.configId,
          rosterId: r.id,
          playerId,
          powerType: t.powerType,
          powerLabel: t.powerLabel,
          powerCategory: t.powerCategory,
          isTradable: t.isTradable,
          expiresAtMerge: t.expiresAtMerge,
          currentOwnerUserId: r.platformUserId,
          originalOwnerUserId: r.platformUserId,
          status: 'hidden',
        },
      })

      await prisma.survivorIdolLedgerEntry.create({
        data: {
          leagueId,
          idolId: idol.id,
          eventType: 'assigned',
          fromRosterId: null,
          toRosterId: r.id,
          metadata: { powerType: t.powerType, assignmentMode } as object,
        },
      })

      await appendSurvivorAudit(leagueId, config.configId, 'idol_assigned', {
        rosterId: r.id,
        powerType: t.powerType,
        mode: assignmentMode,
      })
      await logSurvivorAuditEntry({
        leagueId,
        category: 'power',
        action: 'POWER_SEEDED',
        actorUserId: r.platformUserId,
        targetUserId: r.platformUserId,
        relatedEntityId: idol.id,
        relatedEntityType: 'idol',
        data: { idolId: idol.id, powerType: t.powerType, assignmentMode, templateBacked: true },
        isVisibleToPublic: false,
      })

      await reconcileSurvivorPowerBalance(leagueId)
      assigned += 1
      ti += k + 1
      placed = true
      break
    }

    if (!placed) ti += 1
  }
}

async function resolveRosterIdForUser(leagueId: string, userId: string): Promise<string | null> {
  const r = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  return r?.id ?? null
}

export async function playIdol(
  idolId: string,
  playingUserId: string,
  councilId: string,
  protectedUserId?: string,
): Promise<IdolPlayResult> {
  const council = await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId } })
  if (!council || council.status !== 'voting_open') {
    return { ok: false, error: 'Idol play window has closed.' }
  }
  const idol = await prisma.survivorIdol.findFirst({ where: { id: idolId, leagueId: council.leagueId } })
  if (!idol || idol.status !== 'hidden') return { ok: false, error: 'Invalid idol' }

  const prev = Array.isArray(council.idolsPlayed) ? (council.idolsPlayed as object[]) : []
  if (prev.length >= 2) {
    return { ok: false, error: 'This Tribal already has two idol plays — a third is not allowed.' }
  }

  const selfRosterId = await resolveRosterIdForUser(council.leagueId, playingUserId)
  if (!selfRosterId) return { ok: false, error: 'Could not resolve your roster for this league.' }
  const ownsIdol = idol.currentOwnerUserId
    ? idol.currentOwnerUserId === playingUserId
    : idol.rosterId === selfRosterId
  if (!ownsIdol) return { ok: false, error: 'Invalid idol' }

  // Jurors (and anyone else out of the game) cannot play idols. Legacy leagues may have no
  // SurvivorPlayer row, so the jury table is checked independently of it.
  const [castRow, juryRow] = await Promise.all([
    prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: council.leagueId, userId: playingUserId } }, select: { playerState: true, isJuryMember: true } }),
    prisma.survivorJuryMember.findUnique({ where: { leagueId_rosterId: { leagueId: council.leagueId, rosterId: selfRosterId } }, select: { id: true } }),
  ])
  if (juryRow) return { ok: false, error: 'Jurors cannot play idols.' }
  if (castRow) {
    const blocked = survivorIdolPlayBlockReason(castRow)
    if (blocked) return { ok: false, error: blocked }
  }

  let allyRosterId: string | null = null
  if (protectedUserId) {
    allyRosterId = await resolveRosterIdForUser(council.leagueId, protectedUserId)
  }

  // Conditional on still being hidden, so two concurrent plays cannot both win.
  const claimed = await prisma.survivorIdol.updateMany({
    where: { id: idolId, status: 'hidden' },
    data: {
      status: 'used',
      usedAt: new Date(),
      usedAtCouncilId: councilId,
      currentOwnerUserId: playingUserId,
      isUsed: true,
    },
  })
  if (claimed.count !== 1) return { ok: false, error: 'Invalid idol' }

  await prisma.survivorIdolLedgerEntry.create({
    data: {
      leagueId: council.leagueId,
      idolId,
      eventType: 'used',
      fromRosterId: idol.rosterId,
      toRosterId: null,
      metadata: {
        councilId,
        powerType: idol.powerType,
        protectedRosterId: selfRosterId,
        protectedAllyRosterId: allyRosterId,
      } as object,
    },
  })

  await prisma.survivorTribalCouncil.update({
    where: { id: councilId },
    data: {
      idolsPlayed: [...prev, { userId: playingUserId, idolId, protectedUserId }] as object,
    },
  })

  const cfg = await getSurvivorConfig(council.leagueId)
  if (cfg) {
    await appendSurvivorAudit(council.leagueId, cfg.configId, 'idol_used', { idolId, councilId })
  }

  await logSurvivorAuditEntry({
    leagueId: council.leagueId,
    week: council.week,
    category: 'power',
    action: 'POWER_PLAYED',
    actorUserId: playingUserId,
    targetUserId: protectedUserId ?? playingUserId,
    relatedEntityId: councilId,
    relatedEntityType: 'council',
    data: {
      idolId,
      powerType: idol.powerType,
      councilId,
      protectedUserId: protectedUserId ?? null,
    },
    isVisibleToPublic: false,
  })

  await reconcileSurvivorPowerBalance(council.leagueId)

  const councilAfter = await prisma.survivorTribalCouncil.findUnique({
    where: { id: councilId },
    select: { idolsPlayed: true },
  })
  const updated = Array.isArray(councilAfter?.idolsPlayed) ? (councilAfter.idolsPlayed as object[]) : []

  if (updated.length >= 2) {
    await postHostMessage(
      council.leagueId,
      'host_pacing_note',
      {
        note: 'The power has shifted dramatically this week.',
        councilId,
        commissionerAlert: 'Multiple powers used this Tribal — season pace check',
      },
      'league_chat',
    ).catch(() => {})
    await logSurvivorAuditEntry({
      leagueId: council.leagueId,
      week: council.week,
      category: 'twist',
      action: 'MULTIPLE_POWERS_TRIBAL',
      data: { councilId, idolPlayCount: updated.length },
      isVisibleToPublic: false,
    })
  }

  return { ok: true, message: 'Your idol has been registered.' }
}

export async function transferIdol(
  idolId: string,
  fromUserId: string,
  toUserId: string,
  reason: string,
): Promise<void> {
  const idol = await prisma.survivorIdol.findUnique({ where: { id: idolId } })
  if (!idol) throw new Error('Idol not found')
  if (idol.currentOwnerUserId && idol.currentOwnerUserId !== fromUserId) {
    throw new Error('Not your idol')
  }
  const league = await prisma.league.findUnique({
    where: { id: idol.leagueId },
    select: { survivorIdolsTradable: true, settings: true, sport: true },
  })
  const leagueSettings = league?.settings as Record<string, unknown> | null
  if (String(league?.sport ?? '').toUpperCase() === 'NBA' && leagueSettings?.survivorFoundationSettingsVersion === 1) {
    throw new Error('In NBA Survivor, a player-bound idol transfers only when its player is traded or claimed from waivers.')
  }
  if (!idol.isTradable && !league?.survivorIdolsTradable) throw new Error('Idol is not tradable')

  const toRoster = await prisma.roster.findFirst({
    where: { leagueId: idol.leagueId, platformUserId: toUserId },
    select: { id: true },
  })
  if (!toRoster) throw new Error('Target roster not found')

  const templateCat = new Map(
    (await prisma.survivorPowerTemplate.findMany({ select: { powerType: true, powerCategory: true } })).map((t) => [
      t.powerType,
      t.powerCategory,
    ]),
  )
  const fromBuckets = await rosterHiddenBuckets(idol.leagueId, idol.rosterId, templateCat)
  const toBuckets = await rosterHiddenBuckets(idol.leagueId, toRoster.id, templateCat)
  const cat = idol.powerCategory ?? templateCat.get(idol.powerType) ?? ''

  const immClass = IMMUNITY_CATS.has(cat) || cat === 'merge_endgame'
  if (immClass && toBuckets.immunity >= 1) {
    throw new Error('Target already holds an immunity-class power')
  }
  if (VOTE_CONTROL_CATS.has(cat) && toBuckets.vote >= 1) {
    throw new Error('Target already holds a vote-control power')
  }
  if (toBuckets.total >= 3) {
    throw new Error('Target already holds the maximum number of active powers (3)')
  }

  const history = (Array.isArray(idol.transferHistory) ? idol.transferHistory : []) as object[]
  await prisma.survivorIdol.update({
    where: { id: idolId },
    data: {
      currentOwnerUserId: toUserId,
      rosterId: toRoster.id,
      playerId: `bound_${toRoster.id}`,
      transferHistory: [...history, { fromUserId, toUserId, reason, transferredAt: new Date() }] as object,
    },
  })

  await prisma.survivorIdolLedgerEntry.create({
    data: {
      leagueId: idol.leagueId,
      idolId,
      eventType: 'transferred',
      fromRosterId: idol.rosterId,
      toRosterId: toRoster.id,
      metadata: { fromUserId, toUserId, reason } as object,
    },
  })

  const cfg = await getSurvivorConfig(idol.leagueId)
  if (cfg) await appendSurvivorAudit(idol.leagueId, cfg.configId, 'idol_transferred', { idolId, toUserId })

  await logSurvivorAuditEntry({
    leagueId: idol.leagueId,
    category: 'power',
    action: 'POWER_TRANSFERRED',
    actorUserId: fromUserId,
    targetUserId: toUserId,
    relatedEntityId: idolId,
    relatedEntityType: 'idol',
    data: { idolId, fromUserId, toUserId, reason },
    isVisibleToPublic: false,
  })

  await reconcileSurvivorPowerBalance(idol.leagueId)
}

export async function expireIdolsAtMerge(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorIdolConvertRule: true, survivorIdolsExpireAtMerge: true },
  })
  if (league?.survivorIdolsExpireAtMerge === false) return

  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, expiresAtMerge: true, status: 'hidden' },
  })
  const rule = league?.survivorIdolConvertRule ?? 'faab'
  const cfg = await getSurvivorConfig(leagueId)

  for (const id of idols) {
    await prisma.survivorIdol.update({
      where: { id: id.id },
      data: { status: 'expired', expiredAt: new Date() },
    })
    if (rule === 'faab' && id.rosterId) {
      const roster = await prisma.roster.findFirst({
        where: { id: id.rosterId, leagueId },
        select: { id: true, faabRemaining: true },
      })
      if (roster) {
        await prisma.roster.update({
          where: { id: roster.id },
          data: { faabRemaining: (roster.faabRemaining ?? 0) + 5 },
        })
      }
    }

    await prisma.survivorIdolLedgerEntry.create({
      data: {
        leagueId,
        idolId: id.id,
        eventType: 'expired',
        fromRosterId: id.rosterId,
        metadata: { rule, conversionResult: rule } as object,
      },
    })

    if (cfg) {
      await appendSurvivorAudit(leagueId, cfg.configId, 'idol_expired', { idolId: id.id })
    }
    await logSurvivorAuditEntry({
      leagueId,
      category: 'power',
      action: 'POWER_EXPIRED',
      relatedEntityId: id.id,
      relatedEntityType: 'idol',
      data: { idolId: id.id, powerType: id.powerType, conversionResult: rule },
      isVisibleToPublic: false,
    })
  }

  await reconcileSurvivorPowerBalance(leagueId)
}
