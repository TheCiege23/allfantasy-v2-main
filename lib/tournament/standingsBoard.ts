/**
 * Every league in a tournament, scored, on one screen.
 *
 * 🛑 THIS IS THE SCREEN THAT REPLACES THE WEEKLY RECOMPUTE. A commissioner with
 * twenty leagues and 240 managers spends hours a week rebuilding conference
 * standings by hand because nothing showed them in one place. The numbers were
 * always there — `LeagueTeam` carries the record a sync committed — and the
 * ranking rule was always there in `advancementEngine`. This joins the two.
 *
 * ⚠ READ ONLY, AND THAT IS A DESIGN DECISION RATHER THAN A LIMITATION.
 * `calculateLeagueStandings` WRITES: it stamps `leagueRank`, `conferenceRank`
 * and the participants' records, and `identifyQualifiers` sets
 * `advancementStatus`. A commissioner opening a dashboard must not silently
 * advance or eliminate anybody — so this recomputes the same numbers with the
 * SAME comparator and persists none of them. Advancement stays an action the
 * commissioner takes, not a side effect of looking.
 *
 * ⚠ ONE COMPARATOR, IMPORTED. Sorting "the same way" with a local copy
 * eventually disagrees with the engine by a hundredth of a point, and then the
 * manager shown in 64th is not the one the engine advances. See
 * `compareStandings`.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { compareStandings } from '@/lib/tournament/advancementEngine'
import {
  matchParticipantsToRecords,
  readImportedLeagueRecords,
} from '@/lib/tournament/importedStandingsSource'
import { composeBubble } from '@/lib/tournament/bubbleComposition'

export type BoardRow = {
  /** `TournamentLeagueParticipant.id` — what a link is written against. */
  leagueParticipantId: string
  participantId: string
  userId: string
  /** What the sheet calls "Team Name" — the manager's handle on the platform. */
  displayName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  leagueRank: number
  conferenceRank: number
  /**
   * The AllFantasy account behind this manager, or null.
   *
   * ⚠ NULL IS THE COMMON CASE IN AN IMPORTED TOURNAMENT, and it is what splits a
   * broadcast into "delivered" and "here is a block to paste".
   */
  appUserId: string | null
  /** No team row could be matched — NOT a manager who scored nothing. */
  unmatched: boolean
  matchedBy: 'commissionerLink' | 'platformUserId' | 'ownerName' | 'teamName' | null
  /** Where this manager stands against the conference cut, as things are today. */
  standing: 'in' | 'bubble' | 'out'
}

/** A team row in the imported league that no participant is claiming. */
export type UnclaimedTeam = {
  externalId: string
  ownerName: string
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

export type BoardLeague = {
  tournamentLeagueId: string
  /** The underlying `League.id`, null while a round's leagues are still forming. */
  leagueId: string | null
  name: string
  rows: BoardRow[]
  unmatchedCount: number
  /**
   * Team rows nobody is claiming — the other half of every unmatched manager.
   *
   * ⚠ THE LINKING UI NEEDS BOTH SIDES, and offering CLAIMED rows as options is
   * how a commissioner reassigns one manager's season to another by accident.
   * The list is what is genuinely free.
   */
  unclaimedTeams: UnclaimedTeam[]
  /** Oldest team-row timestamp in this league — the real age of these numbers. */
  oldestUpdatedAt: Date | null
}

export type BoardConference = {
  id: string
  name: string
  colorHex: string | null
  leagues: BoardLeague[]
  /** How many managers this conference advances, from the shell's own settings. */
  qualifyingCount: number
  /** Combined points of every matched manager in the conference. */
  conferencePoints: number
}

export type StandingsBoard = {
  tournamentId: string
  name: string
  roundNumber: number
  conferences: BoardConference[]
  advancersPerLeague: number
  wildcardCount: number
  bubbleEnabled: boolean
  bubbleSize: number
  tiebreakerMode: string
  /** Total rows with no matched team row, across the whole tournament. */
  unmatchedTotal: number
  /**
   * The oldest team row anywhere in the tournament.
   *
   * ⚠ THE OLDEST, NOT THE NEWEST. A board is only as current as its stalest
   * league, and reporting the newest lets one re-synced league present the whole
   * tournament as fresh — while the league that did not sync is the one whose
   * managers get cut on last week's points.
   */
  oldestUpdatedAt: Date | null
}

/**
 * Build the board for one tournament.
 *
 * Returns null when the tournament does not exist OR the viewer does not
 * commission it — the same answer for both, because a distinct 403 confirms a
 * tournament exists to someone who cannot see it.
 */
export async function getTournamentStandingsBoard(
  tournamentId: string,
  userId: string,
): Promise<StandingsBoard | null> {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: userId },
    select: {
      id: true,
      name: true,
      currentRoundNumber: true,
      advancersPerLeague: true,
      wildcardCount: true,
      bubbleEnabled: true,
      bubbleSize: true,
      tiebreakerMode: true,
    },
  })
  if (!shell) return null

  const conferences = await prisma.tournamentConference.findMany({
    where: { tournamentId },
    orderBy: { conferenceNumber: 'asc' },
    select: { id: true, name: true, colorHex: true },
  })

  const tournamentLeagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId },
    select: { id: true, leagueId: true, name: true, conferenceId: true },
  })

  const participants = await prisma.tournamentLeagueParticipant.findMany({
    where: { tournamentLeagueId: { in: tournamentLeagues.map((t) => t.id) } },
    select: {
      id: true,
      tournamentLeagueId: true,
      participantId: true,
      userId: true,
      participant: { select: { displayName: true } },
    },
  })

  const participantsByLeague = new Map<string, typeof participants>()
  for (const p of participants) {
    const arr = participantsByLeague.get(p.tournamentLeagueId) ?? []
    arr.push(p)
    participantsByLeague.set(p.tournamentLeagueId, arr)
  }

  const outConferences: BoardConference[] = []
  let unmatchedTotal = 0
  let oldestUpdatedAt: Date | null = null

  for (const conf of conferences) {
    const confLeagues = tournamentLeagues.filter((t) => t.conferenceId === conf.id)
    const leagues: BoardLeague[] = []
    /* Collected across the whole conference, because the cut is conference-wide
       even though the table is drawn league by league. */
    const conferenceRows: BoardRow[] = []

    for (const tl of confLeagues) {
      const roster = participantsByLeague.get(tl.id) ?? []
      const imported = tl.leagueId
        ? await readImportedLeagueRecords(tl.leagueId)
        : { leagueId: '', rows: [], oldestUpdatedAt: null }

      const matches = matchParticipantsToRecords(
        roster.map((p) => ({ userId: p.userId, displayName: p.participant?.displayName ?? null })),
        imported.rows,
      )
      const matchByUserId = new Map(matches.map((m) => [m.participant.userId, m]))

      const rows: BoardRow[] = roster.map((p) => {
        const m = matchByUserId.get(p.userId)
        const rec = m?.record ?? null
        return {
          leagueParticipantId: p.id,
          participantId: p.participantId,
          userId: p.userId,
          displayName: p.participant?.displayName?.trim() || rec?.ownerName || rec?.teamName || p.userId,
          wins: rec?.wins ?? 0,
          losses: rec?.losses ?? 0,
          ties: rec?.ties ?? 0,
          pointsFor: rec?.pointsFor ?? 0,
          pointsAgainst: rec?.pointsAgainst ?? 0,
          appUserId: rec?.claimedByUserId ?? null,
          leagueRank: 0,
          conferenceRank: 0,
          unmatched: rec == null,
          matchedBy: m?.matchedBy ?? null,
          standing: 'out',
        }
      })

      /*
       * ⚠ AN UNMATCHED ROW SORTS LAST RATHER THAN ON A ZERO. Its record is
       * unknown, not nil — letting a zero compete for a rank puts a manager we
       * simply could not read below managers we can, which is a ranking claim we
       * have no evidence for.
       */
      rows.sort((a, b) => {
        if (a.unmatched !== b.unmatched) return a.unmatched ? 1 : -1
        return compareStandings(a, b, shell.tiebreakerMode)
      })
      rows.forEach((r, i) => {
        r.leagueRank = i + 1
      })

      const claimedExternalIds = new Set(
        matches.filter((m) => m.record != null).map((m) => m.record!.externalId),
      )
      const unclaimedTeams: UnclaimedTeam[] = imported.rows
        .filter((r) => !claimedExternalIds.has(r.externalId))
        .map((r) => ({
          externalId: r.externalId,
          ownerName: r.ownerName,
          teamName: r.teamName,
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          pointsFor: r.pointsFor,
        }))

      const unmatchedCount = rows.filter((r) => r.unmatched).length
      unmatchedTotal += unmatchedCount
      if (
        imported.oldestUpdatedAt &&
        (oldestUpdatedAt == null || imported.oldestUpdatedAt < oldestUpdatedAt)
      ) {
        oldestUpdatedAt = imported.oldestUpdatedAt
      }

      leagues.push({
        tournamentLeagueId: tl.id,
        leagueId: tl.leagueId ?? null,
        name: tl.name?.trim() || 'League',
        rows,
        unmatchedCount,
        unclaimedTeams,
        oldestUpdatedAt: imported.oldestUpdatedAt,
      })
      conferenceRows.push(...rows)
    }

    /* The conference-wide order, which is what the cut is actually made on. */
    const ranked = [...conferenceRows].sort((a, b) => {
      if (a.unmatched !== b.unmatched) return a.unmatched ? 1 : -1
      return compareStandings(a, b, shell.tiebreakerMode)
    })

    /*
     * ⚠ KBI's RULE IS EXPRESSED AS `advancersPerLeague: 0` PLUS A CONFERENCE-WIDE
     * `wildcardCount`, and the engine's field name reads oddly for it — those 64
     * are the main cut, not wildcards. The maths is the engine's; only the label
     * is a poor fit, and inventing a second rule here to make the name read
     * better is exactly how a screen and its engine drift apart.
     */
    const perLeague = Math.max(0, shell.advancersPerLeague) * confLeagues.length
    const qualifyingCount = perLeague + Math.max(0, shell.wildcardCount)

    ranked.forEach((row, i) => {
      row.conferenceRank = row.unmatched ? 0 : i + 1
    })

    /*
     * ⚠ THE BUBBLE IS COMPOSED BY THE SHARED RULE, NOT BY A WINDOW BELOW THE
     * CUT. Seeds at the bottom of the cut are DEFENDING their place, and the
     * challengers are the top SCORERS below the line rather than the next few by
     * rank — see `composeBubble`. A board that worked this out for itself would
     * show a manager as safe and then watch the engine eliminate them.
     */
    const scored = ranked.filter((r) => !r.unmatched)
    const { safe, atRisk, challengers, eliminated } = composeBubble(scored, {
      cut: qualifyingCount,
      bubbleSize: Math.max(0, shell.bubbleSize),
      enabled: shell.bubbleEnabled,
      pointsOf: (r) => r.pointsFor,
    })
    for (const r of safe) r.standing = 'in'
    for (const r of atRisk) r.standing = 'bubble'
    for (const r of challengers) r.standing = 'bubble'
    for (const r of eliminated) r.standing = 'out'
    for (const r of ranked) if (r.unmatched) r.standing = 'out'

    outConferences.push({
      id: conf.id,
      name: conf.name,
      colorHex: conf.colorHex ?? null,
      leagues,
      qualifyingCount,
      conferencePoints: conferenceRows.reduce(
        (sum, r) => (r.unmatched ? sum : sum + r.pointsFor),
        0,
      ),
    })
  }

  return {
    tournamentId: shell.id,
    name: shell.name,
    roundNumber: shell.currentRoundNumber,
    conferences: outConferences,
    advancersPerLeague: shell.advancersPerLeague,
    wildcardCount: shell.wildcardCount,
    bubbleEnabled: shell.bubbleEnabled,
    bubbleSize: shell.bubbleSize,
    tiebreakerMode: shell.tiebreakerMode,
    unmatchedTotal,
    oldestUpdatedAt,
  }
}
