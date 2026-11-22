import 'server-only'

/**
 * Room v2 in a LEAGUE mock draft: the league's real type (its accent and chip) and the facts the live
 * room shows for it — its rule note, and a snake salary-cap board's slot salaries. Read through the
 * same `draftRoomLeagueConceptRaw` and `loadDraftRoomLeagueFacts` as the live draft page, so a mock
 * and the league's real draft can never disagree about what the league is.
 *
 * What a mock does NOT get: tribes, tournament seeds and keeper years are facts about real rosters and
 * real keepers, and a mock's seats are simulated. A failed read is a plain room, never a failed mock.
 */
import { prisma } from '@/lib/prisma'
import { draftRoomLeagueConceptRaw, normalizeLeagueConcept } from '@/lib/draft-room/leagueAccent'
import { loadDraftRoomLeagueFacts } from '@/lib/draft-room/loadDraftRoomLeagueFacts'
import type { DraftRoomLeagueFacts } from '@/lib/draft-room/leagueNote'

export type LeagueMockRoomFacts = {
  /** Raw concept for `leagueAccentFor` (null when the league has none). */
  leagueConcept: string | null
  leagueFacts: Pick<DraftRoomLeagueFacts, 'note' | 'slotSalaryByOverall'> | null
}

export async function leagueMockRoomFacts(
  leagueId: string | null | undefined,
  draft: { draftType: string; rounds: number; teamCount: number },
): Promise<LeagueMockRoomFacts> {
  const none: LeagueMockRoomFacts = { leagueConcept: null, leagueFacts: null }
  if (!leagueId) return none
  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { leagueType: true, leagueVariant: true, settings: true, isDynasty: true },
    })
    if (!league) return none
    const leagueConcept = draftRoomLeagueConceptRaw(league)
    const facts = await loadDraftRoomLeagueFacts({
      leagueId,
      concept: normalizeLeagueConcept(leagueConcept, { isDynasty: league.isDynasty }),
      draftType: draft.draftType,
      rounds: draft.rounds,
      teamCount: draft.teamCount,
    })
    const leagueFacts = facts.note || facts.slotSalaryByOverall
      ? { note: facts.note, slotSalaryByOverall: facts.slotSalaryByOverall }
      : null
    return { leagueConcept, leagueFacts }
  } catch {
    return none
  }
}
