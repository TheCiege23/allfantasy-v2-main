import { createHash } from 'node:crypto'
import { betaItemBonus, itemRole, planBetaItemSettlement, WEAPON_LABELS, type ItemWeekMatchup } from './beta2025Items'
import { computeBeta2025Winnings } from './beta2025Winnings'
import { betaCombatKind } from './beta2025CombatPolicy'
import type { ZombieSettlementSnapshotV1 as Snapshot } from './weeklySettlementSnapshot'

type Team = Snapshot['teams'][number]
export type ReplayItem = Snapshot['items'][number] & { acquiredReason?: string | null }
export type ReplayWhisperer = NonNullable<Snapshot['whisperer']> & { userId: string; displayName: string }
export type RecordedChoice = { id: string; week: number | null; kind: string; actorUserId: string | null; targetUserId: string | null;
  status: string; decision: string | null; deadlineAt: string | null; state: unknown; decidedAt: string | null; decidedByUserId: string | null }
export type ReplayChoice = { id: string; kind: string; actorUserId: string; targetUserId: string; winnerRosterId: string; loserRosterId: string;
  decision: string | null; deadlineAt: string; status: 'pending' | 'complete'; retained: boolean; remaining: number; granted: number; used: number; revived: boolean }
export type CorrectionWeekInput = { week: number; snapshot: Snapshot; matches: ItemWeekMatchup[]; deadlineAt: string; settledAt: string; preserveBonus?: boolean }
export type ReplayWeek = { week: number; snapshot: Snapshot; matches: ItemWeekMatchup[]; items: ReplayItem[]; teams: Team[];
  whisperer: ReplayWhisperer | null; choices: ReplayChoice[]; infections: Array<{ victimRosterId: string; infectorRosterId: string; matchupId: string }>;
  distribution: Record<string, number>; totals: Record<string, number>; itemEvents: object }
export type CorrectionPlan = { policy: 'beta_2025'; blockers: string[]; weeks: ReplayWeek[]; original: ReplayWeek[];
  summary: Array<{ week: number; scoreChanges: number; roleChanges: number; itemChanges: number; winningsChanges: number; retainedChoices: number; newChoices: number }> }

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const round = (n: number) => Math.round(n * 100) / 100
export function stableCorrectionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCorrectionJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableCorrectionJson(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const correctionHash = (value: unknown) => createHash('sha256').update(stableCorrectionJson(value)).digest('hex')
export function correctionStateShape(teams: readonly Team[], items: readonly ReplayItem[], whisperer?: ReplayWhisperer | null) {
  return { teams: teams.map(t => ({ ...t, revivedAt: Boolean(t.revivedAt) })).sort((a, b) => a.id.localeCompare(b.id)),
    items: items.map(i => ({ id: i.id, teamStatusId: i.teamStatusId, userId: i.userId, itemType: i.itemType, isUsed: i.isUsed,
      isExpired: i.isExpired, activationState: i.activationState, activatesAtWeek: i.activatesAtWeek, usedAtWeek: i.usedAtWeek,
      usedEffect: i.usedEffect, usedOnUserId: i.usedOnUserId, acquiredAtWeek: i.acquiredAtWeek, awardKey: i.awardKey })).sort((a, b) => a.id.localeCompare(b.id)),
    whisperer: whisperer ? { userId: whisperer.userId, ambushesRemaining: whisperer.ambushesRemaining, ambushesUsed: whisperer.ambushesUsed, wasDefeated: whisperer.wasDefeated } : null }
}

function whispererFrom(snapshot: Snapshot, fallbackUser: string): ReplayWhisperer | null {
  if (!snapshot.whisperer) return null
  const roster = snapshot.teams.find(t => t.status === 'Whisperer')?.rosterId
  const userId = snapshot.whisperer.userId ?? snapshot.owners.find(o => o.rosterId === roster)?.userId ?? fallbackUser
  if (!userId) throw new Error('The pre-week Whisperer identity is unavailable; historical membership needs review.')
  return { ...snapshot.whisperer, userId, displayName: snapshot.whisperer.displayName ?? 'Whisperer' }
}

function replay(input: { zombieLeagueId: string; week: CorrectionWeekInput; choices: RecordedChoice[]; catalog: ReplayItem[];
  fallbackWhispererUser: string; now: string; original: boolean }): ReplayWeek {
  const { week, snapshot, deadlineAt } = input.week
  if (snapshot.itemsPolicy !== 'beta_2025' || !snapshot.itemMatchups || !snapshot.winnings) throw new Error('A complete sealed 2025 snapshot is required.')
  const teams = copy(snapshot.teams), items: ReplayItem[] = copy(snapshot.items)
  const byRoster = (id: string) => { const t = teams.find(t => t.rosterId === id); if (!t) throw new Error('A matchup roster is absent from the snapshot.'); return t }
  const owner = (id: string) => { const user = snapshot.owners.find(o => o.rosterId === id)?.userId; if (!user) throw new Error('A registered pre-week owner is required.'); return user }
  let whisperer = whispererFrom(snapshot, input.fallbackWhispererUser)
  const matches = input.original ? copy(snapshot.itemMatchups) : input.week.matches.map(m => {
    if (input.week.preserveBonus) return { ...m }
    // The first replayed slate carries its original consumed/frozen item receipt. Later
    // slates receive a rebuilt receipt from the corrected inventory before games begin.
    const h = betaItemBonus(m.homeRosterId, byRoster(m.homeRosterId).status, items.filter(i => i.teamStatusId === byRoster(m.homeRosterId).id), week, snapshot.itemWeaponsEnabled)
    const a = betaItemBonus(m.awayRosterId, byRoster(m.awayRosterId).status, items.filter(i => i.teamStatusId === byRoster(m.awayRosterId).id), week, snapshot.itemWeaponsEnabled)
    return { ...m, homeScore: round(m.homeBaseScore + h.bonus), awayScore: round(m.awayBaseScore + a.bonus), homeWeaponBonus: h.weaponBonus, awayWeaponBonus: a.weaponBonus }
  })
  const context = { policy: 'beta_2025' as const, openingByRoster: snapshot.winnings.openingByRoster,
    statusByRoster: Object.fromEntries(snapshot.teams.map(t => [t.rosterId, t.status])) }
  const winnings = computeBeta2025Winnings(matches.map(m => ({ ...m, final: true })), context, snapshot.rules)
  const infections: ReplayWeek['infections'] = []
  for (const m of matches) {
    if (m.homeScore === m.awayScore) continue
    const win = byRoster(m.homeScore > m.awayScore ? m.homeRosterId : m.awayRosterId), lose = byRoster(win.rosterId === m.homeRosterId ? m.awayRosterId : m.homeRosterId)
    const infects = win.status === 'Zombie' ? snapshot.config?.infectionLossToZombie : win.status === 'Whisperer' && snapshot.config?.infectionLossToWhisperer
    if (itemRole(lose.status) === 'Survivor' && infects) {
      Object.assign(lose, { status: 'Zombie', weekBecameZombie: week, killedByRosterId: win.rosterId, revivedAt: null })
      infections.push({ victimRosterId: lose.rosterId, infectorRosterId: win.rosterId, matchupId: m.matchupId })
    }
  }
  const loot = planBetaItemSettlement({ week, matchups: matches, teams: snapshot.teams, items: snapshot.items, openingByRoster: context.openingByRoster,
    ...snapshot.rules, weaponsEnabled: snapshot.itemWeaponsEnabled === true, highScoreEnabled: snapshot.config?.serumAwardHighScore !== false,
    combatSerumsEnabled: snapshot.config?.serumAwardOnBashMaul !== false })
  for (const move of loot.transfers) {
    const i = items.find(i => i.id === move.itemId)!
    Object.assign(i, { teamStatusId: byRoster(move.toRosterId).id, userId: owner(move.toRosterId), acquiredReason: `loot_week_${week}`, activatesAtWeek: week + 1, activationState: 'ready' })
  }
  for (const award of loot.awards) {
    const awardKey = `item2025:${input.zombieLeagueId}:${week}:${award.reason}:${award.rosterId}`
    const old = input.catalog.find(i => i.awardKey === awardKey)
    items.push({ id: old?.id ?? `correction-${correctionHash(awardKey).slice(0, 40)}`, awardKey, teamStatusId: byRoster(award.rosterId).id,
      userId: owner(award.rosterId), itemType: award.itemType, itemLabel: WEAPON_LABELS[award.itemType] ?? '🧪 Serum', acquiredAtWeek: week,
      acquiredReason: award.reason, activatesAtWeek: week + 1, activationState: 'ready', isUsed: false, isExpired: false, usedAtWeek: null, usedOnUserId: null, usedEffect: null })
  }
  const revivedRosterIds: string[] = []
  for (const t of teams) {
    if (t.status !== 'Zombie' || t.weekBecameZombie === week || t.killedAtWeek === week) continue
    const serums = items.filter(i => i.teamStatusId === t.id && i.itemType.includes('serum') && !i.isUsed && !i.isExpired && i.activationState === 'ready').sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2)
    if (serums.length !== 2) continue
    serums.forEach(i => Object.assign(i, { isUsed: true, usedAtWeek: week, usedEffect: 'beta2025_revive' }))
    Object.assign(t, { status: 'Survivor', revivedAt: input.week.settledAt, weekBecameZombie: null, killedByRosterId: null, isWhisperer: false })
    revivedRosterIds.push(t.rosterId)
  }
  const choices: ReplayChoice[] = []
  for (const m of matches) {
    if (m.homeScore === m.awayScore) continue
    const winner = snapshot.teams.find(t => t.rosterId === (m.homeScore > m.awayScore ? m.homeRosterId : m.awayRosterId))!
    const loser = snapshot.teams.find(t => t.rosterId === (winner.rosterId === m.homeRosterId ? m.awayRosterId : m.homeRosterId))!
    const kind = betaCombatKind(itemRole(winner.status), itemRole(loser.status), Math.abs(m.homeScore - m.awayScore))
    if (!kind) continue
    const actor = owner(winner.rosterId), target = owner(loser.rosterId), revived = revivedRosterIds.includes(winner.rosterId)
    const saved = input.choices.find(c => { const s = c.state as { winnerRosterId?: string; loserRosterId?: string }; return c.week === week && c.kind === kind && c.actorUserId === actor && c.targetUserId === target && s?.winnerRosterId === winner.rosterId && s?.loserRosterId === loser.rosterId })
    const completed = saved?.status === 'complete' && saved.decision
    const eligible = kind !== 'whisperer_maul' || revived
    const allowed = kind === 'survivor_bash' ? ['spare', 'infect'] : kind === 'whisperer_bash' ? ['spare', 'replace'] : ['decline', 'become_whisperer', 'no_successor']
    const retained = Boolean(completed && allowed.includes(saved!.decision!) && (kind !== 'whisperer_maul' || revived || saved!.decision === 'no_successor'))
    let decision = retained ? saved!.decision : !eligible ? 'no_successor' : deadlineAt <= input.now ? kind === 'whisperer_maul' ? 'decline' : 'spare' : null
    if (input.original && saved?.status === 'pending') decision = null
    if (kind === 'whisperer_maul' && !eligible) decision = 'no_successor'
    const budget = { remaining: whisperer?.ambushesRemaining ?? 0, granted: whisperer?.ambushesGranted ?? 0, used: whisperer?.ambushesUsed ?? 0 }
    const fallen = () => {
      if (!whisperer || whisperer.userId !== target || whisperer.wasDefeated) throw new Error('Whisperer succession has conflicting historical identity.')
      Object.assign(byRoster(loser.rosterId), { status: 'Zombie', isWhisperer: false, weekBecameZombie: week, killedAtWeek: week,
        killedByRosterId: winner.rosterId, killedByUserId: actor, revivedAt: null, ambushesRemaining: 0 })
      Object.assign(whisperer, { wasDefeated: true, defeatedAtWeek: week, defeatedByUserId: actor, ambushesRemaining: 0 })
    }
    if (kind === 'whisperer_maul') fallen()
    if (decision === 'infect') Object.assign(byRoster(loser.rosterId), { status: 'Zombie', isWhisperer: false, weekBecameZombie: week, killedAtWeek: week, killedByRosterId: winner.rosterId, killedByUserId: actor, revivedAt: null })
    if (decision === 'replace' || decision === 'become_whisperer') {
      if (byRoster(winner.rosterId).status !== 'Survivor') throw new Error('A prior manager choice is no longer eligible.')
      if (decision === 'replace') fallen()
      Object.assign(byRoster(winner.rosterId), { status: 'Whisperer', isWhisperer: true, weekBecameZombie: null, killedAtWeek: null, killedByRosterId: null,
        killedByUserId: null, revivedAt: null, ambushesRemaining: budget.remaining, ambushesUsed: budget.used })
      whisperer = { ...whisperer!, userId: actor, displayName: 'Whisperer', wasDefeated: false, defeatedAtWeek: null, defeatedByUserId: null,
        ambushesRemaining: budget.remaining, ambushesGranted: budget.granted, ambushesUsed: budget.used }
    }
    choices.push({ id: `choice:${input.zombieLeagueId}:${week}:${m.matchupId}`, kind, actorUserId: actor, targetUserId: target,
      winnerRosterId: winner.rosterId, loserRosterId: loser.rosterId, decision, deadlineAt, status: decision ? 'complete' : 'pending', retained,
      ...budget, revived })
  }
  if (whisperer) whisperer.hordeSizeAtPeak = Math.max(whisperer.hordeSizeAtPeak, teams.filter(t => t.status === 'Zombie').length)
  const distribution = Object.fromEntries(winnings.netByRoster)
  const totals = Object.fromEntries(Object.entries(context.openingByRoster).map(([id, n]) => [id, round(n + (distribution[id] ?? 0))]))
  return { week, snapshot: { ...copy(snapshot), itemMatchups: matches }, matches, teams, items, whisperer, infections, choices, distribution, totals,
    itemEvents: { policy: 'beta_2025', complete: true, ...loot, revivedRosterIds } }
}

/** Pure, bounded replay of the affected settled range; unsupported intervening actions are explicit holds. */
export function planBetaCorrection(input: { zombieLeagueId: string; weeks: CorrectionWeekInput[]; choices: RecordedChoice[]; catalog: ReplayItem[]; fallbackWhispererUser: string; now: string }): CorrectionPlan {
  const plan: CorrectionPlan = { policy: 'beta_2025', blockers: [], weeks: [], original: [], summary: [] }
  if (!input.weeks.length || input.weeks.length > 18) return { ...plan, blockers: ['Choose a saved NFL scoring range of at most 18 periods.'] }
  try {
    for (const [index, row] of input.weeks.entries()) {
      let correctedSnapshot = copy(row.snapshot)
      if (index) {
        const originalPrior = plan.original[index - 1], correctedPrior = plan.weeks[index - 1]
        const oldWhisperer = whispererFrom(row.snapshot, input.fallbackWhispererUser)
        // This proof refuses to erase trades, item consumption, overrides or ambushes
        // between settlements. Their effects must be reviewed before a replay can land.
        if (stableCorrectionJson(correctionStateShape(originalPrior.teams, originalPrior.items, originalPrior.whisperer)) !== stableCorrectionJson(correctionStateShape(row.snapshot.teams, row.snapshot.items, oldWhisperer))) {
          throw new Error(`Week ${row.week} has intervening manager actions or a changed inventory/role checkpoint. Resolve those dependencies before replaying it.`)
        }
        if (correctedPrior.choices.some(c => c.status === 'pending')) throw new Error(`Week ${originalPrior.week} has an unanswered corrected combat choice before a dependent settled week.`)
        correctedSnapshot = { ...correctedSnapshot, teams: copy(correctedPrior.teams), items: copy(correctedPrior.items), whisperer: copy(correctedPrior.whisperer),
          winnings: { policy: 'beta_2025', openingByRoster: correctedPrior.totals } }
      }
      const original = replay({ ...input, week: row, original: true })
      const corrected = replay({ ...input, week: { ...row, snapshot: correctedSnapshot, preserveBonus: index === 0 }, original: false })
      plan.original.push(original); plan.weeks.push(corrected)
      plan.summary.push({ week: row.week, scoreChanges: corrected.matches.filter(m => { const old = original.matches.find(o => o.matchupId === m.matchupId); return m.homeScore !== old?.homeScore || m.awayScore !== old?.awayScore }).length,
        roleChanges: corrected.teams.filter(t => original.teams.find(o => o.id === t.id)?.status !== t.status).length,
        itemChanges: new Set([...original.items, ...corrected.items].filter(i => { const a = original.items.find(o => o.id === i.id), b = corrected.items.find(o => o.id === i.id); return stableCorrectionJson(a) !== stableCorrectionJson(b) }).map(i => i.id)).size,
        winningsChanges: Object.keys(corrected.distribution).filter(id => corrected.distribution[id] !== original.distribution[id]).length,
        retainedChoices: corrected.choices.filter(c => c.retained).length, newChoices: corrected.choices.filter(c => !c.retained).length })
    }
  } catch (error) { plan.blockers.push(error instanceof Error ? error.message : 'The correction history requires review.') }
  return plan
}
