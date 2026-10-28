import { prisma } from '@/lib/prisma'

/**
 * Read-only proof of one immediate pickup, optionally with one specified drop. These are the same gates
 * used by the add/drop route. A competitive pending claim is never proof that
 * this manager could have acquired the player. Any unreadable gate fails closed.
 */
export async function certifyPirateWaiverWitness(input: {
  leagueId: string; rosterId: string; actorUserId: string; playerId: string; dropPlayerId?: string | null; now?: Date
}): Promise<boolean> {
  try {
    // The transaction validator loads the specialty registry, which also
    // registers Pirate League. Load it only for an actual candidate, after
    // module initialization, to avoid a registry/service import cycle.
    const [action, transactions, settingsService, phaseService, dailyService, unlock, afterRunService, holds, eligibility] = await Promise.all([
      import('@/server/services/leagueActionGate'), import('@/lib/roster-legality/rosterTransactionGates'),
      import('@/lib/waiver-wire/settings-service'), import('@/lib/waiver-wire/season-phase-gate'),
      import('@/lib/waiver-wire/daily-schedule-gate'), import('@/lib/waiver-wire/free-agent-unlock'),
      import('@/lib/waiver-wire/after-run-free-agency'), import('@/lib/waiver-wire/dropped-player-waivers'),
      import('@/lib/waiver-wire/transaction-eligibility'),
    ])
    const now = input.now ?? new Date()
    const phase = await phaseService.loadWaiverPhasePolicy(input.leagueId, input.rosterId)
    if (!phase.immediateAddsAllowed) return false
    const gate = await action.assertLeagueActionGate(input.leagueId, input.actorUserId, 'waiver_claim_submit', {
      rosterMove: 'free_agent_pickup', ...(phase.firstComeAdds ? { offseasonFreeAgency: true } : {}),
    })
    if (!gate.ok) return false
    const legal = await transactions.assertRosterTransactionsAllowed({ leagueId: input.leagueId, rosterIds: [input.rosterId],
      userId: input.actorUserId, kind: 'waiver_claim' })
    if (!legal.ok) return false
    const [settings, state, pending] = await Promise.all([
      settingsService.getEffectiveLeagueWaiverSettings(input.leagueId),
      prisma.leagueWaiverState.findUnique({ where: { leagueId: input.leagueId }, select: { processingLocked: true } }),
      prisma.waiverClaim.findFirst({ where: { leagueId: input.leagueId, addPlayerId: input.playerId, status: 'pending' }, select: { id: true } }),
    ])
    if (state?.processingLocked || pending) return false
    if (!phase.firstComeAdds) {
      const daily = await dailyService.loadDailyTransactionPolicy(input.leagueId, now)
      const afterRun = settings.freeAgencyMode === 'after_run' && settings.normalizedWaiverType !== 'fcfs'
      if (daily) {
        if (!daily.policy.immediateAddsAllowed || await dailyService.dailyScheduleImmediateAddRefusal(input.leagueId, daily, input.playerId, now)) return false
      } else if (afterRun) {
        const status = await afterRunService.loadAfterRunFreeAgencyState(input.leagueId, input.playerId, {
          processingDayOfWeek: settings.processingDayOfWeek, processingTimeUtc: settings.processingTimeUtc, processingDays: settings.processingDays,
        }, now)
        if (afterRunService.afterRunRefusalMessage(status)) return false
      } else if (settings.normalizedWaiverType !== 'fcfs' && settings.instantFaAfterClear !== true) {
        if (!unlock.isDailyFreeAgentUnlock(settings.freeAgentUnlockBehavior) || await dailyService.dailyUnlockImmediateAddRefusal(input.leagueId, input.playerId, now)) return false
      }
      // Repeat the hold read without the daily screen's soft failure fallback:
      // a failed lookup can never become evidence for forfeiting protections.
      if (daily || settings.normalizedWaiverType !== 'fcfs') {
        const policy = await holds.loadDroppedPlayerHoldPolicy(input.leagueId, settings)
        if (await holds.loadDroppedPlayerHold(input.leagueId, input.playerId, policy, now)) return false
      }
    }
    await eligibility.assertWaiverClaimEligibility({ leagueId: input.leagueId, rosterId: input.rosterId,
      addPlayerId: input.playerId, dropPlayerId: input.dropPlayerId ?? null, faabBid: null, claimMetadata: { source: 'free_agent_immediate' },
      ...(phase.firstComeAdds ? { offseasonFreeAgency: true } : {}) })
    return true
  } catch {
    return false
  }
}
