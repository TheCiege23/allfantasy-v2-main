/**
 * "Your status" on the island home page: one look tells a manager where they stand this week and
 * the one or two things they can do right now. Pure: built from the season payload the page already
 * has, and shows only the viewer's own private facts (their idols, their tokens).
 */

import type { SurvivorSeasonPayload } from './survivorUiTypes'

export type SurvivorStatusTone = 'safe' | 'risk' | 'immune' | 'exile' | 'jury' | 'finalist' | 'out'

export type SurvivorStatusCard = {
  tone: SurvivorStatusTone
  headline: string
  detail: string
  facts: Array<{ label: string; value: string }>
  actions: Array<{ label: string; href: string }>
}

type SurvivorStatusInput = {
  season: SurvivorSeasonPayload | null
  canVote: boolean
  canSubmitChallenge: boolean
  base: string
  now: number
  /** Absolute time for a deadline; injectable so tests do not depend on the machine's time zone. */
  formatTime?: (at: Date) => string
}

const defaultFormat = (at: Date) => at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

function until(ms: number): string {
  if (ms <= 60_000) return 'in under a minute'
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`
  return `in ${minutes}m`
}

function parse(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const at = new Date(raw)
  return Number.isFinite(at.getTime()) ? at : null
}

export function buildSurvivorStatusCard(input: SurvivorStatusInput): SurvivorStatusCard | null {
  const { season, base, now } = input
  const me = season?.userState
  if (!season || !me) return null
  const format = input.formatTime ?? defaultFormat
  const when = (at: Date) => `${format(at)} (${until(at.getTime() - now)})`

  const phase = season.phase ?? ''
  const merged = ['merge', 'jury', 'finale'].includes(phase)
  const tribe = merged ? null : (season.tribes ?? []).find(t => t.id === me.tribeId) ?? null
  const council = season.activeCouncil
  const councilOpen = council?.status === 'voting_open'
  const voteDeadline = councilOpen ? parse(council?.voteDeadlineAt ?? council?.votingDeadline) : null
  // ⚠ A council the host has not read yet still says `voting_open` after its deadline. The clock decides.
  const votesIn = Boolean(voteDeadline && voteDeadline.getTime() <= now)
  const voteBy = votesIn ? null : voteDeadline
  const openChallenge = season.currentChallenge?.status === 'open' ? season.currentChallenge : null
  const challengeLock = openChallenge ? parse(openChallenge.locksAt ?? openChallenge.lockAt) : null
  const challenge = challengeLock && challengeLock.getTime() <= now ? null : openChallenge
  const challengeBy = challenge ? challengeLock : null
  const idols = Array.isArray(me.idolIds) ? me.idolIds.length : 0
  const tokens = typeof me.tokenBalance === 'number' ? me.tokenBalance : null

  const facts: SurvivorStatusCard['facts'] = []
  if (tribe) facts.push({ label: 'Tribe', value: tribe.name ?? 'Your tribe' })
  else if (merged && ['active', 'immune'].includes(me.playerState)) facts.push({ label: 'Tribe', value: 'Merged: everyone plays for themselves' })
  if (['active', 'immune'].includes(me.playerState)) facts.push({ label: 'Idols', value: idols ? `You hold ${idols}` : 'None' })
  if (me.playerState === 'exile' || (tokens != null && tokens > 0)) facts.push({ label: 'Tokens', value: String(tokens ?? 0) })
  if (voteBy) facts.push({ label: 'Votes close', value: when(voteBy) })
  else if (votesIn && voteDeadline) facts.push({ label: 'Votes closed', value: format(voteDeadline) })
  else if (challengeBy) facts.push({ label: 'Challenge locks', value: when(challengeBy) })

  const challengeAction = challenge && input.canSubmitChallenge ? [{ label: 'Make your challenge pick', href: `${base}/challenges` }] : []

  if (me.isFinalist) {
    return { tone: 'finalist', headline: 'You made the finale', detail: 'Make your case to the jury. They vote for the winner.', facts, actions: [{ label: 'Go to the finale', href: `${base}/finale` }] }
  }
  if (me.isJuryMember || me.playerState === 'jury') {
    return { tone: 'jury', headline: 'You are on the jury', detail: 'You will vote for the season winner at the finale.', facts, actions: [{ label: 'Open the jury', href: `${base}/jury` }] }
  }
  if (me.playerState === 'exile') {
    return { tone: 'exile', headline: 'You are on Exile Island', detail: 'Keep scoring to earn tokens toward a return. The Rules page explains how.', facts, actions: [{ label: 'Open Exile', href: `${base}/exile` }, ...challengeAction] }
  }
  if (me.playerState === 'eliminated') {
    return { tone: 'out', headline: 'You are out of the game', detail: 'Thanks for playing. Follow the rest of the season in league chat and the episodes.', facts, actions: [{ label: 'Watch the episodes', href: `${base}/episodes` }] }
  }

  if (me.hasImmunityThisWeek) {
    return { tone: 'immune', headline: 'You are immune this week', detail: 'Nobody can vote you out at this council.', facts, actions: [...(councilOpen ? [{ label: 'Vote at Tribal Council', href: `${base}/tribal` }] : []), ...challengeAction] }
  }

  if (councilOpen) {
    const myCouncil = !council?.attendingTribeId || council.attendingTribeId === me.tribeId
    if (myCouncil && votesIn) {
      // The banner above already says "The votes are in"; this card says what it means for you.
      return { tone: 'risk', headline: merged ? 'You are at Tribal Council' : 'Your tribe is at Tribal Council', detail: 'Voting has closed. Someone goes home when the votes are read.', facts, actions: [] }
    }
    if (myCouncil) {
      // The vote button lives in the banner above this card; repeating it here put two on one screen.
      // The deadline is a fact below, so the sentence does not say it again.
      return {
        tone: 'risk',
        headline: merged ? 'Tribal Council is open' : 'Your tribe is at Tribal Council',
        detail: merged ? 'Someone goes home this week.' : 'Someone from your tribe goes home this week.',
        facts,
        actions: idols ? [{ label: 'Play an idol', href: `${base}/tribal` }] : [],
      }
    }
    return { tone: 'safe', headline: 'Your tribe is safe this week', detail: 'Another tribe is at Tribal Council. Watch the read in league chat.', facts, actions: challengeAction }
  }

  if (challengeAction.length) {
    return { tone: 'safe', headline: 'A challenge is open', detail: challengeBy ? `Lock your pick before ${format(challengeBy)}.` : 'Lock your pick before it closes.', facts, actions: challengeAction }
  }
  return {
    tone: 'safe',
    headline: 'Nothing to do right now',
    detail: merged ? 'Score well: the top scorer wins immunity and the rest face the vote.' : 'Score well: the lowest-scoring tribe goes to Tribal Council.',
    facts,
    actions: [],
  }
}
