import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { queueAnimation } from '@/lib/zombie/animationEngine'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type ZombieWeeklyUpdateDraft = {
  header: string
  sectionWhisperer: string
  sectionZombies: string
  sectionSurvivors: string
  sectionMoney?: string
  sectionBashingsMaulings: string
  sectionNewInfections: string
  sectionRevivals?: string
  sectionInventory?: string
  sectionDangerMatchups?: string
  sectionUniverseMovement?: string
  footer: string
  meta: {
    hordeSize: number
    prevHordeSize: number
    week: number
    leagueName: string
  }
}

export async function getResolutionForWeek(zombieLeagueId: string, week: number) {
  return prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId, week } },
  })
}

async function displayNameForUser(leagueId: string, userId: string): Promise<string> {
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
  })
  if (roster) {
    const zt = await prisma.zombieLeagueTeam.findUnique({
      where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
      select: { displayName: true, fantasyTeamName: true },
    })
    if (zt?.fantasyTeamName?.trim()) return zt.fantasyTeamName.trim()
    if (zt?.displayName?.trim()) return zt.displayName.trim()
  }
  const u = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { displayName: true, username: true },
  })
  return u?.displayName?.trim() || u?.username?.trim() || userId
}

export async function buildWeeklyUpdate(leagueId: string, week: number): Promise<ZombieWeeklyUpdateDraft> {
  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    include: {
      teams: true,
      whispererRecord: true,
      level: true,
      universe: true,
    },
  })
  if (!z) throw new Error('Zombie league not found')

  const leagueName = z.name?.trim() || 'Zombie League'
  const tierLabel = z.level?.tierLabel ?? z.level?.name ?? null
  const header = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧟 ${leagueName} — WEEK ${week} SURVIVOR REPORT
${tierLabel ? `${tierLabel} | ` : ''}${z.sport} | Season ${z.season}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  const wr = z.whispererRecord
  const whispererName = wr?.displayName ?? 'Unknown'
  const ambushesLeft = wr?.ambushesRemaining ?? 0
  const hordeSize = z.teams.filter((t) => t.status === 'Zombie').length
  const survivorCount = z.teams.filter((t) => t.status === 'Survivor').length

  const ambushes = await prisma.zombieAmbushAction.findMany({
    where: { zombieLeagueId: z.id, week },
    take: 3,
  })
  const ambushSummary =
    ambushes.length === 0
      ? 'None declared'
      : ambushes.map((a) => a.ambushType).join(', ')

  const sectionWhisperer = `🎭 THE WHISPERER
${whispererName} — ${ambushesLeft} ambushes remaining
Horde under command: ${hordeSize} Zombies
This week's ambush: ${ambushSummary}`

  const zombies = z.teams.filter((t) => t.status === 'Zombie')
  const zombieLines: string[] = []
  for (const t of zombies) {
    const nm = await displayNameForUser(leagueId, (await rosterUserId(t.rosterId)) ?? t.rosterId)
    const by = t.killedByUserId ? await displayNameForUser(leagueId, t.killedByUserId) : '—'
    zombieLines.push(`🧟 ${nm} — Week turned: ${t.weekBecameZombie ?? '?'} — Infected by: ${by}`)
  }
  const newInf = await prisma.zombieInfectionEvent.findMany({
    where: { zombieLeagueId: z.id, week },
  })
  const newList: string[] = []
  for (const ev of newInf) {
    newList.push(
      `${await displayNameForUser(leagueId, ev.victimUserId)} ← ${await displayNameForUser(leagueId, ev.infectorUserId)}`,
    )
  }

  const sectionZombies = `🧟 THE HORDE (${zombies.length} strong)
${zombieLines.length ? zombieLines.join('\n') : '—'}
New this week: ${newList.length ? newList.join('; ') : 'None'}`

  const survivors = z.teams.filter((t) => t.status === 'Survivor' || t.status.toLowerCase().includes('revived'))
  const survLines: string[] = []
  for (const t of survivors) {
    const uid = await rosterUserId(t.rosterId)
    const nm = uid ? await displayNameForUser(leagueId, uid) : t.rosterId
    survLines.push(`🧍 ${nm} — Record: ${t.wins}-${t.losses} — PF: ${(t.pointsFor ?? 0).toFixed(1)}`)
  }
  const revived = z.teams.filter((t) => t.status.toLowerCase().includes('revived'))
  const revivedNames: string[] = []
  for (const r of revived) {
    const uid = await rosterUserId(r.rosterId)
    if (uid) revivedNames.push(await displayNameForUser(leagueId, uid))
  }
  const sectionSurvivors = `🧍 SURVIVORS (${survivorCount} remaining)
${survLines.length ? survLines.join('\n') : '—'}
${revivedNames.length ? `⚡ REVIVED: ${revivedNames.join(', ')}` : ''}`

  let sectionMoney: string | undefined
  if (z.updateIncludeMoney) {
    if (z.isPaid) {
      sectionMoney = `💰 POT REPORT
Total Pot: $${(z.potTotal ?? 0).toFixed(2)}
Distributed this week: (see ledger)
Remaining in pot: (see ledger)
Top earner this week: —`
    } else {
      sectionMoney = `🏅 POINTS REPORT
Outbreak Points in play: ${(z.potTotal ?? 0).toFixed(1)}
Earned this week: —
Leader: —`
    }
  }

  const bash = await prisma.zombieBashingEvent.findMany({ where: { leagueId, week } })
  const maul = await prisma.zombieMaulingEvent.findMany({ where: { leagueId, week } })
  const bashLines = await Promise.all(
    bash.map(async (b) => {
      const wn = await displayNameForUser(leagueId, b.winnerUserId)
      const ln = await displayNameForUser(leagueId, b.loserUserId)
      return `🔥 BASHING: ${wn} defeated ${ln} by ${b.margin.toFixed(1)} pts`
    }),
  )
  const maulLines = await Promise.all(
    maul.map(async (m) => {
      const mn = await displayNameForUser(leagueId, m.maulerUserId)
      const vn = await displayNameForUser(leagueId, m.victimUserId)
      return `💀 MAULING: ${mn} destroyed ${vn} by ${m.margin.toFixed(1)} pts`
    }),
  )
  const sectionBashingsMaulings = `⚔️ COMBAT EVENTS
${[...bashLines, ...maulLines].join('\n') || '—'}`

  const infLines = await Promise.all(
    newInf.map(async (ev) => {
      const v = await displayNameForUser(leagueId, ev.victimUserId)
      const i = await displayNameForUser(leagueId, ev.infectorUserId)
      return `${v} turned by ${i} — margin: ${ev.scoreDifference.toFixed(1)} pts`
    }),
  )
  const sectionNewInfections = `🩸 NEW INFECTIONS (Week ${week})
${infLines.length ? infLines.join('\n') : 'None'}`

  let sectionInventory: string | undefined
  if (z.updateIncludeInventory) {
    const items = await prisma.zombieTeamItem.findMany({
      where: { team: { leagueId } },
    })
    const serums = items.filter((i) => i.itemType.includes('serum') && !i.isUsed).length
    const weapons = items.filter((i) => i.itemType.startsWith('weapon_') && !i.isUsed)
    const bomb = weapons.some((i) => i.itemType === 'weapon_bomb')
    sectionInventory = `🎒 ITEM INVENTORY SNAPSHOT
Serums held: ${serums}
Active weapons: ${weapons.length} (${[...new Set(weapons.map((w) => w.itemType))].join(', ') || 'none'})
Bomb status: ${bomb ? 'Active' : 'None'}`
  }

  let sectionDangerMatchups: string | undefined
  if (z.updateIncludeDanger) {
    const season = await prisma.redraftSeason.findFirst({ where: { leagueId, season: z.season } })
    const nextWeek = week + 1
    const danger: string[] = []
    if (season) {
      const mm = await prisma.redraftMatchup.findMany({
        where: { seasonId: season.id, week: nextWeek },
        take: 12,
      })
      for (const m of mm) {
        if (!m.awayRosterId) continue
        const h = await redraftOwnerStatus(leagueId, m.homeRosterId)
        const a = await redraftOwnerStatus(leagueId, m.awayRosterId)
        const pair = infectionRiskPair(h, a, m.homeRosterId, m.awayRosterId, leagueId)
        if (pair) danger.push(pair)
      }
    }
    sectionDangerMatchups = `⚠️ DANGER MATCHUPS — WEEK ${nextWeek}
${danger.slice(0, 3).join('\n') || '—'}`
  }

  let sectionUniverseMovement: string | undefined
  if (z.updateIncludeUniverse && z.universeId) {
    const stats = await prisma.zombieUniverseStat.findMany({
      where: { universeId: z.universeId, season: z.season },
      orderBy: { universeRank: 'asc' },
      take: 8,
    })
    const promote = stats.slice(0, 2).map((s) => s.displayName)
    const relegate = stats.slice(-2).map((s) => s.displayName)
    sectionUniverseMovement = `🌍 UNIVERSE PROJECTION
On track for promotion: ${promote.join(', ') || '—'}
At risk of relegation: ${relegate.join(', ') || '—'}
Current tier rank: (see universe hub)`
  }

  const prevRes = await prisma.zombieWeeklyResolution.findFirst({
    where: { zombieLeagueId: z.id, week: week - 1 },
  })
  const prevHorde = prevRes?.hordeSize ?? hordeSize

  const footer = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next update: ${footerSchedule(z)}
Questions? Tag @Chimmy in chat.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`

  return {
    header,
    sectionWhisperer,
    sectionZombies,
    sectionSurvivors,
    sectionMoney,
    sectionBashingsMaulings,
    sectionNewInfections,
    sectionInventory,
    sectionDangerMatchups,
    sectionUniverseMovement,
    footer,
    meta: { hordeSize, prevHordeSize: prevHorde, week, leagueName },
  }
}

async function rosterUserId(rosterId: string): Promise<string | null> {
  const r = await prisma.roster.findUnique({ where: { id: rosterId }, select: { platformUserId: true } })
  return r?.platformUserId ?? null
}

async function redraftOwnerStatus(
  leagueId: string,
  redraftRosterId: string,
): Promise<{ userId: string; status: string } | null> {
  const rr = await prisma.redraftRoster.findUnique({
    where: { id: redraftRosterId },
    select: { ownerId: true },
  })
  if (!rr) return null
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: rr.ownerId },
    select: { id: true },
  })
  if (!roster) return { userId: rr.ownerId, status: 'Survivor' }
  const zt = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    select: { status: true },
  })
  return { userId: rr.ownerId, status: zt?.status ?? 'Survivor' }
}

function infectionRiskPair(
  h: { userId: string; status: string } | null,
  a: { userId: string; status: string } | null,
  homeRid: string,
  awayRid: string,
  leagueId: string,
): string | null {
  void leagueId
  void homeRid
  void awayRid
  if (!h || !a) return null
  const hs = h.status.toLowerCase()
  const as = a.status.toLowerCase()
  if (hs.includes('survivor') && (as.includes('zombie') || as.includes('whisperer'))) {
    return `🔴 Survivor vs Horde threat (matchup)`
  }
  if (as.includes('survivor') && (hs.includes('zombie') || hs.includes('whisperer'))) {
    return `🔴 Survivor vs Horde threat (matchup)`
  }
  return null
}

function footerSchedule(z: { weeklyUpdateDay: number | null; weeklyUpdateHour: number | null }): string {
  if (z.weeklyUpdateDay == null || z.weeklyUpdateHour == null) {
    return 'After each week resolves (or set a day/time in commissioner settings).'
  }
  return `${DAY_NAMES[z.weeklyUpdateDay]} at ${z.weeklyUpdateHour}:00 UTC`
}

export function composeWeeklyUpdateBody(d: ZombieWeeklyUpdateDraft): string {
  const parts = [
    d.header,
    d.sectionWhisperer,
    d.sectionZombies,
    d.sectionSurvivors,
    d.sectionMoney,
    d.sectionBashingsMaulings,
    d.sectionNewInfections,
    d.sectionRevivals,
    d.sectionInventory,
    d.sectionDangerMatchups,
    d.sectionUniverseMovement,
    d.footer,
  ].filter(Boolean)
  return parts.join('\n\n')
}

export async function postWeeklyUpdate(leagueId: string, week: number, draft: ZombieWeeklyUpdateDraft): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')

  const body = composeWeeklyUpdateBody(draft)
  // AfSub prose: call `generateWeeklyRecap` from commissioner tools or a dedicated job — it creates its own row.

  const ann = await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId: z.id,
      universeId: z.universeId,
      type: 'weekly_update',
      title: `Week ${week} — Horde report`,
      content: body,
      week,
      isPosted: false,
      isPublic: true,
    },
  })

  if (z.weeklyUpdateApproval) {
    await notifyCommissioner(leagueId, 'weekly_resolution_complete', 'Weekly update ready', `Week ${week} update is ready to review and post.`, {
      week,
      relatedEventId: ann.id,
      relatedEventType: 'ZombieAnnouncement',
      requiresAction: true,
    })
    return
  }

  if (!z.weeklyUpdateAutoPost) return

  const lg = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (lg?.userId) {
    const meta: Record<string, unknown> = {
      senderIsHost: true,
      contentType: 'host_announcement',
      isPinned: true,
      zombieWeeklyUpdate: true,
      week,
    }
    if (z.bannerUrl) {
      meta.cardData = { type: 'banner_image', url: z.bannerUrl }
    }
    await prisma.leagueChatMessage.create({
      data: {
        leagueId,
        userId: lg.userId,
        message: body.slice(0, 100_000),
        type: 'host_announcement',
        metadata: toPrismaJsonInput(meta),
      },
    })
  }

  await prisma.zombieAnnouncement.update({
    where: { id: ann.id },
    data: { isPosted: true, postedAt: new Date() },
  })

  if (draft.meta.hordeSize - draft.meta.prevHordeSize >= 2) {
    const surv = await prisma.zombieLeagueTeam.count({ where: { leagueId, status: 'Survivor' } })
    const primaryUserId =
      z.commissionerId ??
      (await prisma.roster.findFirst({ where: { leagueId }, select: { platformUserId: true } }))?.platformUserId ??
      leagueId
    await queueAnimation(leagueId, week, 'horde_grows', primaryUserId, {
      hordeSize: draft.meta.hordeSize,
      survivorCount: surv,
    })
  }
}

/** Cron: post when UTC day/hour matches league schedule and resolution is complete. */
export async function scheduleWeeklyUpdate(leagueId: string): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z || z.weeklyUpdateDay == null || z.weeklyUpdateHour == null) return
  const now = new Date()
  if (now.getUTCDay() !== z.weeklyUpdateDay || now.getUTCHours() !== z.weeklyUpdateHour) return

  const week = Math.max(1, z.currentWeek || 1)
  const res = await getResolutionForWeek(z.id, week)
  if (res?.status !== 'complete') return
  if (!z.weeklyUpdateAutoPost || z.weeklyUpdateApproval) return

  const dup = await prisma.zombieAnnouncement.findFirst({
    where: { zombieLeagueId: z.id, week, type: 'weekly_update', isPosted: true },
  })
  if (dup) return

  const draft = await buildWeeklyUpdate(leagueId, week)
  await postWeeklyUpdate(leagueId, week, draft)
}

/** After resolution: post immediately when no day/hour schedule is set. */
export async function tryPostWeeklyUpdateAfterResolution(
  leagueId: string,
  week: number,
  zombieLeagueId: string,
): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
  if (!z || !z.weeklyUpdateAutoPost || z.weeklyUpdateApproval) return
  if (z.weeklyUpdateDay != null && z.weeklyUpdateHour != null) return

  const dup = await prisma.zombieAnnouncement.findFirst({
    where: { zombieLeagueId, week, type: 'weekly_update', isPosted: true },
  })
  if (dup) return

  const draft = await buildWeeklyUpdate(leagueId, week)
  await postWeeklyUpdate(leagueId, week, draft)
}
