import 'server-only'

/**
 * Room v2 league notes and slot salaries, read once per draft page load. Every read is one indexed
 * lookup, only for the concept that needs it, and READ-ONLY: `getGuillotineConfig` and
 * `getSalaryCapConfig` fall back to settings without writing a row.
 *
 * A failed read gives no note, never a broken room — this is decoration on the board.
 */
import { prisma } from '@/lib/prisma'
import type { LeagueConceptType } from '@/lib/league/leagueConceptOptions'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { readPirateRules } from '@/lib/pirate/rules'
import { getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { loadRookieContractTerms } from '@/lib/salary-cap/RookieContractService'
import { NO_LEAGUE_FACTS, type DraftRoomLeagueFacts, type LeagueNote, type SlotSalary } from './leagueNote'

function positiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

async function readNote(leagueId: string, concept: LeagueConceptType): Promise<LeagueNote | null> {
  if (concept === 'guillotine' || concept === 'survivor_guillotine') {
    const config = await getGuillotineConfig(leagueId)
    const startWeek = positiveInt(config?.eliminationStartWeek)
    const perChop = positiveInt(config?.teamsPerChop)
    return startWeek && perChop ? { kind: 'guillotine', startWeek, perChop } : null
  }
  if (concept === 'pirate') {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    return league ? { kind: 'pirate', protect: readPirateRules(league.settings).protectionLimit } : null
  }
  if (concept === 'salary_cap') {
    const cap = positiveInt((await getSalaryCapConfig(leagueId))?.startupCap)
    return cap ? { kind: 'salary_cap', cap } : null
  }
  if (concept === 'tournament') {
    const row = await prisma.tournamentLeague.findUnique({
      where: { leagueId },
      select: { conference: { select: { name: true } }, round: { select: { roundLabel: true } } },
    })
    const conference = row?.conference?.name?.trim() || null
    const round = row?.round?.roundLabel?.trim() || null
    return conference || round ? { kind: 'tournament', conference, round } : null
  }
  return null
}

/**
 * A snake salary-cap draft's slot salaries. Gated exactly as `submitPick` gates
 * `assignRookieContract` (a cap config whose startup draft is snake), so the board shows a salary
 * only where a pick is signed to one, and through the same `termsFor`.
 */
async function readSlotSalaries(leagueId: string, totalSlots: number): Promise<Record<number, SlotSalary> | null> {
  if (totalSlots <= 0) return null
  const terms = await loadRookieContractTerms(leagueId)
  if (!terms || terms.startupDraftType !== 'snake') return null
  const out: Record<number, SlotSalary> = {}
  for (let overall = 1; overall <= totalSlots; overall++) out[overall] = terms.termsFor(overall)
  return out
}

export async function loadDraftRoomLeagueFacts(input: {
  leagueId: string
  concept: LeagueConceptType
  draftType: string
  rounds: number
  teamCount: number
}): Promise<DraftRoomLeagueFacts> {
  const totalSlots = Math.max(0, Math.floor(input.rounds) * Math.floor(input.teamCount))
  const [note, slotSalaryByOverall] = await Promise.all([
    readNote(input.leagueId, input.concept).catch(() => null),
    // No concept gate: `submitPick` signs a contract for ANY league with a snake cap config.
    input.draftType === 'auction'
      ? Promise.resolve(null)
      : readSlotSalaries(input.leagueId, totalSlots).catch(() => null),
  ])
  if (!note && !slotSalaryByOverall) return NO_LEAGUE_FACTS
  return { note, slotSalaryByOverall }
}
