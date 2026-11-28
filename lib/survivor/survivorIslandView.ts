/**
 * Pure wording and sums for the standalone island pages (app/survivor/[leagueId]/*), kept here so
 * the pages and their tests agree.
 *
 * ⚠ A DEADLINE THAT HAS PASSED IS "CLOSED", NEVER "SOON". The home banner used to fall back to
 * "Council vote closes in Soon" once the clock ran out, the status card said "in under a minute"
 * forever, and the challenges page showed "0m remaining" on a closed challenge (audit 2026-11-23).
 * A council the host has not read yet still reports `voting_open`, so the clock — not the status —
 * decides whether a vote can still be cast.
 */

export type IslandHeroInput = {
  councilStatus?: string | null
  voteEnd?: number | null
  challengeStatus?: string | null
  challengeEnd?: number | null
  phase: string
  now: number
  challengeText?: string | null
}

export type IslandHeroCopy = { title: string; subtext: string; voteClosed: boolean; challengeClosed: boolean }

export function islandHeroCopy(input: IslandHeroInput): IslandHeroCopy {
  const { councilStatus, voteEnd, challengeStatus, challengeEnd, phase, now } = input
  const voteClosed = voteEnd != null && voteEnd <= now
  const challengeClosed = challengeEnd != null && challengeEnd <= now
  if (councilStatus === 'voting_open' && voteClosed) {
    return { title: 'The votes are in', subtext: 'The host reads them next. Watch league chat for the read.', voteClosed, challengeClosed }
  }
  if (councilStatus === 'voting_open') {
    return { title: 'Tribal Council is open', subtext: 'Votes are private until the host reads them.', voteClosed, challengeClosed }
  }
  if (challengeStatus === 'open' && !challengeClosed) {
    return { title: 'This week’s challenge is open', subtext: input.challengeText || 'Points and immunity are on the line.', voteClosed, challengeClosed }
  }
  if (phase === 'merge') {
    return { title: 'Merge week', subtext: 'Buffs drop. From here on, immunity is earned as an individual.', voteClosed, challengeClosed }
  }
  return { title: 'This week on the island', subtext: 'Score well. The host posts swaps, twists and the read in league chat.', voteClosed, challengeClosed }
}

/** "1h 30m left", "2d 0h left", or "Closed" once the time has passed. */
export function islandDeadlineLabel(end: number, now: number): string {
  const ms = end - now
  if (!Number.isFinite(ms) || ms <= 0) return 'Closed'
  const minutes = Math.floor(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${Math.max(1, m)}m left`
}

type WeeklyScoreLike = { userId: string; tribeId?: string | null; finalScore: number; countedTowardTribeTotal?: boolean | null }

/** Tribe totals for the week from the counted scores: the numbers the home page's tribe cards show. */
export function islandTribeTotals(scores: readonly WeeklyScoreLike[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const score of scores) {
    if (score.tribeId && score.countedTowardTribeTotal) totals.set(score.tribeId, (totals.get(score.tribeId) ?? 0) + score.finalScore)
  }
  return totals
}

export type IslandMemberBadge = 'immune' | 'exiled' | 'jury' | 'finalist' | 'eliminated'

type MemberLike = {
  playerState?: string | null
  hasImmunityThisWeek?: boolean | null
  isJuryMember?: boolean | null
  isFinalist?: boolean | null
  eliminatedWeek?: number | null
}

/**
 * Only what sets a member apart. An ordinary member gets no badge: the tribe header already says
 * once whether the whole tribe is at Tribal Council, so "VULNERABLE" on every card said it again
 * five times, on the viewer's own card too.
 */
export function islandMemberBadge(p: MemberLike): IslandMemberBadge | null {
  if (p.playerState === 'eliminated' || (p.eliminatedWeek != null && p.eliminatedWeek > 0 && p.playerState !== 'exile' && p.playerState !== 'jury')) return 'eliminated'
  if (p.playerState === 'exile') return 'exiled'
  if (p.isJuryMember || p.playerState === 'jury') return 'jury'
  if (p.isFinalist) return 'finalist'
  if (p.hasImmunityThisWeek) return 'immune'
  return null
}

type EpisodeLike = { week: number; scenes: Array<{ label: string; text: string }> }

/**
 * The Tribal line of an episode card. ⚠ No Tribal scene is not "nobody went home": stored recaps
 * use other labels, and the current week's recap can exist while its vote is still open.
 */
export function islandEpisodeTribalLine(episode: EpisodeLike, ctx: { openCouncilWeek: number | null; votesClosed?: boolean }): string | null {
  const written = episode.scenes.find((s) => s.label === 'Tribal Council' || s.label === 'Tribal')?.text
  if (written) return written
  if (ctx.openCouncilWeek != null && episode.week === ctx.openCouncilWeek) {
    return ctx.votesClosed ? 'The votes are in. The host reads them next.' : 'The vote is still open.'
  }
  return null
}

const PHASE_LABEL: Record<string, string> = {
  pre_draft: 'Before the draft',
  drafting: 'Draft',
  merge: 'Merge',
  jury: 'Jury',
  finale: 'Finale',
}

/** The top bar's second line: "NFL Survivor · Week 9" rather than a bare "Survivor · Season". */
export function islandSeasonLabel(input: { sport?: string | null; week?: number | null; phase: string }): string {
  const name = input.sport ? `${input.sport} Survivor` : 'Survivor'
  if (input.phase === 'pre_draft' || input.phase === 'drafting') return `${name} · ${PHASE_LABEL[input.phase]}`
  return input.week ? `${name} · Week ${input.week}` : name
}

/** A challenge's scope in words: "Tribe challenge", "Individual challenge". */
export function islandChallengeScopeWord(scope: string | null | undefined): string {
  const raw = String(scope ?? 'tribe').toLowerCase()
  if (raw === 'tribe') return 'Tribe challenge'
  if (raw === 'individual') return 'Individual challenge'
  if (raw === 'exile') return 'Exile challenge'
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1).replace(/_/g, ' ')} challenge`
}

export function islandExileCountLine(count: number): string {
  return `${count} ${count === 1 ? 'player' : 'players'} on Exile`
}
