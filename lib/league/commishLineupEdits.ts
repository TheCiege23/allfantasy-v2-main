/**
 * Commish lineup editor: set any team's starters (slot by slot), bench, IR, taxi and devy for the
 * current week. Rearranges the players a team already has — adds, drops and moves between teams are
 * Edit Rosters (lib/league/commishRosterEdits.ts).
 *
 * The write goes through `commissionerForceRosterLineup`, the lineup engine's commish path: it checks
 * the league's slot template, skips kickoff and "lock all moves" locks (fixing a lineup is the point),
 * keeps `RedraftRosterPlayer.slotType` in step so SCORING follows the new lineup, records move history
 * and audits.
 *
 * 🛑 THE CALLER SENDS PLAYER IDS PER SECTION, NEVER `playerData`. The older commish override route takes
 * a raw `playerData` object, which can name players the team does not have. Here the submitted ids must
 * be exactly the team's current players, each once — the lineup is rebuilt server-side from rows we read.
 *
 * ⚠ STARTERS ARE POSITIONAL. `starters[i]` fills the i-th expanded template slot (QB, RB1, RB2, …, FLEX),
 * and the persisted array has no hole marker — an empty string is dropped on save, which would slide
 * every later starter up into the wrong slot. So an empty slot is accepted only after the last filled one.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { expandStarterSlots, fitsSlot, type ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import {
  buildPlayerDataFromSections,
  getNormalizedLineupSections,
  getSlotLimitsFromTemplate,
  type RosterSectionKey,
} from '@/lib/roster/LineupTemplateValidation'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { commissionerForceRosterLineup } from '@/lib/roster-lineup-engine/commissionerRosterOverride'

export class CommishLineupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export const RESERVE_SECTIONS = ['bench', 'ir', 'taxi', 'devy'] as const
export type ReserveSection = (typeof RESERVE_SECTIONS)[number]

export type CommishLineupInput = {
  /** One entry per expanded starter slot; '' (or null) for an empty slot. */
  starters: Array<string | null>
} & Record<ReserveSection, string[]>

export type LineupPlayer = { id: string; name: string; position: string | null; team: string | null }

/**
 * Structural checks with no database: the submitted ids are exactly the roster, each once; starters
 * fit their slots with no gap above a filled slot; no section is over its limit. Exported for tests.
 */
export function validateCommishLineup(input: {
  lineup: CommishLineupInput
  rosterIds: string[]
  slots: Array<Pick<ExpandedStarterSlot, 'label' | 'allowedPositions'>>
  limits: Record<RosterSectionKey, number>
  positionOf: (id: string) => string | null
  nameOf: (id: string) => string
}): string | null {
  const { lineup, slots, limits } = input
  if (lineup.starters.length > slots.length) return 'There are more starters than starting slots.'
  const starters = lineup.starters.map((s) => (s ?? '').trim())
  const lastFilled = starters.reduce((last, id, i) => (id ? i : last), -1)
  if (starters.slice(0, lastFilled).some((id) => !id)) {
    return 'Fill the starting slots from the top: an empty slot can only come after the last filled one.'
  }
  const placed = [...starters.filter(Boolean), ...RESERVE_SECTIONS.flatMap((k) => lineup[k])]
  if (new Set(placed).size !== placed.length) return 'Each player can be in only one spot.'
  const roster = new Set(input.rosterIds)
  if (placed.some((id) => !roster.has(id))) return 'A player is not on this team.'
  if (placed.length !== roster.size) return 'Every player on the team needs a spot.'
  for (let i = 0; i < starters.length; i += 1) {
    const id = starters[i]
    if (id && !fitsSlot(slots[i]!, input.positionOf(id))) {
      return `${input.nameOf(id)} cannot start at ${slots[i]!.label}.`
    }
  }
  for (const k of RESERVE_SECTIONS) {
    if (lineup[k].length > limits[k]) {
      return limits[k] === 0 ? `This league has no ${k.toUpperCase()} spots.` : `${k.toUpperCase()} holds at most ${limits[k]}.`
    }
  }
  return null
}

async function loadContext(leagueId: string, rosterId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, sport: true, leagueVariant: true, settings: true, season: true },
  })
  if (!league) throw new CommishLineupError('League not found', 404)
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
    throw new CommishLineupError('Imported leagues are edited on their host platform.', 409)
  }
  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { id: true, playerData: true, redraftRosterId: true },
  })
  if (!roster) throw new CommishLineupError('That team is not in this league.', 404)

  const sport = String(league.sport ?? 'NFL')
  let template
  try {
    template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, league.leagueVariant ?? undefined), leagueId)
  } catch {
    throw new CommishLineupError('Could not load this league’s lineup slots.', 409)
  }
  const slots = expandStarterSlots(template)
  const limits = getSlotLimitsFromTemplate(template)

  const rosterIds = getRosterPlayerIds(roster.playerData)
  const sections = getNormalizedLineupSections(roster.playerData)
  const rows = roster.redraftRosterId
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: roster.redraftRosterId, droppedAt: null },
        select: { playerId: true, playerName: true, position: true, team: true },
      })
    : []
  const meta = new Map(rows.map((r) => [r.playerId, r]))
  const sectionRow = new Map(
    (Object.keys(sections) as RosterSectionKey[]).flatMap((k) => sections[k].map((row) => [String(row.id), row] as const)),
  )
  const players: LineupPlayer[] = rosterIds.map((id) => {
    const m = meta.get(id)
    const row = sectionRow.get(id) ?? {}
    const rowPos = typeof row.position === 'string' && row.position !== 'UTIL' ? row.position : null
    const rowName = typeof row.name === 'string' && row.name !== id ? row.name : null
    return {
      id,
      name: (m?.playerName && m.playerName !== id ? m.playerName : rowName) ?? id,
      position: m?.position ?? rowPos,
      team: m?.team ?? (typeof row.team === 'string' && row.team !== '—' ? row.team : null),
    }
  })

  // Current placement. Players the sections do not mention (an older roster shape) sit on the bench.
  const placed = new Set<string>()
  const pick = (k: RosterSectionKey) =>
    sections[k].map((r) => String(r.id)).filter((id) => rosterIds.includes(id) && !placed.has(id) && placed.add(id))
  const current = {
    starters: pick('starters').slice(0, slots.length),
    bench: [] as string[],
    ir: pick('ir'),
    taxi: pick('taxi'),
    devy: pick('devy'),
  }
  current.bench = [...pick('bench'), ...rosterIds.filter((id) => !placed.has(id))]

  return { league, roster, slots, limits, players, current, sectionRow, rosterIds }
}

export async function loadCommishLineup(leagueId: string, rosterId: string) {
  const ctx = await loadContext(leagueId, rosterId)
  return {
    rosterId,
    week: weekFromLeagueSettingsForLineup(ctx.league.settings),
    slots: ctx.slots.map((s) => ({ label: s.label, allowedPositions: s.allowedPositions })),
    limits: ctx.limits,
    players: ctx.players,
    lineup: {
      starters: Array.from({ length: ctx.slots.length }, (_, i) => ctx.current.starters[i] ?? ''),
      bench: ctx.current.bench,
      ir: ctx.current.ir,
      taxi: ctx.current.taxi,
      devy: ctx.current.devy,
    },
  }
}

export async function saveCommishLineup(input: {
  leagueId: string
  rosterId: string
  lineup: CommishLineupInput
  actorUserId: string
}) {
  const ctx = await loadContext(input.leagueId, input.rosterId)
  if (await isRosterChopped(input.leagueId, input.rosterId)) {
    throw new CommishLineupError('A chopped Guillotine team cannot change.', 409)
  }
  const byId = new Map(ctx.players.map((p) => [p.id, p]))
  const problem = validateCommishLineup({
    lineup: input.lineup,
    rosterIds: ctx.rosterIds,
    slots: ctx.slots,
    limits: ctx.limits,
    positionOf: (id) => byId.get(id)?.position ?? null,
    nameOf: (id) => byId.get(id)?.name ?? id,
  })
  if (problem) throw new CommishLineupError(problem)

  // Rebuild the rows from what we read, keeping any metadata the stored rows already carried.
  const rowFor = (id: string): Record<string, unknown> => {
    const p = byId.get(id)!
    return { ...(ctx.sectionRow.get(id) ?? {}), id, name: p.name, position: p.position ?? 'UTIL', team: p.team ?? '—' }
  }
  const sections: Record<RosterSectionKey, Array<Record<string, unknown>>> = {
    starters: input.lineup.starters.map((s) => (s ?? '').trim()).filter(Boolean).map(rowFor),
    bench: input.lineup.bench.map(rowFor),
    ir: input.lineup.ir.map(rowFor),
    taxi: input.lineup.taxi.map(rowFor),
    devy: input.lineup.devy.map(rowFor),
  }
  const week = weekFromLeagueSettingsForLineup(ctx.league.settings)
  const result = await commissionerForceRosterLineup({
    leagueId: input.leagueId,
    rosterId: input.rosterId,
    commissionerUserId: input.actorUserId,
    nextPlayerData: buildPlayerDataFromSections(ctx.roster.playerData, sections),
    season: ctx.league.season ?? new Date().getFullYear(),
    week,
    reason: 'Set by the commish in Edit Lineup',
  })
  if (!result.ok) throw new CommishLineupError(result.error, result.status ?? 400)
  return loadCommishLineup(input.leagueId, input.rosterId)
}
