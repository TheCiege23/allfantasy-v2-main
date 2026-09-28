import { prisma } from '@/lib/prisma'
import { setWhisperer } from '@/lib/zombie/ZombieOwnerStatusService'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { logAuditEntry } from '@/lib/zombie/auditService'
import { queueAnimation } from '@/lib/zombie/animationEngine'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export type AmbushResult = { ok: boolean; reason?: string; ambushesRemaining?: number }

export const WHISPERER_POWER_KEYS = [
  'power_horde_command',
  'power_dark_whisper',
  'power_infection_override',
  'power_mass_serum_burn',
] as const

type PowerEntry = { key: string; usesLeft: number }

function parseWhispererPowers(json: unknown): PowerEntry[] {
  if (!Array.isArray(json)) return []
  const out: PowerEntry[] = []
  for (const p of json) {
    if (p && typeof p === 'object' && 'key' in p) {
      const o = p as { key: string; usesLeft?: number }
      out.push({ key: String(o.key), usesLeft: typeof o.usesLeft === 'number' ? o.usesLeft : 0 })
    }
  }
  return out
}

export async function selectWhisperer(
  zombieLeagueId: string,
  mode: string,
  manualUserId?: string,
): Promise<{ whispererRecordId: string; rosterId: string }> {
  const z = await prisma.zombieLeague.findUniqueOrThrow({
    where: { id: zombieLeagueId },
    include: { league: true },
  })

  const leagueId = z.leagueId
  const allTeams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId } })
  if (allTeams.length === 0) throw new Error('No zombie team rows — run assignTeams / roster sync first.')
  /*
   * The Whisperer is a person. An open seat (`open-slot-…`) or an orphaned one (`orphan-…`) is a
   * roster nobody plays, and handing it the league's one special role would waste the season — so
   * the draw is among managed teams whenever there are any.
   */
  const managedIds = new Set(
    (await prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }))
      .filter((r) => r.platformUserId && !/^(open-slot-|orphan-)/.test(r.platformUserId))
      .map((r) => r.id),
  )
  const managedTeams = allTeams.filter((t) => managedIds.has(t.rosterId))
  const teams = managedTeams.length ? managedTeams : allTeams

  let pickRosterId: string | null = null

  if (mode === 'manual') {
    if (!manualUserId) throw new Error('manualUserId required for manual mode')
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: manualUserId },
    })
    if (!roster) throw new Error('User is not in this league')
    pickRosterId = roster.id
  } else if (mode === 'veteran_priority') {
    const vets = teams.filter((t) => t.isVeteran)
    const pool = vets.length ? vets : teams
    pickRosterId = shuffle(pool)[0]?.rosterId ?? null
  } else if (mode === 'horde_only') {
    const horde = teams.filter((t) => (t.status ?? '').toLowerCase().includes('zombie'))
    const pool = horde.length ? horde : teams
    pickRosterId = shuffle(pool)[0]?.rosterId ?? null
  } else {
    pickRosterId = shuffle(teams)[0]?.rosterId ?? null
  }

  if (!pickRosterId) throw new Error('Could not select Whisperer')

  const user = await prisma.roster.findUnique({
    where: { id: pickRosterId },
    select: { platformUserId: true },
  })
  const uid = user?.platformUserId ?? 'unknown'

  await setWhisperer(leagueId, pickRosterId)

  const displayName =
    (await prisma.appUser.findUnique({ where: { id: uid }, select: { displayName: true } }))?.displayName ??
    uid

  const amb = z.whispererAmbushCount ?? 3
  const rec = await prisma.whispererRecord.upsert({
    where: { zombieLeagueId },
    create: {
      zombieLeagueId,
      userId: uid,
      displayName,
      selectionMode: mode,
      ambushesGranted: amb,
      ambushesRemaining: amb,
      ambushesUsed: 0,
    },
    update: {
      userId: uid,
      displayName,
      selectionMode: mode,
      ambushesGranted: amb,
      ambushesRemaining: amb,
      ambushesUsed: 0,
    },
  })

  await prisma.zombieLeagueTeam.updateMany({
    where: { leagueId },
    data: { isWhisperer: false },
  })
  await prisma.zombieLeagueTeam.update({
    where: { leagueId_rosterId: { leagueId, rosterId: pickRosterId } },
    data: {
      isWhisperer: true,
      status: 'Whisperer',
      ambushesRemaining: amb,
    },
  })

  const title = z.whispererIsPublic ? 'The Whisperer has been chosen' : 'A Whisperer exists'
  const content = z.whispererIsPublic
    ? 'The Whisperer has been chosen. The infection begins.'
    : 'A Whisperer exists. Stay alert.'

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId,
      universeId: z.universeId,
      type: 'whisperer_reveal',
      title,
      content,
      isPublic: z.whispererIsPublic,
    },
  })

  await queueAnimation(
    leagueId,
    z.currentWeek ?? 1,
    'whisperer_selected',
    uid,
    { rosterId: pickRosterId },
    undefined,
    undefined,
    7000,
  ).catch(() => {})

  return { whispererRecordId: rec.id, rosterId: pickRosterId }
}

export async function applyAmbush(
  zombieLeagueId: string,
  whispererUserId: string,
  targetUserId: string,
  week: number,
  ambushType: string,
): Promise<AmbushResult> {
  const rec = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId } })
  if (!rec || rec.userId !== whispererUserId) return { ok: false, reason: 'Not the Whisperer' }
  if ((rec.ambushesRemaining ?? 0) <= 0) return { ok: false, reason: 'No ambushes remaining' }

  const z = await prisma.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
  if (!z) return { ok: false, reason: 'League not found' }

  const left = (rec.ambushesRemaining ?? 0) - 1
  await prisma.whispererRecord.update({
    where: { id: rec.id },
    data: {
      ambushesRemaining: left,
      ambushesUsed: (rec.ambushesUsed ?? 0) + 1,
    },
  })

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId,
      universeId: z.universeId,
      type: 'commissioner_note',
      title: `Ambush (${ambushType})`,
      content: `An ambush was resolved for week ${week}. Target roster obscured for audit.`,
      targetUserId,
      week,
    },
  })

  await logAuditEntry(zombieLeagueId, {
    category: 'ambush_use',
    action: 'AMBUSH_EXECUTED',
    description: `Ambush ${ambushType} executed for week ${week}.`,
    week,
    actorUserId: whispererUserId,
    targetUserId,
    actorRole: 'whisperer',
  }).catch(() => {})

  return { ok: true, ambushesRemaining: left }
}

export async function handleWhispererDefeat(
  zombieLeagueId: string,
  defeatedByUserId: string,
  week: number,
): Promise<void> {
  const rec = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId } })
  if (!rec) return

  await prisma.whispererRecord.update({
    where: { id: rec.id },
    data: {
      wasDefeated: true,
      defeatedAtWeek: week,
      defeatedByUserId,
    },
  })

  const rule = rec.postDefeatRule ?? 'commissioner_decides'
  const z = await prisma.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
  if (!z) return

  const leagueId = z.leagueId
  const oldWhispererRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: rec.userId },
  })

  async function demoteOldToZombie() {
    if (!oldWhispererRoster) return
    await prisma.zombieLeagueTeam.update({
      where: { leagueId_rosterId: { leagueId, rosterId: oldWhispererRoster.id } },
      data: { status: 'Zombie', isWhisperer: false },
    })
  }

  if (rule === 'new_whisperer_emerges') {
    const carry = Math.max(1, Math.floor((rec.ambushesRemaining ?? 0) / 2))
    await demoteOldToZombie()
    await selectWhisperer(zombieLeagueId, 'horde_only')
    const newRec = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId } })
    if (newRec) {
      await prisma.whispererRecord.update({
        where: { id: newRec.id },
        data: { ambushesGranted: carry, ambushesRemaining: carry },
      })
    }
    await prisma.zombieAnnouncement.create({
      data: {
        zombieLeagueId,
        universeId: z.universeId,
        type: 'whisperer_reveal',
        title: 'The Whisperer has fallen — a new one rises',
        content: 'The Whisperer has fallen — a new one rises from the Horde.',
        week,
      },
    })
    return
  }

  if (rule === 'whisperer_demoted_to_zombie') {
    await demoteOldToZombie()
    await prisma.zombieAnnouncement.create({
      data: {
        zombieLeagueId,
        universeId: z.universeId,
        type: 'horde_update',
        title: 'Whisperer cast down',
        content: 'The Whisperer joins the Horde. No successor is chosen.',
        week,
      },
    })
    return
  }

  if (rule === 'season_escalation') {
    await notifyCommissioner(
      leagueId,
      'new_whisperer_needed',
      'Season escalation',
      'Whisperer defeated — review immune week and horde surge options.',
      {
        urgency: 'critical',
        week,
        relatedUserId: rec.userId,
      },
    )
    await prisma.zombieAnnouncement.create({
      data: {
        zombieLeagueId,
        universeId: z.universeId,
        type: 'commissioner_note',
        title: 'The island escalates',
        content: 'The Whisperer endures under escalation rules. The Horde surges.',
        week,
      },
    })
    return
  }

  if (rule === 'commissioner_decides') {
    await notifyCommissioner(
      leagueId,
      'commissioner_override_required',
      'Whisperer defeat — decision needed',
      'Pause whisperer mechanics until the commissioner decides next steps.',
      {
        urgency: 'critical',
        requiresAction: true,
        week,
        relatedUserId: rec.userId,
      },
    )
    return
  }

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId,
      universeId: z.universeId,
      type: 'season_end',
      title: 'Whisperer defeated',
      content: `The Whisperer was defeated in week ${week}. Rule: ${rule}`,
      week,
    },
  })
}

export async function activateWhispererPower(
  leagueId: string,
  userId: string,
  powerKey: string,
  _rawMessage: string,
): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')
  const rec = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } })
  if (!rec || rec.userId !== userId) throw new Error('Not the Whisperer')

  const defaults: Record<string, number> = {
    power_horde_command: 1,
    power_dark_whisper: 2,
    power_infection_override: 1,
    power_mass_serum_burn: 1,
  }

  const powers = parseWhispererPowers(rec.activePowers)
  let entry = powers.find((p) => p.key === powerKey)
  if (!entry) {
    const u = defaults[powerKey] ?? 0
    if (u <= 0) throw new Error('Unknown power')
    entry = { key: powerKey, usesLeft: u }
    powers.push(entry)
  }
  if (entry.usesLeft <= 0) throw new Error('No uses left for this power')
  entry.usesLeft -= 1

  await prisma.whispererRecord.update({
    where: { id: rec.id },
    data: { activePowers: powers },
  })

  await notifyCommissioner(leagueId, 'ambush_used', `Whisperer power: ${powerKey}`, `Activated (week ${z.currentWeek}).`, {
    urgency: 'high',
    relatedUserId: userId,
    week: z.currentWeek || null,
  })

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId: z.id,
      universeId: z.universeId,
      type: 'commissioner_note',
      title: 'Whisperer power',
      content: `Power ${powerKey} resonates across the island.`,
      week: z.currentWeek || 1,
    },
  })
}
