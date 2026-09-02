import type { TournamentRound } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { provisionTournamentLeagueWithManagers } from '@/lib/tournament/setupEngine'
import { generateLeagueNamesForConference, recordName, slugify } from '@/lib/tournament/namingEngine'
import { applyRoundRosterRules } from '@/lib/tournament/rosterRules'
import { scheduleRoundDraft } from '@/lib/tournament/scheduleRoundDraft'
import {
  matchParticipantsToRecords,
  readImportedLeagueRecords,
} from '@/lib/tournament/importedStandingsSource'
import { composeBubble } from '@/lib/tournament/bubbleComposition'

export type StandingRow = {
  tournamentLeagueParticipantId: string
  participantId: string
  userId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  leagueRank: number
}

export type LeagueStandingsResult = { leagueId: string; rows: StandingRow[] }

export type ConferenceStandingsResult = { conferenceId: string; rows: StandingRow[] }

export type AdvancementResult = {
  directQualifiers: string[]
  wildcards: string[]
  bubble: string[]
  eliminated: string[]
}

/** After opening, consolidate into leagues of this size when possible. */
const POST_OPENING_LEAGUE_SLOT_TARGET = 8

/**
 * The tiebreak, exported so a read-only view cannot invent a second one.
 *
 * ⚠ W/L THEN POINTS-FOR IS WHO ADVANCES. A screen that sorts "the same way"
 * with its own copy will eventually disagree with the engine by a hundredth of
 * a point, and the manager it shows in 64th is not the one the engine advances.
 * One comparator, used by both.
 */
export function compareStandings(
  a: { wins: number; pointsFor: number; pointsAgainst: number },
  b: { wins: number; pointsFor: number; pointsAgainst: number },
  tiebreakerMode: string,
): number {
  if (b.wins !== a.wins) return b.wins - a.wins
  if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
  if (tiebreakerMode === 'points_against_inverse') {
    if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst
  }
  return 0
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
}

function resolveNextPlayRound(rounds: TournamentRound[], fromRound: { roundNumber: number }) {
  return rounds
    .filter((r) => r.roundNumber > fromRound.roundNumber && r.roundType !== 'bubble')
    .sort((a, b) => a.roundNumber - b.roundNumber)[0]
}

export async function calculateLeagueStandings(tournamentLeagueId: string): Promise<LeagueStandingsResult> {
  const tl = await prisma.tournamentLeague.findUnique({
    where: { id: tournamentLeagueId },
    include: { league: true, tournament: true },
  })
  if (!tl?.leagueId) throw new Error('Tournament league has no underlying league yet')

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: tl.leagueId },
    orderBy: { createdAt: 'desc' },
  })

  const shell = tl.tournament
  const rosterByUser = new Map<string, { wins: number; losses: number; ties: number; pf: number; pa: number }>()

  if (season) {
    const rosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })
    for (const r of rosters) {
      rosterByUser.set(r.ownerId, {
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pf: r.pointsFor,
        pa: r.pointsAgainst,
      })
    }
  }

  const participants = await prisma.tournamentLeagueParticipant.findMany({
    where: { tournamentLeagueId },
    include: { participant: true },
  })

  /*
   * 🛑 AN IMPORTED LEAGUE HAS NO `RedraftSeason`, AND WITHOUT THIS THE FALLBACK
   * BELOW RECOMPUTES FROM THE PARTICIPANT'S OWN STORED COPY.
   *
   * Nothing refreshes that copy for an imported league, so the engine read its
   * own last answer, sorted it, and reported no movement — indistinguishable
   * from a week nobody played, and the reason a commissioner recomputes 240
   * managers by hand every week while this function sits here.
   *
   * `LeagueTeam` is where the Sleeper importer actually puts the record, so that
   * is what an imported league is scored from. Native leagues are untouched:
   * `season` still wins, and this only fills users that branch did not.
   */
  if (rosterByUser.size === 0) {
    const imported = await readImportedLeagueRecords(tl.leagueId)
    if (imported.rows.length > 0) {
      const matches = matchParticipantsToRecords(
        participants.map((lp) => ({
          userId: lp.userId,
          displayName: lp.participant?.displayName ?? null,
        })),
        imported.rows,
      )
      for (const m of matches) {
        if (!m.record) continue
        rosterByUser.set(m.participant.userId, {
          wins: m.record.wins,
          losses: m.record.losses,
          ties: m.record.ties,
          pf: m.record.pointsFor,
          pa: m.record.pointsAgainst,
        })
      }
    }
  }

  const rows: StandingRow[] = []
  for (const lp of participants) {
    const st = rosterByUser.get(lp.userId) ?? {
      wins: lp.wins,
      losses: lp.losses,
      ties: lp.ties,
      pf: lp.pointsFor,
      pa: lp.pointsAgainst,
    }
    await prisma.tournamentLeagueParticipant.update({
      where: { id: lp.id },
      data: {
        wins: st.wins,
        losses: st.losses,
        ties: st.ties,
        pointsFor: st.pf,
        pointsAgainst: st.pa,
      },
    })
    rows.push({
      tournamentLeagueParticipantId: lp.id,
      participantId: lp.participantId,
      userId: lp.userId,
      wins: st.wins,
      losses: st.losses,
      ties: st.ties,
      pointsFor: st.pf,
      pointsAgainst: st.pa,
      leagueRank: 0,
    })
  }

  rows.sort((a, b) => compareStandings(a, b, shell.tiebreakerMode))
  let rank = 1
  for (const r of rows) {
    r.leagueRank = rank++
    await prisma.tournamentLeagueParticipant.update({
      where: { id: r.tournamentLeagueParticipantId },
      data: { leagueRank: r.leagueRank },
    })
  }

  if (tl.conferenceId) {
    await calculateConferenceStandings(tl.conferenceId, tl.roundId)
  }

  return { leagueId: tournamentLeagueId, rows }
}

export async function calculateConferenceStandings(
  conferenceId: string,
  roundId?: string | null,
): Promise<ConferenceStandingsResult> {
  const conference = await prisma.tournamentConference.findUnique({
    where: { id: conferenceId },
    include: { tournament: true },
  })
  if (!conference) throw new Error('Conference not found')

  const leagueWhere: { conferenceId: string; roundId?: string } = { conferenceId }
  if (roundId) leagueWhere.roundId = roundId

  const leagues = await prisma.tournamentLeague.findMany({
    where: leagueWhere,
    select: { id: true },
  })
  const leagueIds = leagues.map((l) => l.id)
  if (leagueIds.length === 0) {
    await prisma.tournamentConference.update({
      where: { id: conferenceId },
      data: { standingsCache: [] },
    })
    return { conferenceId, rows: [] }
  }

  const tlpRows = await prisma.tournamentLeagueParticipant.findMany({
    where: { tournamentLeagueId: { in: leagueIds } },
  })

  const merged = tlpRows.map((lp) => ({
    tournamentLeagueParticipantId: lp.id,
    participantId: lp.participantId,
    userId: lp.userId,
    wins: lp.wins,
    losses: lp.losses,
    ties: lp.ties,
    pointsFor: lp.pointsFor,
    pointsAgainst: lp.pointsAgainst,
    leagueRank: 0,
  }))

  merged.sort((a, b) => compareStandings(a, b, conference.tournament.tiebreakerMode))
  let r = 1
  for (const row of merged) {
    row.leagueRank = r++
    await prisma.tournamentLeagueParticipant.update({
      where: { id: row.tournamentLeagueParticipantId },
      data: { conferenceRank: row.leagueRank },
    })
  }

  const cache = merged.map((x) => ({
    participantId: x.participantId,
    userId: x.userId,
    wins: x.wins,
    losses: x.losses,
    pointsFor: x.pointsFor,
    rank: x.leagueRank,
  }))

  await prisma.tournamentConference.update({
    where: { id: conferenceId },
    data: { standingsCache: cache },
  })

  return { conferenceId, rows: merged }
}

export async function identifyQualifiers(
  tournamentId: string,
  fromRoundId: string,
): Promise<AdvancementResult> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) throw new Error('Tournament not found')

  const fromRound = await prisma.tournamentRound.findFirst({
    where: { id: fromRoundId, tournamentId },
  })
  if (!fromRound) throw new Error('Round not found')
  const isOpeningRound = fromRound.roundNumber === 1

  const tls = await prisma.tournamentLeague.findMany({ where: { tournamentId, roundId: fromRoundId } })
  for (const tl of tls) {
    if (tl.leagueId) {
      await calculateLeagueStandings(tl.id)
    }
  }

  const conferences = await prisma.tournamentConference.findMany({ where: { tournamentId } })
  for (const c of conferences) {
    await calculateConferenceStandings(c.id, fromRoundId)
  }

  const directQualifiers: string[] = []
  const wildcards: string[] = []
  const bubble: string[] = []
  const eliminated: string[] = []

  const directByConference = new Map<string, string[]>()

  for (const tl of tls) {
    const top = await prisma.tournamentLeagueParticipant.findMany({
      where: { tournamentLeagueId: tl.id },
      orderBy: [{ leagueRank: 'asc' }],
      take: shell.advancersPerLeague,
    })
    for (const t of top) {
      directQualifiers.push(t.participantId)
      await prisma.tournamentLeagueParticipant.update({
        where: { id: t.id },
        data: { advancementStatus: 'qualified' },
      })
      if (tl.conferenceId) {
        const arr = directByConference.get(tl.conferenceId) ?? []
        arr.push(t.participantId)
        directByConference.set(tl.conferenceId, arr)
      }
    }
  }

  for (const [cid, pids] of directByConference) {
    await prisma.tournamentAdvancementGroup.create({
      data: {
        tournamentId,
        conferenceId: cid,
        fromRoundId,
        groupType: 'direct_qualifier',
        participantIds: pids,
        maxSize: pids.length,
        bubbleWinnerIds: [],
      },
    })
  }

  for (const conf of conferences) {
    const inConf = await prisma.tournamentLeague.findMany({
      where: { conferenceId: conf.id, roundId: fromRoundId },
      select: { id: true },
    })
    const leagueIds = inConf.map((x) => x.id)
    const nonQual = await prisma.tournamentLeagueParticipant.findMany({
      where: {
        tournamentLeagueId: { in: leagueIds },
        advancementStatus: { not: 'qualified' },
      },
      orderBy: [{ conferenceRank: 'asc' }],
    })

    const wc = shell.wildcardCount
    const wcPids: string[] = []
    /* Kept because the bubble is composed from the bottom of THIS group. */
    const wcRows: typeof nonQual = []
    for (let i = 0; i < wc && i < nonQual.length; i++) {
      const row = nonQual[i]!
      wcRows.push(row)
      wcPids.push(row.participantId)
      wildcards.push(row.participantId)
      await prisma.tournamentLeagueParticipant.update({
        where: { id: row.id },
        data: { advancementStatus: 'wildcard_eligible' },
      })
    }

    if (wcPids.length) {
      await prisma.tournamentAdvancementGroup.create({
        data: {
          tournamentId,
          conferenceId: conf.id,
          fromRoundId,
          groupType: 'wildcard',
          participantIds: wcPids,
          maxSize: wcPids.length,
          bubbleWinnerIds: [],
        },
      })
    }

    const rest = nonQual.slice(wc)
    if (shell.bubbleEnabled && isOpeningRound) {
      /*
       * 🛑 THE BUBBLE IS NOT A WINDOW BELOW THE CUT. This used to take the next
       * `bubbleSize` managers by RANK and leave everyone inside the cut safe.
       * The rule these tournaments actually run puts the BOTTOM of the cut at
       * risk and fills the other half with the top SCORERS below the line — who
       * are usually not the next names by rank, because rank is wins-first.
       *
       * `composeBubble` is shared with the standings board precisely so a
       * manager is never shown as safe here and eliminated there.
       */
      const composition = composeBubble(
        /* The bubble is decided across the wildcards and everyone under them —
           direct league qualifiers keep the place they won outright. */
        [...wcRows, ...rest],
        {
          cut: wcRows.length,
          bubbleSize: shell.bubbleSize,
          enabled: true,
          pointsOf: (row) => row.pointsFor,
        },
      )

      const bubblePids: string[] = []
      for (const row of [...composition.atRisk, ...composition.challengers]) {
        bubblePids.push(row.participantId)
        bubble.push(row.participantId)
        /* ⚠ An at-risk manager was marked `wildcard_eligible` moments ago. This
           demotes them to `bubble`: they have not advanced, they are defending. */
        await prisma.tournamentLeagueParticipant.update({
          where: { id: row.id },
          data: { advancementStatus: 'bubble' },
        })
      }
      const elimAfterBubble: string[] = []
      for (const row of composition.eliminated) {
        elimAfterBubble.push(row.participantId)
        eliminated.push(row.participantId)
        await prisma.tournamentLeagueParticipant.update({
          where: { id: row.id },
          data: { advancementStatus: 'eliminated' },
        })
      }
      if (elimAfterBubble.length) {
        await prisma.tournamentAdvancementGroup.create({
          data: {
            tournamentId,
            conferenceId: conf.id,
            fromRoundId,
            groupType: 'eliminated',
            participantIds: elimAfterBubble,
            maxSize: elimAfterBubble.length,
            bubbleWinnerIds: [],
          },
        })
      }
    } else {
      const elimPids: string[] = []
      for (const row of rest) {
        elimPids.push(row.participantId)
        eliminated.push(row.participantId)
        await prisma.tournamentLeagueParticipant.update({
          where: { id: row.id },
          data: { advancementStatus: 'eliminated' },
        })
      }
      if (elimPids.length) {
        await prisma.tournamentAdvancementGroup.create({
          data: {
            tournamentId,
            conferenceId: conf.id,
            fromRoundId,
            groupType: 'eliminated',
            participantIds: elimPids,
            maxSize: elimPids.length,
            bubbleWinnerIds: [],
          },
        })
      }
    }
  }

  const uniqElim = [...new Set(eliminated)]
  if (uniqElim.length) {
    await handleEliminations(tournamentId, uniqElim)
  }

  await prisma.tournamentAnnouncement.create({
    data: {
      tournamentId,
      type: 'qualifier_announced',
      title: 'Qualifiers set',
      content: `Direct qualifiers: ${directQualifiers.length}. Wildcards: ${wildcards.length}. Bubble: ${bubble.length}.`,
      targetAudience: 'all',
    },
  })

  return { directQualifiers, wildcards, bubble, eliminated: uniqElim }
}

export async function executeAdvancement(tournamentId: string, fromRoundNumber: number): Promise<void> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    include: { rounds: { orderBy: { roundNumber: 'asc' } } },
  })
  if (!shell) throw new Error('Tournament not found')

  const fromRound = shell.rounds.find((r) => r.roundNumber === fromRoundNumber)
  if (!fromRound) throw new Error('Invalid from round')

  const toRound = resolveNextPlayRound(shell.rounds, fromRound)
  if (!toRound) {
    await prisma.tournamentShell.update({
      where: { id: tournamentId },
      data: { status: 'complete' },
    })
    return
  }

  const fromTls = await prisma.tournamentLeague.findMany({
    where: { tournamentId, roundId: fromRound.id },
  })

  const advancingRows = await prisma.tournamentLeagueParticipant.findMany({
    where: {
      advancementStatus: { in: ['qualified', 'wildcard_eligible'] },
      tournamentLeagueId: { in: fromTls.map((t) => t.id) },
    },
    include: { participant: true },
  })

  const seen = new Set<string>()
  const advancers = advancingRows.filter((r) => {
    if (seen.has(r.participantId)) return false
    seen.add(r.participantId)
    return true
  })

  if (advancers.length === 0) {
    throw new Error('No participants qualified to advance')
  }

  shuffleInPlace(advancers)

  const now = new Date()
  await prisma.tournamentLeagueParticipant.updateMany({
    where: { tournamentLeagueId: { in: fromTls.map((t) => t.id) } },
    data: { completedAt: now },
  })

  await prisma.tournamentLeague.updateMany({
    where: { tournamentId, roundId: fromRound.id },
    data: { status: 'archived' },
  })

  const slotTarget = Math.min(POST_OPENING_LEAGUE_SLOT_TARGET, Math.max(shell.teamsPerLeague, 4))
  const numLeagues = Math.max(1, Math.ceil(advancers.length / slotTarget))
  const buckets: typeof advancers[] = Array.from({ length: numLeagues }, () => [])
  for (let i = 0; i < advancers.length; i++) {
    buckets[i % numLeagues]!.push(advancers[i]!)
  }

  const conferences = await prisma.tournamentConference.findMany({
    where: { tournamentId },
    orderBy: { conferenceNumber: 'asc' },
  })
  if (!conferences.length) throw new Error('No conferences configured')

  const existingNames = (
    await prisma.tournamentLeague.findMany({
      where: { tournamentId },
      select: { name: true },
    })
  ).map((x) => x.name)

  let li = 0
  for (const bucket of buckets) {
    if (!bucket.length) continue
    const conf = conferences[li % conferences.length]!
    li++

    const lastNum =
      (
        await prisma.tournamentLeague.findFirst({
          where: { tournamentId, conferenceId: conf.id },
          orderBy: { leagueNumber: 'desc' },
          select: { leagueNumber: true },
        })
      )?.leagueNumber ?? 0

    const names = generateLeagueNamesForConference(conf.id, 1, existingNames, conf.theme ?? undefined)
    const name = names[0] ?? `League ${lastNum + 1}`
    existingNames.push(name)
    const slug = slugify(`${name}-${conf.id}-${toRound.id}-${Date.now()}-${li}`)

    const teamSlots = bucket.length
    const tl = await prisma.tournamentLeague.create({
      data: {
        tournamentId,
        conferenceId: conf.id,
        roundId: toRound.id,
        name,
        slug,
        leagueNumber: lastNum + 1,
        teamSlots,
        advancersCount: shell.advancersPerLeague,
        status: 'forming',
      },
    })

    await recordName(tournamentId, 'league', tl.id, name, name, shell.namingMode)

    let rosterSize = shell.tournamentRosterSize
    if (toRound.roundNumber === 1) rosterSize = shell.openingRosterSize
    if (toRound.roundType === 'elite' || toRound.roundType === 'final') rosterSize = shell.eliteRosterSize
    if (toRound.rosterSizeOverride != null) rosterSize = toRound.rosterSizeOverride

    await provisionTournamentLeagueWithManagers(
      shell,
      { id: tl.id, name: tl.name, conferenceId: conf.id },
      toRound.roundNumber,
      teamSlots,
      rosterSize,
      bucket.map((row) => ({
        id: row.participant.id,
        userId: row.participant.userId,
        displayName: row.participant.displayName,
        avatarUrl: row.participant.avatarUrl,
      })),
    )

    for (const row of bucket) {
      const p = row.participant
      const hist = Array.isArray(p.advancementHistory) ? [...(p.advancementHistory as object[])] : []
      hist.push({
        round: fromRound.roundNumber,
        toRound: toRound.roundNumber,
        fromLeagueId: row.tournamentLeagueId,
        rank: row.leagueRank,
        wins: row.wins,
        losses: row.losses,
        pointsFor: row.pointsFor,
        advanced: true,
      })
      await prisma.tournamentParticipant.update({
        where: { id: p.id },
        data: {
          currentRoundNumber: toRound.roundNumber,
          furthestRoundReached: Math.max(p.furthestRoundReached, toRound.roundNumber),
          totalRoundsPlayed: p.totalRoundsPlayed + 1,
          status: 'active',
          advancementHistory: hist,
        },
      })
    }
  }

  await prisma.tournamentShell.update({
    where: { id: tournamentId },
    data: {
      currentRoundNumber: toRound.roundNumber,
      status: 'redrafting',
    },
  })

  await applyRoundRosterRules(tournamentId, toRound.roundNumber)

  const draftAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await scheduleRoundDraft(tournamentId, toRound.roundNumber, draftAt)

  await prisma.tournamentAuditLog.create({
    data: {
      tournamentId,
      roundNumber: fromRoundNumber,
      action: 'advancement_calculated',
      actorType: 'system',
      data: {
        advanced: advancers.length,
        toRound: toRound.roundNumber,
        newLeagues: numLeagues,
      },
    },
  })
}

export async function handleEliminations(
  tournamentId: string,
  eliminatedParticipantIds: string[],
): Promise<void> {
  if (!eliminatedParticipantIds.length) return
  await prisma.tournamentParticipant.updateMany({
    where: { tournamentId, id: { in: eliminatedParticipantIds } },
    data: { status: 'eliminated' },
  })
  const remaining = await prisma.tournamentParticipant.count({
    where: { tournamentId, status: { not: 'eliminated' } },
  })
  await prisma.tournamentShell.update({
    where: { id: tournamentId },
    data: { currentParticipantCount: remaining },
  })
}
