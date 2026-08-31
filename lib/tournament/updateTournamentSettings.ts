/**
 * Change a tournament's rules after it has been created.
 *
 * 🛑 THE CUT IS A SETTING, AND SETTINGS ARE GOT WRONG AT SETUP. How many
 * advance, whether there is a bubble and how big it is — these are entered
 * before a season anybody has played, and the first time they are checked
 * against reality is when the board draws the line. Without this, correcting a
 * number meant rebuilding the tournament and re-linking 240 managers.
 *
 * ⚠ CHANGING THESE MOVES THE LINE, IT DOES NOT MOVE ANYBODY. The board is a
 * read; advancement is a separate deliberate act. Editing `wildcardCount` after
 * an advancement has run does not un-advance the people it advanced, and the
 * caller is told when that has already happened rather than left to assume the
 * edit is retroactive.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'

export type SettingsPatch = {
  name?: string
  advancersPerLeague?: number
  wildcardCount?: number
  bubbleEnabled?: boolean
  bubbleSize?: number
  tiebreakerMode?: string
  /** Conference renames, by id. Membership is not editable here. */
  conferenceNames?: Array<{ id: string; name: string }>
}

export type SettingsOutcome =
  | {
      ok: true
      /** True when an advancement has already run, so the change is not retroactive. */
      alreadyAdvanced: boolean
    }
  | { ok: false; error: string; status: 400 | 404 }

const TIEBREAKERS = new Set(['points_for', 'points_against_inverse'])

export async function updateTournamentSettings(args: {
  tournamentId: string
  commissionerUserId: string
  patch: SettingsPatch
}): Promise<SettingsOutcome> {
  const { tournamentId, commissionerUserId, patch } = args

  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, commissionerId: commissionerUserId },
    select: { id: true, currentParticipantCount: true },
  })
  /* Same answer for "not found" and "not yours". */
  if (!shell) return { ok: false, error: 'Tournament not found', status: 404 }

  const data: Record<string, unknown> = {}

  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: 'The tournament needs a name.', status: 400 }
    data.name = name
  }

  const nonNegative = (value: number | undefined, label: string) => {
    if (value === undefined) return null
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      return `${label} has to be a whole number, zero or more.`
    }
    return null
  }

  for (const [value, label, key] of [
    [patch.advancersPerLeague, 'Advancers per league', 'advancersPerLeague'],
    [patch.wildcardCount, 'Advancers per conference', 'wildcardCount'],
    [patch.bubbleSize, 'Bubble size', 'bubbleSize'],
  ] as Array<[number | undefined, string, string]>) {
    const err = nonNegative(value, label)
    if (err) return { ok: false, error: err, status: 400 }
    if (value !== undefined) data[key] = value
  }

  if (patch.bubbleEnabled !== undefined) data.bubbleEnabled = patch.bubbleEnabled

  if (patch.tiebreakerMode !== undefined) {
    if (!TIEBREAKERS.has(patch.tiebreakerMode)) {
      /* ⚠ An unknown tiebreaker does not throw in `compareStandings` — it falls
         through to "tied", silently. Refuse it here rather than let a typo
         quietly flatten the order that decides who advances. */
      return { ok: false, error: 'That tiebreaker is not one I recognise.', status: 400 }
    }
    data.tiebreakerMode = patch.tiebreakerMode
  }

  const renames = (patch.conferenceNames ?? []).filter((c) => c?.id && c.name?.trim())

  if (Object.keys(data).length === 0 && renames.length === 0) {
    return { ok: false, error: 'Nothing to change.', status: 400 }
  }

  /*
   * ⚠ SCOPED TO THIS TOURNAMENT. Conference ids arrive in a request body, so an
   * unscoped update would let a commissioner rename a conference in somebody
   * else's tournament.
   */
  const owned = renames.length
    ? await prisma.tournamentConference.findMany({
        where: { tournamentId, id: { in: renames.map((c) => c.id) } },
        select: { id: true },
      })
    : []
  if (owned.length !== renames.length) {
    return { ok: false, error: 'One of those conferences is not in this tournament.', status: 404 }
  }

  /*
   * Has an advancement already run? `TournamentAdvancementGroup` rows only exist
   * once `identifyQualifiers` has, so their presence is the honest test.
   */
  const alreadyAdvanced =
    (await prisma.tournamentAdvancementGroup.count({ where: { tournamentId } })) > 0

  await prisma.$transaction([
    ...(Object.keys(data).length > 0
      ? [prisma.tournamentShell.update({ where: { id: tournamentId }, data })]
      : []),
    ...renames.map((c) =>
      prisma.tournamentConference.update({
        where: { id: c.id },
        data: { name: c.name.trim() },
      }),
    ),
    prisma.tournamentAuditLog.create({
      data: {
        tournamentId,
        action: 'tournament.settings_changed',
        actorType: 'commissioner',
        actorId: commissionerUserId,
        /* ⚠ `data` here is a `Record<string, unknown>` built above, and Prisma's
           Json input will not take that type — the other audit writes in this
           feature pass object literals, which infer as assignable. */
        data: toPrismaJsonInput({ changed: data, conferenceNames: renames, alreadyAdvanced }),
      },
    }),
  ])

  return { ok: true, alreadyAdvanced }
}
