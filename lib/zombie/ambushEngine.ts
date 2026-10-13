import { prisma } from '@/lib/prisma'
import { getZombieRulesForLeague } from '@/lib/zombie/zombieRules'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { appendZombieAudit } from '@/lib/zombie/ZombieAuditLog'
import { applyAmbush } from '@/lib/zombie/whispererEngine'
import { queueAnimation } from '@/lib/zombie/animationEngine'

function parseAmbush(raw: string): { type: string; targetUserId?: string } | null {
  const lower = raw.toLowerCase()
  if (!lower.includes('@chimmy') || !lower.includes('ambush')) return null
  if (lower.includes('horde') && lower.includes('boost')) return { type: 'horde_boost' }
  if (lower.includes('swap')) return { type: 'swap_matchup' }
  if (lower.includes('steal')) return { type: 'steal_winnings' }
  if (lower.includes('intel')) return { type: 'intel_gather' }
  if (lower.includes('drop')) return { type: 'force_item_drop' }
  return { type: 'steal_winnings' }
}

export async function validateAmbushTiming(
  leagueId: string,
  week: number,
  sport: string,
): Promise<{ valid: boolean; reason?: string }> {
  const rules = await getZombieRulesForLeague(leagueId, sport)
  // Deterministic placeholder: integrate live kickoff feed per sport using `rules.lineupLockDesc`.
  void week
  return { valid: true, reason: rules.lineupLockDesc ?? undefined }
}

/**
 * Full @Chimmy ambush workflow — creates audit rows, commissioner ping, executes core ambush ledger.
 */
export async function processAmbushFromChimmy(
  leagueId: string,
  whispererUserId: string,
  rawMessage: string,
  week: number,
) {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')

  const rec = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } })
  const log = await prisma.zombieChimmyAction.create({
    data: {
      leagueId,
      userId: whispererUserId,
      week,
      actionType: 'ambush_invoke',
      rawMessage,
      isValid: false,
    },
  })

  if (!rec || rec.userId !== whispererUserId) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        isValid: false,
        validationError: 'not_whisperer',
        privateResponse: '⚠️ Only the Whisperer may invoke an ambush.',
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  if ((rec.ambushesRemaining ?? 0) <= 0) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        validationError: 'no_ambushes',
        privateResponse: '⚠️ No ambushes remaining this season.',
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const parsed = parseAmbush(rawMessage)
  if (!parsed) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        validationError: 'parse_failed',
        privateResponse: '⚠️ Try: @Chimmy ambush steal, @Chimmy ambush horde boost, etc.',
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const timing = await validateAmbushTiming(leagueId, week, z.sport)
  if (!timing.valid) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        validationError: timing.reason ?? 'timing',
        privateResponse: `⚠️ That ambush cannot be used right now. ${timing.reason ?? ''}`,
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const dup = await prisma.zombieAmbushAction.findFirst({
    where: { zombieLeagueId: z.id, week, whispererUserId, status: { in: ['pending', 'validated', 'executed'] } },
  })
  if (dup) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        validationError: 'duplicate_week',
        privateResponse: '⚠️ An ambush is already recorded for this week.',
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const action = await prisma.zombieAmbushAction.create({
    data: {
      zombieLeagueId: z.id,
      week,
      whispererUserId,
      ambushType: parsed.type,
      targetUserId: parsed.targetUserId ?? null,
      status: 'validated',
      validationResult: 'ok',
      submittedViaChimmy: true,
    },
  })

  await prisma.zombieChimmyAction.update({
    where: { id: log.id },
    data: {
      isValid: true,
      parsedAction: parsed as object,
      publicResponse: '🔴 The Whisperer has activated. The horde shifts.',
      privateResponse: `Ambush (${parsed.type}) registered for week ${week}.`,
      effect: { ambushActionId: action.id },
    },
  })

  await notifyCommissioner(leagueId, 'ambush_used', `Whisperer ambush (week ${week})`, `${parsed.type}`, {
    urgency: 'high',
    week,
    relatedUserId: whispererUserId,
    relatedEventId: action.id,
    relatedEventType: 'ZombieAmbushAction',
  })

  if (parsed.targetUserId) {
    await applyAmbush(z.id, whispererUserId, parsed.targetUserId, week, parsed.type)
  } else {
    const r = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: z.id } })
    if (r) {
      const left = Math.max(0, (r.ambushesRemaining ?? 0) - 1)
      await prisma.whispererRecord.update({
        where: { id: r.id },
        data: {
          ambushesRemaining: left,
          ambushesUsed: (r.ambushesUsed ?? 0) + 1,
        },
      })
    }
  }

  await prisma.zombieAmbushAction.update({
    where: { id: action.id },
    data: { status: 'executed', executedAt: new Date(), commissionerNotifiedAt: new Date() },
  })

  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId: z.id,
      universeId: z.universeId,
      type: 'horde_update',
      title: 'The island shifts',
      content:
        '⚠️ Something has changed this week. Check your matchup. The infection spreads.',
      week,
    },
  })

  await appendZombieAudit({
    leagueId,
    zombieLeagueId: z.id,
    universeId: z.universeId,
    eventType: 'ambush_use',
    metadata: { week, ambushType: parsed.type, actionId: action.id },
  })

  await queueAnimation(leagueId, week, 'ambush_triggered', whispererUserId, {
    ambushType: parsed.type,
    ambushActionId: action.id,
  }).catch(() => {})

  return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
}
