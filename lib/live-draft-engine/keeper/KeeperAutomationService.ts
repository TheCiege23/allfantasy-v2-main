import { prisma } from '@/lib/prisma'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { buildKeeperLocks } from './KeeperDraftOrder'
import { validateRosterKeeperSelections } from './KeeperRuleEngine'
import type { KeeperConfig, KeeperSelection } from './types'
import type { SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type KeeperAutomationAction = {
  type: 'auto_keeper_pick'
  rosterId: string
  playerName: string
  round: number
  slot: number
}

export type KeeperAutomationTickResult = {
  changed: boolean
  actions: KeeperAutomationAction[]
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export async function runKeeperAutomationTick(leagueId: string): Promise<KeeperAutomationTickResult> {
  const actions: KeeperAutomationAction[] = []
  let changed = false

  for (let guard = 0; guard < 200; guard += 1) {
    const session = await prisma.draftSession.findFirst({
      where: { leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      include: { picks: { orderBy: { overall: 'asc' } } },
    })
    if (!session || session.status !== 'in_progress' || session.draftType === 'auction') break

    const keeperConfig = (session.keeperConfig ?? (session as any).keeperConfig) as KeeperConfig | null
    const keeperSelections = (session.keeperSelections ?? (session as any).keeperSelections) as KeeperSelection[] | null
    const selections = Array.isArray(keeperSelections) ? keeperSelections : []
    if (!keeperConfig || keeperConfig.maxKeepers <= 0 || selections.length === 0) break

    const valid = validateRosterKeeperSelections(keeperConfig, selections, session.rounds)
    if (!valid.valid) break

    const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
    const tradedPicks = Array.isArray(session.tradedPicks)
      ? (session.tradedPicks as unknown as TradedPickRecord[])
      : []

    const locks = buildKeeperLocks(
      selections,
      slotOrder,
      tradedPicks,
      session.teamCount,
      session.rounds,
      session.draftType as 'snake' | 'linear' | 'auction',
      session.thirdRoundReversal
    )
    if (!locks.length) break

    const picksByRoundSlot = new Map(session.picks.map((p) => [`${p.round}-${p.slot}`, p]))
    const picksByName = new Set(
      session.picks.filter((p) => !isDraftPickRowEmpty(p)).map((p) => normalizeName(p.playerName)),
    )

    const progressPicks = session.picks.map((p) => ({
      overall: p.overall,
      playerName: p.playerName,
      position: p.position,
      pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
    }))
    const current = resolveCurrentOnTheClock({
      totalPicks: session.rounds * session.teamCount,
      picks: progressPicks,
      teamCount: session.teamCount,
      draftType: session.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder,
    })
    if (!current) break

    const lock = locks.find((item) => item.round === current.round && item.slot === current.slot)
    if (!lock) break

    const existingForSlot = picksByRoundSlot.get(`${current.round}-${current.slot}`)
    if (existingForSlot && !isDraftPickRowEmpty(existingForSlot)) break
    if (picksByName.has(normalizeName(lock.playerName))) break

    const pick = await submitPick({
      leagueId,
      playerName: lock.playerName,
      position: lock.position,
      team: lock.team,
      playerId: lock.playerId,
      rosterId: lock.rosterId,
      source: 'keeper',
    })
    if (!pick.success) break

    changed = true
    actions.push({
      type: 'auto_keeper_pick',
      rosterId: lock.rosterId,
      playerName: lock.playerName,
      round: lock.round,
      slot: lock.slot,
    })
  }

  return { changed, actions }
}
