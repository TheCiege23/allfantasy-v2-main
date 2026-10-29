import type { PrismaClient } from '@prisma/client'
import { loadWeekLineups, weekSlotType, type WeekLineups } from '@/lib/redraft/weekLineupSlots'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'

/**
 * The lineup card the tanking scan reads, built from what a native week ACTUALLY stored.
 *
 * 🛑 THE SCAN READ A SHAPE NOTHING WRITES. `scanWeekForTanking` parsed `RedraftMatchup.lineupSnapshots`
 * as an array of `{ rosterId, starters, bench }` cards, but both writers (lib/redraft/scoringEngine.ts
 * and the live-scoring runtime's `serializeSnapshot`) store an OBJECT of team totals —
 * `{ redraftScoring: { home, away, … } }` — with no per-player lineup at all. The parser returned `[]`
 * for every real matchup, so the scan never had a card and never flagged anyone.
 *
 * The per-week lineup does exist: `af_roster_lineup_assignments`, read by `loadWeekLineups`, the same
 * record matchup scoring uses ("the lineup saved for THIS week, not the current one"). Cards are built
 * from it so scoring and integrity agree on who started.
 *
 * ⚠ A ROSTER WITH NO SAVED LINEUP FOR THE WEEK GETS NO CARD. Falling back to `slotType` would read the
 * CURRENT lineup — possibly next week's — and file it as this week's evidence. The engine's own rule
 * stands: a roster we have no lineup card for gets no claim made about it.
 *
 * ⚠ No per-player projection is stored, so `proj` is absent and the bench-pattern check stays quiet
 * rather than inventing gaps. `status` is the roster row's injury status as last synced — close to
 * kickoff when the scan runs at finalization, but not a snapshot taken at lock.
 */

export type LineupCardPlayer = { playerId: string; status?: string; proj?: number; byeWeek?: number | null }
export type LineupCard = { rosterId: string; starters: LineupCardPlayer[]; bench: LineupCardPlayer[] }

export type RosterPlayerRow = {
  rosterId: string
  playerId: string
  slotType: string
  position: string | null
  injuryStatus: string | null
  byeWeek: number | null
}

/** Pure: cards for every roster that saved a lineup for the week. */
export function buildLineupCards(players: readonly RosterPlayerRow[], lineups: WeekLineups): Map<string, LineupCard> {
  const cards = new Map<string, LineupCard>()
  for (const p of players) {
    const saved = lineups.get(p.rosterId)
    if (!saved || !saved.has(p.playerId)) continue // only players the saved lineup named
    const card = cards.get(p.rosterId) ?? { rosterId: p.rosterId, starters: [], bench: [] }
    const slot = weekSlotType(p, lineups)
    const entry: LineupCardPlayer = { playerId: p.playerId, status: p.injuryStatus ?? undefined, byeWeek: p.byeWeek }
    if (isNflRedraftScoringStarterSlot(slot)) card.starters.push(entry)
    else if (slot === 'bench') card.bench.push(entry)
    cards.set(p.rosterId, card)
  }
  return cards
}

export async function loadNativeLineupCards(
  db: Pick<PrismaClient, 'roster' | 'afRosterLineupAssignment' | 'redraftRosterPlayer'>,
  args: { redraftRosterIds: readonly string[]; season: number; week: number },
): Promise<Map<string, LineupCard>> {
  const lineups = await loadWeekLineups(db, args)
  if (lineups.size === 0) return new Map()
  const savedIds = [...new Set([...lineups.values()].flatMap((m) => [...m.keys()]))]
  // Players the saved lineup named, dropped since or not: the card is that week's, not today's roster.
  const players = await db.redraftRosterPlayer.findMany({
    where: { rosterId: { in: [...lineups.keys()] }, playerId: { in: savedIds } },
    select: { rosterId: true, playerId: true, slotType: true, position: true, injuryStatus: true, byeWeek: true },
  })
  return buildLineupCards(players, lineups)
}
