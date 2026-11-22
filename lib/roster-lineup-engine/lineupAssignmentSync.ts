import { prisma } from '@/lib/prisma'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'
import { campusStarterIds } from '@/lib/c2c/campusLineup'

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma

/**
 * Replace normalized `af_roster_lineup_assignments` rows for a roster/week from `playerData`.
 */
export async function syncAfRosterLineupAssignments(
  input: {
    leagueId: string
    rosterId: string
    season: number
    week: number
    playerData: unknown
  },
  db: Db = prisma,
): Promise<void> {
  const sections = getNormalizedLineupSections(input.playerData)
  const campus = new Set(campusStarterIds(input.playerData))
  const rows: Array<{
    leagueId: string
    rosterId: string
    season: number
    week: number
    section: string
    slotIndex: number
    playerId: string
  }> = []

  /*
   * A starter's `slotIndex` is his lineup SLOT (lib/league/lineupSlotPositions.ts) when every starter
   * carries a distinct one, so an empty slot is recorded as a gap. Otherwise — and for every other
   * section — it is the order within the section, as before. No reader scores from this column:
   * scoring reads `section` (lib/redraft/weekLineupSlots.ts).
   */
  const starterSlots = sections.starters.map((r) => starterSlotIndexOf(r))
  const usePositions =
    starterSlots.length > 0 && starterSlots.every((s) => s != null) && new Set(starterSlots).size === starterSlots.length
  const keys: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  for (const section of keys) {
    let i = 0
    sections[section].forEach((row, k) => {
      const id = String((row as Record<string, unknown>).id ?? '').trim()
      if (!id) return
      const order = i++
      rows.push({
        leagueId: input.leagueId,
        rosterId: input.rosterId,
        season: input.season,
        week: input.week,
        // A campus starter still belongs to devy, but its weekly role must survive future saves.
        section: section === 'devy' && /^espn:ncaab:\d+$/.test(id) && campus.has(id) ? 'campus' : section,
        slotIndex: section === 'starters' && usePositions ? (starterSlots[k] as number) : order,
        playerId: id,
      })
    })
  }

  await db.afRosterLineupAssignment.deleteMany({
    where: {
      rosterId: input.rosterId,
      season: input.season,
      week: input.week,
    },
  })
  if (rows.length > 0) {
    await db.afRosterLineupAssignment.createMany({ data: rows })
  }
}
