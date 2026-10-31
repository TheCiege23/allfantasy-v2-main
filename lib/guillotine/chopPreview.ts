/**
 * "Chop week preview" for the commissioner: what this week's chop would do if it ran on the scores as
 * they stand — who goes, who is in the danger zone, where the chopped team's FAAB lands, what reaches
 * waivers and what league chat will say. Nothing is written.
 *
 * Pure, and built from the engine's OWN rules rather than a copy of them, so the preview cannot drift
 * from the real chop (./GuillotineEliminationEngine.ts):
 *   scheduledChops  how many teams this week (steps, double-chop and no-chop weeks)
 *   immuneRosterIds / applyImmunity   last week's top scorer
 *   resolveTiebreak the lowest N, with the league's tiebreak order at the boundary
 *   splitChoppedFaab  the FAAB split (./faabOnChop.ts)
 *   chopAnnouncementText  the chat post (./chopAnnouncement.ts)
 * The loader (./chopPreviewLoad.ts) gathers the inputs the same way the native week runner does.
 */
import { applyImmunity, immuneRosterIds, scheduledChops, type GuillotineAdvanced } from './chopSchedule'
import { resolveTiebreak, type DraftSlotByRoster } from './GuillotineTiebreakResolver'
import { splitChoppedFaab, type FaabOnChop } from './faabOnChop'
import { chopAnnouncementText } from './chopAnnouncement'
import { RELEASE_OPTIONS, TIEBREAK_OPTIONS, type GuillotineRules } from './guillotineRules'
import type { TiebreakStep } from './types'

export type ChopPreviewTeam = {
  rosterId: string
  name: string
  periodPoints: number
  seasonPointsCumul: number
  benchPoints?: number
  previousPeriodPoints?: number
  /** Unspent FAAB; null when the league has no FAAB budget. */
  faab: number | null
  /** Players still on the roster — what reaches waivers if this team is chopped. */
  playerCount: number
}

export type ChopPreviewInput = {
  week: number
  /** 'live': games still to play this week, so the order can change. 'final': waiting on the correction window. */
  weekState: 'live' | 'final'
  eliminationStartWeek: number
  eliminationEndWeek: number | null
  teamsPerChop: number
  advanced: GuillotineAdvanced
  endgame: { format: string; threshold: number }
  tiebreakerOrder: TiebreakStep[]
  dangerMarginPoints: number
  faabOnChop: FaabOnChop
  rosterReleaseTiming: GuillotineRules['rosterReleaseTiming'] | string
  teams: ChopPreviewTeam[]
  /** Last week's scores, for immunity. */
  previousWeek: ReadonlyArray<{ rosterId: string; periodPoints: number }>
  draftSlotByRoster: DraftSlotByRoster
  /** Problems the loader found that would stop the real chop (e.g. a team the engine cannot place). */
  blockers: string[]
}

export type ChopPreviewRow = {
  rosterId: string
  name: string
  points: number
  status: 'chopped' | 'danger' | 'immune' | 'safe'
  /** Points above the chop line (0 or less for a chopped team). */
  margin: number | null
  /** Season points through this week, live (the tiebreak's season_points). */
  seasonPoints?: number
  /** FAAB this team gains from the split (survivors) or loses (chopped). */
  faabChange: number | null
}

export type ChopPreview = {
  week: number
  weekState: 'live' | 'final'
  /** What happens this week. Only 'chop' fills the rest. */
  outcome: 'chop' | 'before_first_chop' | 'past_last_chop' | 'no_chop_week' | 'final_stage' | 'season_over'
  /** A sentence for the header. */
  headline: string
  chopCount: number
  rows: ChopPreviewRow[]
  /** The highest score that is still chopped. */
  chopLine: number | null
  /** How the boundary was settled when teams tied on it. */
  tiebreak: string | null
  faab: { mode: FaabOnChop; pool: number; note: string } | null
  release: { players: number; when: string } | null
  announcement: string | null
  notes: string[]
  blockers: string[]
}

const round1 = (n: number) => Math.round(n * 10) / 10
const teams = (n: number) => (n === 1 ? '1 team' : `${n} teams`)

export function buildChopPreview(input: ChopPreviewInput): ChopPreview {
  const base = {
    week: input.week,
    weekState: input.weekState,
    chopCount: 0,
    rows: [] as ChopPreviewRow[],
    chopLine: null,
    tiebreak: null,
    faab: null,
    release: null,
    announcement: null,
    notes: [] as string[],
    blockers: input.blockers,
  }
  const alive = input.teams.length
  if (input.week < input.eliminationStartWeek) {
    return { ...base, outcome: 'before_first_chop', headline: `No chop in week ${input.week}. The first chop is week ${input.eliminationStartWeek}.` }
  }
  if (input.eliminationEndWeek != null && input.week > input.eliminationEndWeek) {
    return { ...base, outcome: 'past_last_chop', headline: `Chops ended in week ${input.eliminationEndWeek}.` }
  }
  if (input.endgame.format === 'last_team_standing' ? alive <= 1 : alive <= input.endgame.threshold) {
    return input.endgame.format === 'last_team_standing'
      ? { ...base, outcome: 'season_over', headline: 'One team is left — the season is decided.' }
      : { ...base, outcome: 'final_stage', headline: `${teams(alive)} left: the final stage decides the champion, with no more chops.` }
  }
  const weekChops = scheduledChops(input.advanced, input.week, input.teamsPerChop)
  if (weekChops === 0) {
    return { ...base, outcome: 'no_chop_week', headline: `Week ${input.week} is a no-chop week on your schedule. Scores still count for tiebreaks.` }
  }

  const chopCount = Math.max(0, Math.min(weekChops, alive - input.endgame.threshold))
  const scores = input.teams.map((t) => ({
    rosterId: t.rosterId,
    periodPoints: t.periodPoints,
    seasonPointsCumul: t.seasonPointsCumul,
    ...(t.benchPoints != null ? { benchPoints: t.benchPoints } : {}),
    ...(t.previousPeriodPoints != null ? { previousPeriodPoints: t.previousPeriodPoints } : {}),
  }))
  const immunity = applyImmunity(scores, immuneRosterIds(input.advanced, input.previousWeek, input.teams.map((t) => t.rosterId)), chopCount)
  const { choppedRosterIds, stepUsed } = resolveTiebreak({
    candidates: immunity.candidates,
    tiebreakerOrder: input.tiebreakerOrder,
    teamsPerChop: chopCount,
    weekOrPeriod: input.week,
    draftSlotByRoster: input.draftSlotByRoster,
  })
  const chopped = new Set(choppedRosterIds)
  const immune = new Set(immunity.protectedIds)
  const byId = new Map(input.teams.map((t) => [t.rosterId, t]))
  const chopLine = choppedRosterIds.length ? Math.max(...choppedRosterIds.map((id) => byId.get(id)!.periodPoints)) : null

  // FAAB: the same split the chop applies — survivors with a budget share the chopped teams' leftover.
  let faab: ChopPreview['faab'] = null
  const faabChange = new Map<string, number>()
  const survivorsWithFaab = input.teams.filter((t) => !chopped.has(t.rosterId) && t.faab != null).map((t) => ({ rosterId: t.rosterId, faab: t.faab as number }))
  const pool = choppedRosterIds.reduce((sum, id) => sum + Math.max(0, byId.get(id)!.faab ?? 0), 0)
  if (input.teams.some((t) => t.faab != null)) {
    if (input.faabOnChop === 'split' && survivorsWithFaab.length > 0) {
      const split = splitChoppedFaab(pool, survivorsWithFaab)
      for (const [id, amount] of split.shares) faabChange.set(id, amount)
      for (const id of choppedRosterIds) if ((byId.get(id)!.faab ?? 0) > 0) faabChange.set(id, -(byId.get(id)!.faab as number))
      faab = {
        mode: 'split',
        pool: split.pool,
        note: split.pool > 0
          ? `$${split.pool} is shared by the ${survivorsWithFaab.length} survivors.`
          : 'The chopped team has no FAAB left to share.',
      }
    } else {
      faab = { mode: 'keep', pool, note: pool > 0 ? `$${pool} leaves the league with the chopped team.` : 'The chopped team has no FAAB left.' }
    }
  }

  const ordered = [...input.teams].sort((a, b) => a.periodPoints - b.periodPoints || a.name.localeCompare(b.name))
  const rows: ChopPreviewRow[] = ordered.map((t) => {
    const margin = chopLine == null ? null : round1(t.periodPoints - chopLine)
    const status: ChopPreviewRow['status'] = chopped.has(t.rosterId)
      ? 'chopped'
      : immune.has(t.rosterId)
        ? 'immune'
        : margin != null && margin <= input.dangerMarginPoints
          ? 'danger'
          : 'safe'
    return { rosterId: t.rosterId, name: t.name, points: round1(t.periodPoints), seasonPoints: round1(t.seasonPointsCumul), status, margin, faabChange: faabChange.get(t.rosterId) ?? null }
  })

  const notes: string[] = []
  if (input.weekState === 'live') notes.push('Games are still being played, so this order will change. The chop only runs once every game is final.')
  if (immunity.protectedIds.length) {
    notes.push(`${immunity.protectedIds.map((id) => byId.get(id)!.name).join(' and ')} ${immunity.protectedIds.length === 1 ? 'is' : 'are'} immune as last week's top scorer.`)
  }
  const tieLabel = stepUsed ? (TIEBREAK_OPTIONS.find((o) => o.value === stepUsed)?.label ?? stepUsed) : null
  if (stepUsed === 'random') notes.push('A tie on the chop line would be settled by a random draw, so the real chop may pick the other team.')
  if (stepUsed === 'commissioner') notes.push('A tie on the chop line is set to be settled by you. The chop will wait for your pick.')

  const names = choppedRosterIds.map((id) => byId.get(id)!.name)
  return {
    ...base,
    outcome: 'chop',
    headline: input.weekState === 'live'
      ? `If week ${input.week} ended now, ${names.join(' and ')} would be chopped.`
      : `Week ${input.week} is final: ${names.join(' and ')} will be chopped when the correction window closes.`,
    chopCount,
    rows,
    chopLine: chopLine == null ? null : round1(chopLine),
    tiebreak: tieLabel,
    faab,
    release: {
      players: choppedRosterIds.reduce((sum, id) => sum + byId.get(id)!.playerCount, 0),
      when: RELEASE_OPTIONS.find((o) => o.value === input.rosterReleaseTiming)?.label ?? RELEASE_OPTIONS[0].label,
    },
    announcement: chopAnnouncementText(input.week, names),
    notes,
  }
}
