import type { Prisma } from '@prisma/client'
import { queueAnimationIn } from './animationEngine'
import { WEAPON_LABELS, type ItemWeekMatchup } from './beta2025Items'

type Tx = Prisma.TransactionClient

/**
 * The on-screen moments of a 2025-rules week that have no video: maulings, bombs and weapons.
 * They play as an animated card (`clipType: 'card'`, see `zombieClipForAnimation`) and are queued on the
 * settlement's own transaction, so a week that rolls back takes its moments with it.
 *
 * Bombs show at SETTLEMENT, not when the manager uses one: a bomb is a secret until the week is played.
 */

/** Each roster's team name for the cards, read once. A missing name reads "A team". */
export async function zombieTeamNames(tx: Tx, leagueId: string): Promise<Map<string, string>> {
  const rows = await tx.zombieLeagueTeam.findMany({
    where: { leagueId },
    select: { rosterId: true, fantasyTeamName: true, displayName: true },
  })
  return new Map(rows.map((r) => [r.rosterId, r.fantasyTeamName || r.displayName || 'A team']))
}

const points = (n: number) => `${Math.round(n * 100) / 100}`

export function maulingMoment(input: { winner: string; loser: string; margin: number }) {
  return { icon: '🧟', title: 'Mauled', detail: `${input.winner} mauled ${input.loser} by ${points(input.margin)} points.`, anim: 'mauling', displayMode: 'fullscreen' as const }
}

export function bashingDetail(input: { winner: string; loser: string; margin: number }) {
  return `${input.winner} bashed ${input.loser} by ${points(input.margin)} points.`
}

type SettlementInput = {
  leagueId: string
  week: number
  matchups: readonly ItemWeekMatchup[]
  teams: ReadonlyArray<{ id: string; rosterId: string }>
  owners: ReadonlyArray<{ rosterId: string; userId: string | null }>
  items: ReadonlyArray<{ id: string; teamStatusId: string; itemType: string; usedAtWeek?: number | null; usedEffect?: string | null }>
  transfers: ReadonlyArray<{ itemId: string; fromRosterId: string; toRosterId: string }>
}

/** What to show for this week's bombs, deciding weapons and stolen weapons. Pure: the queueing is below. */
export function planItemMoments(input: SettlementInput, names: ReadonlyMap<string, string>) {
  const owner = (rosterId: string) => input.owners.find((o) => o.rosterId === rosterId)?.userId ?? null
  const rosterOfTeam = (teamId: string) => input.teams.find((t) => t.id === teamId)?.rosterId ?? null
  const name = (rosterId: string) => names.get(rosterId) ?? 'A team'
  const moments: Array<{ type: string; primary: string; secondary: string | null; meta: Record<string, unknown>; durationMs: number }> = []

  const bombRosters = new Set<string>()
  for (const item of input.items) {
    if (item.usedEffect !== 'beta2025_bomb_35' || item.usedAtWeek !== input.week) continue
    const rosterId = rosterOfTeam(item.teamStatusId)
    const userId = rosterId ? owner(rosterId) : null
    if (!rosterId || !userId) continue
    bombRosters.add(rosterId)
    moments.push({ type: 'bomb_detonated', primary: userId, secondary: null, durationMs: 6000,
      meta: { icon: '💣', title: 'Bomb!', detail: `${name(rosterId)} set off a bomb: +35 points this week.`, anim: 'bomb', displayMode: 'fullscreen', itemId: item.id, policy: 'beta_2025' } })
  }

  for (const m of input.matchups) {
    if (m.homeScore === m.awayScore) continue
    const homeWon = m.homeScore > m.awayScore
    const win = homeWon ? m.homeRosterId : m.awayRosterId
    const lose = homeWon ? m.awayRosterId : m.homeRosterId
    const bonus = homeWon ? m.homeWeaponBonus : m.awayWeaponBonus
    const winScore = homeWon ? m.homeScore : m.awayScore
    const loseScore = homeWon ? m.awayScore : m.homeScore
    // Only a weapon that DECIDED the result: without its bonus the winner would not have won. A bomb has its own moment.
    if (bonus <= 0 || bombRosters.has(win) || winScore - bonus > loseScore) continue
    const userId = owner(win)
    if (!userId) continue
    moments.push({ type: 'weapon_used', primary: userId, secondary: owner(lose), durationMs: 5000,
      meta: { icon: '⚔️', title: 'Weapons won it', detail: `${name(win)} beat ${name(lose)} by ${points(winScore - loseScore)}. Weapons added +${points(bonus)}.`, anim: 'weapon', displayMode: 'inline', matchupId: m.matchupId, policy: 'beta_2025' } })
  }

  for (const t of input.transfers) {
    const item = input.items.find((i) => i.id === t.itemId)
    if (!item || !item.itemType.startsWith('weapon_')) continue
    const userId = owner(t.toRosterId)
    if (!userId) continue
    const label = WEAPON_LABELS[item.itemType] ?? 'a weapon'
    // The card shows the weapon itself: "🔫 Gun" → 🔫.
    const icon = WEAPON_LABELS[item.itemType]?.split(' ')[0] ?? '⚔️'
    moments.push({ type: 'weapon_stolen', primary: userId, secondary: owner(t.fromRosterId), durationMs: 5000,
      meta: { icon, title: 'Weapon taken', detail: `${name(t.toRosterId)} took ${label} from ${name(t.fromRosterId)}.`, anim: 'weapon', displayMode: 'inline', itemId: item.id, policy: 'beta_2025' } })
  }
  return moments
}

export async function queueItemMoments(tx: Tx, input: SettlementInput): Promise<number> {
  const names = await zombieTeamNames(tx, input.leagueId)
  const moments = planItemMoments(input, names)
  for (const m of moments) {
    await queueAnimationIn(tx, input.leagueId, input.week, m.type, m.primary, m.meta, undefined, m.secondary, m.durationMs)
  }
  return moments.length
}
