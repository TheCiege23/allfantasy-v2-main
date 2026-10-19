/**
 * "This week's stakes" for the specialty formats — what is on the line right now, in a few lines,
 * for the league home. Pure: each function takes the format's existing summary payload
 * (`/survivor/summary`, `/big-brother/summary`, `/guillotine/summary`) and returns what to show,
 * or `null` when the season has not produced any stakes yet (before the draft, before the first
 * cycle), so the home shows nothing rather than an empty card.
 *
 * The phase labels used to live inside `SpecialtyLeagueHomeHero`; they moved here so the hero and
 * the native home cannot disagree about what phase a league is in.
 */
import type { BigBrotherSummary } from '@/components/big-brother/types'
import type { SurvivorSummary } from '@/components/survivor/types'

export type StakesTone = 'danger' | 'good' | 'neutral'
export type StakesLine = { label: string; value: string; tone?: StakesTone }

export type FormatStakes = {
  format: 'survivor' | 'big_brother' | 'guillotine'
  /** "Tribal Council", "Veto", "Week 6 chop". */
  title: string
  week: number | null
  lines: StakesLine[]
  /** What this means for the viewer, when the payload says. */
  you: { text: string; tone: StakesTone } | null
  /** A vote or lock the viewer can still act before. */
  deadlineIso: string | null
  deadlineLabel: string | null
  /** The league tab that holds the detail. */
  tab: string
  cta: string
}

// ── Survivor ─────────────────────────────────────────────────────────────────────────────────

export type SurvivorPhase = { label: string; mood: 'default' | 'jury' | 'tribal' | 'merge' | 'exile' }

/** Only the fields the phase reads, so the hero's narrower local summary type fits too. */
export type SurvivorPhaseInput = {
  currentWeek: number
  merged: boolean
  jury: readonly unknown[]
  exileLeagueId: string | null
  council: { phase: string } | null
  finale?: { open: boolean; closed: boolean } | null
}

export function survivorPhase(summary: SurvivorPhaseInput | null): SurvivorPhase {
  if (!summary) return { label: '…', mood: 'default' }
  const w = summary.currentWeek
  if (summary.finale?.open || summary.finale?.closed) return { label: 'Finale', mood: 'jury' }
  if (summary.jury.length > 0 && summary.merged) return { label: `Jury · Week ${w}`, mood: 'jury' }
  if (summary.council?.phase === 'voting_open' || summary.council?.phase === 'votes_tallying') return { label: 'Tribal Council', mood: 'tribal' }
  if (summary.merged) return { label: `Merge · Week ${w}`, mood: 'merge' }
  if (summary.exileLeagueId) return { label: `Island · Week ${w}`, mood: 'exile' }
  return { label: `Tribe Phase · Week ${w}`, mood: 'default' }
}

function survivorName(summary: SurvivorSummary, rosterId: string | null | undefined): string {
  if (!rosterId) return 'A castaway'
  return summary.rosterDisplayNames?.[rosterId] ?? 'A castaway'
}

export function survivorStakes(summary: SurvivorSummary | null): FormatStakes | null {
  if (!summary) return null
  const started = summary.tribes.length > 0 || summary.council != null || summary.challenges.length > 0
  if (!started) return null
  const week = summary.currentWeek
  const tribeName = new Map(summary.tribes.map((tribe) => [tribe.id, tribe.name]))
  const lines: StakesLine[] = []
  let you: FormatStakes['you'] = null

  if (summary.finale?.open || summary.finale?.closed) {
    const finale = summary.finale
    lines.push({ label: 'Finalists', value: finale.finalists.map((f) => survivorName(summary, f.rosterId)).join(', ') || 'Being decided' })
    lines.push({ label: 'Jury votes', value: `${finale.juryVotesSubmitted} of ${finale.juryVotesRequired} in` })
    if (finale.winnerRosterId) lines.push({ label: 'Last one standing', value: survivorName(summary, finale.winnerRosterId), tone: 'good' })
    return { format: 'survivor', title: 'Finale', week, lines, you, deadlineIso: null, deadlineLabel: null, tab: 'survivor_jury', cta: 'Open the finale' }
  }

  // Immunity: this week's challenge result, by tribe before the merge and by name after it.
  const challenge = summary.challenges.find((c) => c.week === week && (c.winnerTribeId || (c.winnerUserNames?.length ?? 0) > 0))
  const openChallenge = summary.challenges.find((c) => c.week === week && !c.resultJson && c.lockAt)
  if (challenge) {
    const winner = challenge.winnerTribeId ? tribeName.get(challenge.winnerTribeId) ?? 'A tribe' : (challenge.winnerUserNames ?? []).join(', ')
    lines.push({ label: 'Immunity', value: winner, tone: 'good' })
    if (summary.myTribeId && challenge.winnerTribeId === summary.myTribeId) you = { text: 'Your tribe won immunity this week.', tone: 'good' }
  } else {
    lines.push({ label: 'Immunity', value: openChallenge ? 'Challenge in progress' : 'Not decided yet' })
  }

  // Council: who is going, and whether the vote is still open.
  const council = summary.council && summary.council.week === week ? summary.council : null
  let deadlineIso: string | null = null
  if (council) {
    const going = summary.merged ? 'Everyone' : council.attendingTribeId ? tribeName.get(council.attendingTribeId) ?? 'A tribe' : 'To be decided'
    lines.push({ label: 'Tribal Council', value: going, tone: 'danger' })
    if (council.closedAt) {
      if (council.eliminatedRosterId && council.isRevealed !== false) {
        lines.push({ label: 'Voted out', value: survivorName(summary, council.eliminatedRosterId), tone: 'danger' })
      }
    } else if (council.voteDeadlineAt) {
      deadlineIso = council.voteDeadlineAt
    }
    const yourTribeGoing = summary.merged || (summary.myTribeId != null && council.attendingTribeId === summary.myTribeId)
    // A castaway already voted out keeps a roster id but has no vote.
    const stillIn = summary.myRosterId != null && !summary.votedOutHistory.some((v) => v.rosterId === summary.myRosterId)
    if (yourTribeGoing && !council.closedAt && stillIn) you = { text: 'You are going to Tribal Council. Cast your vote before it closes.', tone: 'danger' }
  }

  if (summary.myTribeId && !summary.merged) lines.push({ label: 'Your tribe', value: tribeName.get(summary.myTribeId) ?? 'Your tribe' })

  const voting = council != null && !council.closedAt
  return {
    format: 'survivor',
    title: survivorPhase(summary).label,
    week,
    lines,
    you,
    deadlineIso,
    deadlineLabel: deadlineIso ? 'Votes close' : null,
    tab: voting ? 'survivor_tribal' : 'survivor',
    cta: voting ? 'Go to Tribal Council' : 'Open the island',
  }
}

// ── Big Brother ──────────────────────────────────────────────────────────────────────────────

export function bigBrotherPhaseLabel(summary: BigBrotherSummary | null): string {
  if (!summary?.cycle) return 'House'
  const phase = String(summary.cycle.phase ?? '').toLowerCase()
  if (phase.includes('jury') || (summary.eligibility?.juryRosterIds?.length ?? 0) > 0) return 'Jury Phase'
  if (phase.includes('veto')) return 'Veto'
  if (phase.includes('nom')) return 'Nominations'
  if (phase.includes('vote') || phase.includes('evict')) return 'Eviction'
  if (phase.includes('hoh')) return 'Head of Household'
  return `Week ${summary.cycle.week}`
}

export function bigBrotherStakes(summary: BigBrotherSummary | null): FormatStakes | null {
  const cycle = summary?.cycle
  if (!summary || !cycle) return null
  const name = (rosterId: string | null | undefined, fallback: string) =>
    rosterId ? summary.rosterDisplayNames?.[rosterId] ?? fallback : null

  const lines: StakesLine[] = []
  lines.push({ label: 'Head of Household', value: name(cycle.hohRosterId, 'HOH') ?? 'Competition open' })
  // After the veto, the final nominees are what matters; before it, the two named on the block.
  const nominees =
    summary.finalNomineeRosterIds.length > 0
      ? summary.finalNomineeRosterIds
      : [cycle.nominee1RosterId, cycle.nominee2RosterId].filter((id): id is string => Boolean(id))
  lines.push({
    label: 'On the block',
    value: nominees.length ? nominees.map((id) => name(id, 'Nominee')).join(' & ') : 'Not nominated yet',
    tone: nominees.length ? 'danger' : undefined,
  })
  lines.push({
    label: 'Power of Veto',
    value: cycle.vetoWinnerRosterId ? `${name(cycle.vetoWinnerRosterId, 'Veto holder')}${cycle.vetoUsed ? ' (used)' : ''}` : 'Not played yet',
  })
  if (cycle.evictedRosterId) lines.push({ label: 'Evicted', value: name(cycle.evictedRosterId, 'A houseguest') ?? '', tone: 'danger' })
  if (typeof summary.remainingCount === 'number') lines.push({ label: 'Houseguests left', value: String(summary.remainingCount) })

  let you: FormatStakes['you'] = null
  if (summary.myStatus === 'HOH') you = { text: "You're Head of Household this week.", tone: 'good' }
  else if (summary.myStatus === 'NOMINATED') you = { text: "You're on the block. Win the veto or work the house.", tone: 'danger' }
  else if (summary.myStatus === 'VETO_PLAYER') you = { text: "You're playing in the veto.", tone: 'neutral' }

  const deadlineIso = cycle.voteDeadlineAt && !summary.ballot?.closed && !cycle.closedAt ? cycle.voteDeadlineAt : null
  return {
    format: 'big_brother',
    title: bigBrotherPhaseLabel(summary),
    week: cycle.week,
    lines,
    you,
    deadlineIso,
    deadlineLabel: deadlineIso ? 'Eviction vote closes' : null,
    tab: deadlineIso ? 'bb_voting' : 'big_brother',
    cta: deadlineIso ? 'Go to the vote' : 'Open the house',
  }
}

// ── Guillotine ───────────────────────────────────────────────────────────────────────────────

export type GuillotineSummaryLite = {
  weekOrPeriod: number
  dangerTiers?: { rosterId: string; displayName?: string | null; tier: 'chop_zone' | 'danger' | 'safe'; pointsFromChopZone: number }[]
  survivalStandings?: { rosterId: string }[]
  choppedThisWeek?: { rosterId: string; displayName?: string | null }[]
  config?: { teamsPerChop?: number | null; eliminationStartWeek?: number | null; eliminationEndWeek?: number | null } | null
  myRosterId?: string | null
}

function fmtPoints(points: number): string {
  return (Math.round(points * 10) / 10).toFixed(1)
}

/**
 * The danger tiers arrive lowest first, but only ONE row is ever tagged `chop_zone` whatever
 * `teamsPerChop` is — so "who goes" is the first `teamsPerChop` rows, and your margin is measured
 * to the last of them, not to the bottom team.
 */
export function guillotineStakes(summary: GuillotineSummaryLite | null): FormatStakes | null {
  const tiers = summary?.dangerTiers ?? []
  if (!summary || tiers.length === 0) return null
  const week = summary.weekOrPeriod
  const perChop = Math.max(1, summary.config?.teamsPerChop ?? 1)
  const startWeek = summary.config?.eliminationStartWeek ?? null
  const chopLine = tiers.slice(0, perChop)
  const lineAt = chopLine[chopLine.length - 1]?.pointsFromChopZone ?? 0
  const label = (row: { rosterId: string; displayName?: string | null }) =>
    `${row.displayName?.trim() || 'A team'}${row.rosterId === summary.myRosterId ? ' (you)' : ''}`

  const lines: StakesLine[] = []
  const beforeChops = startWeek != null && week < startWeek
  lines.push({ label: perChop === 1 ? 'Chop line' : `Chop line (${perChop} go)`, value: chopLine.map(label).join(', '), tone: 'danger' })
  const bubble = tiers.slice(perChop, perChop + 2)
  if (bubble.length) {
    lines.push({ label: 'Just above it', value: bubble.map((row) => `${label(row)} +${fmtPoints(row.pointsFromChopZone - lineAt)}`).join(' · ') })
  }
  if (summary.survivalStandings?.length) lines.push({ label: 'Teams left', value: String(summary.survivalStandings.length) })
  if (summary.choppedThisWeek?.length) lines.push({ label: 'Chopped', value: summary.choppedThisWeek.map(label).join(', '), tone: 'danger' })

  let you: FormatStakes['you'] = null
  const mine = summary.myRosterId ? tiers.find((row) => row.rosterId === summary.myRosterId) : null
  if (mine) {
    if (chopLine.some((row) => row.rosterId === mine.rosterId)) you = { text: "You're on the chop line right now.", tone: 'danger' }
    else you = { text: `You're ${fmtPoints(mine.pointsFromChopZone - lineAt)} pts clear of the chop line.`, tone: mine.tier === 'danger' ? 'neutral' : 'good' }
  }

  return {
    format: 'guillotine',
    title: beforeChops ? `Chops start week ${startWeek}` : `Week ${week} chop`,
    week,
    lines,
    you,
    deadlineIso: null,
    deadlineLabel: null,
    tab: 'guillotine',
    cta: 'Open the Guillotine',
  }
}
