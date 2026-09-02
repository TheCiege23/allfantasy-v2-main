/**
 * Freeze the redraft assignment, and connect the rebuilt leagues back to it.
 *
 * 🛑 THE PLAN ALONE LEAVES THE TOURNAMENT STRANDED. `buildRedraftPlan` works out
 * who goes where and recomputes it every time it is asked — which is right for a
 * preview and wrong the moment a commissioner starts acting on it. They spend an
 * evening building eight leagues on Sleeper from Tuesday's sheet; if a late sync
 * or a corrected score shifts the standings, Thursday's plan names different
 * people, and nothing anywhere records which version the leagues were actually
 * built from.
 *
 * 🛑 AND THE BOARD CANNOT FOLLOW THE TOURNAMENT INTO ROUND 2. Every read here is
 * keyed on `TournamentLeague` rows for a round. The redraft creates leagues on
 * ANOTHER platform, so unless something attaches those imports back to the
 * round's slots, the hub keeps showing the regular season forever while the real
 * tournament plays on without it.
 *
 * So this is two steps, deliberately separate because they happen days apart:
 *
 *   1. COMMIT — write the assignment as real round-2 slots with their managers.
 *      The plan stops being a calculation and becomes the record.
 *   2. ATTACH — once a rebuilt league has been imported, point its slot at it.
 *
 * ⚠ NEITHER CREATES ANYTHING ON THE HOST PLATFORM. Step 1 records a decision;
 * step 2 records a league that already exists because a human made it.
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { buildRedraftPlan, type RedraftPlan } from '@/lib/tournament/redraftPlan'

export type CommitOutcome =
  | {
      ok: true
      roundNumber: number
      leaguesCreated: number
      managersPlaced: number
      slots: Array<{ tournamentLeagueId: string; name: string; teamSlots: number }>
    }
  | { ok: false; error: string; status: 400 | 404 | 409 }

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'league'
  )
}

/**
 * Turn the plan into round-2 slots.
 *
 * ⚠ THE SLOTS ARE CREATED WITHOUT A `leagueId`, WHICH IS THE HONEST STATE.
 * A slot named BLACK NORTH with sixteen managers assigned and no league behind
 * it is exactly the situation: the decision is made, the league does not exist
 * yet. `status: 'forming'` says so, and `attachRedraftLeague` is what completes
 * it.
 */
export async function commitRedraftPlan(args: {
  tournamentId: string
  commissionerUserId: string
}): Promise<CommitOutcome> {
  const plan: RedraftPlan | null = await buildRedraftPlan(
    args.tournamentId,
    args.commissionerUserId,
  )
  if (!plan) return { ok: false, error: 'Tournament not found', status: 404 }

  const blocking = plan.blockers.filter((b) => b.severity === 'blocker')
  if (blocking.length > 0) {
    return { ok: false, error: blocking[0]!.message, status: 400 }
  }

  const shell = await prisma.tournamentShell.findFirst({
    where: { id: args.tournamentId, commissionerId: args.commissionerUserId },
    select: { id: true, currentRoundNumber: true },
  })
  if (!shell) return { ok: false, error: 'Tournament not found', status: 404 }

  const rounds = await prisma.tournamentRound.findMany({
    where: { tournamentId: args.tournamentId },
    orderBy: { roundNumber: 'asc' },
    select: { id: true, roundNumber: true, roundType: true },
  })

  /*
   * ⚠ THE SAME "NEXT PLAY ROUND" RULE THE ENGINE USES, INCLUDING THE BUBBLE
   * EXCLUSION. A bubble round has a week and an audience but is not the next
   * stage of the bracket, and redrafting into it would put the whole field in a
   * round meant for twelve people.
   */
  const target = rounds
    .filter((r) => r.roundNumber > plan.fromRoundNumber && r.roundType !== 'bubble')
    .sort((a, b) => a.roundNumber - b.roundNumber)[0]

  if (!target) {
    return {
      ok: false,
      error:
        'There is no round after this one to redraft into. Add the rest of the calendar in settings first.',
      status: 400,
    }
  }

  /*
   * 🛑 REFUSED IF THIS ROUND ALREADY HAS SLOTS. Committing twice would collide
   * on `@@unique([tournamentId, name])` halfway through and leave a partly built
   * round — and worse, a commissioner who has already invited people to BLACK
   * NORTH would find a second BLACK NORTH with a different sixteen in it.
   */
  const existing = await prisma.tournamentLeague.count({
    where: { tournamentId: args.tournamentId, roundId: target.id },
  })
  if (existing > 0) {
    return {
      ok: false,
      error:
        'This round has already been set up. Clear it before committing a different assignment.',
      status: 409,
    }
  }

  const lastNumber =
    (
      await prisma.tournamentLeague.findFirst({
        where: { tournamentId: args.tournamentId },
        orderBy: { leagueNumber: 'desc' },
        select: { leagueNumber: true },
      })
    )?.leagueNumber ?? 0

  const slots: Array<{ tournamentLeagueId: string; name: string; teamSlots: number }> = []
  const leagueRows: Array<Record<string, unknown>> = []
  const participantRows: Array<Record<string, unknown>> = []
  let leagueNumber = lastNumber

  for (const conf of plan.conferences) {
    for (const league of conf.leagues) {
      if (league.managers.length === 0) continue
      const id = randomUUID()
      leagueNumber += 1
      leagueRows.push({
        id,
        tournamentId: args.tournamentId,
        conferenceId: conf.conferenceId,
        roundId: target.id,
        name: league.name,
        /* Round is in the slug because a later round may reuse a compass name,
           and the slug is unique per tournament. */
        slug: slugify(`${league.name}-r${target.roundNumber}`),
        leagueNumber,
        teamSlots: league.managers.length,
        currentTeamCount: league.managers.length,
        status: 'forming',
      })
      slots.push({ tournamentLeagueId: id, name: league.name, teamSlots: league.managers.length })

      league.managers.forEach((m, index) => {
        participantRows.push({
          id: randomUUID(),
          tournamentLeagueId: id,
          participantId: m.participantId,
          userId: `pending:${m.participantId}`,
          /* ⚠ The seed is kept as the draft slot: the order is the whole point
             of the snake, and losing it here would make the assignment
             unreproducible from the record. */
          draftSlot: index + 1,
        })
      })
    }
  }

  if (leagueRows.length === 0) {
    return { ok: false, error: 'The plan places nobody, so there is nothing to commit.', status: 400 }
  }

  /*
   * ⚠ THE PARTICIPANT'S REAL IDENTITY IS COPIED FROM THEIR CURRENT ROW, not
   * invented. `TournamentLeagueParticipant.userId` is what the board matches on,
   * and a placeholder would make every manager in round 2 unmatched.
   */
  const identities = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: args.tournamentId },
    select: { id: true, userId: true },
  })
  const userIdByParticipant = new Map(identities.map((p) => [p.id, p.userId]))
  for (const row of participantRows) {
    const real = userIdByParticipant.get(String(row.participantId))
    if (real) row.userId = real
  }
  const unresolved = participantRows.filter((r) => String(r.userId).startsWith('pending:'))
  if (unresolved.length > 0) {
    return {
      ok: false,
      error: `${unresolved.length} advancing managers have no identity on file — the round was not created.`,
      status: 400,
    }
  }

  await prisma.$transaction([
    prisma.tournamentLeague.createMany({ data: leagueRows as never }),
    prisma.tournamentLeagueParticipant.createMany({ data: participantRows as never }),
    prisma.tournamentAuditLog.create({
      data: {
        tournamentId: args.tournamentId,
        roundNumber: target.roundNumber,
        action: 'redraft.committed',
        actorType: 'commissioner',
        actorId: args.commissionerUserId,
        targetType: 'round',
        targetId: target.id,
        data: {
          leaguesCreated: leagueRows.length,
          managersPlaced: participantRows.length,
          slots: slots.map((s) => ({ name: s.name, teamSlots: s.teamSlots })),
        },
      },
    }),
  ])

  return {
    ok: true,
    roundNumber: target.roundNumber,
    leaguesCreated: leagueRows.length,
    managersPlaced: participantRows.length,
    slots,
  }
}

export type AttachOutcome =
  | { ok: true; tournamentLeagueId: string; leagueName: string; roundNumber: number }
  | { ok: false; error: string; status: 400 | 404 | 409 }

/**
 * Point a committed slot at the league that was actually built.
 *
 * ⚠ THIS IS WHERE THE HUB REJOINS THE TOURNAMENT. Until a slot has a `leagueId`
 * the standings board has nothing to read for that round; once it does, every
 * existing read — records, the cut, compliance, the weekly ingest — follows into
 * round 2 with no further wiring.
 */
export async function attachRedraftLeague(args: {
  tournamentId: string
  commissionerUserId: string
  tournamentLeagueId: string
  leagueId: string
}): Promise<AttachOutcome> {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: args.tournamentId, commissionerId: args.commissionerUserId },
    select: { id: true },
  })
  if (!shell) return { ok: false, error: 'Tournament not found', status: 404 }

  /* ⚠ Scoped to this tournament in the query — the slot id arrives in a body. */
  const slot = await prisma.tournamentLeague.findFirst({
    where: { id: args.tournamentLeagueId, tournamentId: args.tournamentId },
    select: { id: true, name: true, leagueId: true, round: { select: { roundNumber: true } } },
  })
  if (!slot) return { ok: false, error: 'That slot is not in this tournament.', status: 404 }
  if (slot.leagueId) {
    return { ok: false, error: `${slot.name} already has a league attached.`, status: 409 }
  }

  /* ⚠ Ownership applied to the query, so a stranger's league cannot be attached
     and then read through the board. */
  const league = await prisma.league.findFirst({
    where: { id: args.leagueId, userId: args.commissionerUserId },
    select: { id: true, name: true },
  })
  if (!league) return { ok: false, error: 'That league could not be found.', status: 404 }

  /* 🛑 `TournamentLeague.leagueId` is globally unique — name the league rather
     than letting the constraint answer with a column. */
  const taken = await prisma.tournamentLeague.findFirst({
    where: { leagueId: args.leagueId },
    select: { name: true },
  })
  if (taken) {
    return {
      ok: false,
      error: `${league.name?.trim() || 'That league'} is already attached to ${taken.name}.`,
      status: 409,
    }
  }

  await prisma.$transaction([
    prisma.tournamentLeague.update({
      where: { id: slot.id },
      data: { leagueId: args.leagueId, status: 'active' },
    }),
    prisma.tournamentAuditLog.create({
      data: {
        tournamentId: args.tournamentId,
        roundNumber: slot.round?.roundNumber ?? null,
        action: 'redraft.league_attached',
        actorType: 'commissioner',
        actorId: args.commissionerUserId,
        targetType: 'tournament_league',
        targetId: slot.id,
        data: { slot: slot.name, leagueId: args.leagueId, leagueName: league.name ?? null },
      },
    }),
  ])

  return {
    ok: true,
    tournamentLeagueId: slot.id,
    /* ⚠ `League.name` is nullable. Falling back to the slot's own name keeps the
       confirmation readable rather than printing "null attached to BLACK NORTH". */
    leagueName: league.name?.trim() || slot.name,
    roundNumber: slot.round?.roundNumber ?? 0,
  }
}
