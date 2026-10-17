import type { SurvivorSeasonPayload } from './survivorUiTypes'

export type SurvivorNotificationUrgency = 'critical' | 'high' | 'medium' | 'low'

export type SurvivorNotification = {
  id: string
  urgency: SurvivorNotificationUrgency
  title: string
  body: string
  href?: string
  icon: string
  createdAt: number
}

/** Spoiler-safe copy only — never names vote targets or power holders. */
export function buildSurvivorNotifications(
  leagueId: string,
  season: SurvivorSeasonPayload | null,
  opts?: { challengeClosingMs?: number; voteDeadlineMs?: number },
): SurvivorNotification[] {
  const out: SurvivorNotification[] = []
  const now = Date.now()

  const council = season?.activeCouncil
  const ch = season?.currentChallenge
  const phase = season?.phase ?? ''

  if (council?.status === 'voting_open') {
    out.push({
      id: 'tribal_tonight',
      urgency: 'critical',
      title: 'Elimination Council is active',
      body: 'Cast your vote before the deadline — details stay private until the reveal.',
      href: `/survivor/${leagueId}/tribal`,
      icon: '🗳',
      createdAt: now,
    })
  }

  const voteMs = opts?.voteDeadlineMs
  if (voteMs != null && voteMs > 0 && voteMs < 30 * 60 * 1000) {
    out.push({
      id: 'vote_deadline_soon',
      urgency: 'critical',
      title: 'Vote deadline soon',
      body: 'Less than 30 minutes remain to lock in your ballot.',
      href: `/survivor/${leagueId}/chimmy`,
      icon: '⏱',
      createdAt: now,
    })
  }

  const closeMs = opts?.challengeClosingMs
  if (ch?.status === 'open' && closeMs != null && closeMs < 2 * 60 * 60 * 1000 && closeMs > 0) {
    out.push({
      id: 'challenge_closing',
      urgency: 'high',
      title: 'Challenge closing soon',
      body: 'Submit your pick before the lock — no spoilers in notifications.',
      href: `/survivor/${leagueId}/challenges`,
      icon: '⚡',
      createdAt: now,
    })
  }

  if (ch?.status === 'open' && !out.some((n) => n.id === 'challenge_closing')) {
    out.push({
      id: 'challenge_posted',
      urgency: 'medium',
      title: 'New island challenge',
      body: 'A new challenge is open — check rewards and deadline on the Challenges tab.',
      href: `/survivor/${leagueId}/challenges`,
      icon: '⚡',
      createdAt: now - 1000,
    })
  }

  if (phase === 'merge') {
    out.push({
      id: 'merge_announced',
      urgency: 'medium',
      title: 'The merge is here',
      body: 'Drop your buffs — the individual game begins.',
      href: `/survivor/${leagueId}/merge`,
      icon: '🌊',
      createdAt: now - 2000,
    })
  }

  if (season?.exileStatus?.isActive) {
    out.push({
      id: 'exile_live',
      urgency: 'medium',
      title: 'Exile activity',
      body: 'Exile Island has a live week — earn tokens on your grind.',
      href: `/survivor/${leagueId}/exile`,
      icon: '🏚',
      createdAt: now - 3000,
    })
  }

  if (phase === 'jury' || phase === 'finale') {
    out.push({
      id: 'jury_finale',
      urgency: 'low',
      title: phase === 'finale' ? 'Finale week' : 'Jury phase',
      body: 'Justice, drama, payoff — follow the Jury & Finale tabs.',
      href: `/survivor/${leagueId}/jury`,
      icon: '⚖️',
      createdAt: now - 4000,
    })
  }

  out.sort((a, b) => {
    const rank: Record<SurvivorNotificationUrgency, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }
    return rank[a.urgency] - rank[b.urgency] || b.createdAt - a.createdAt
  })

  return out
}

export const SURVIVOR_NOTIFICATION_COPY = {
  challenge_posted: '⚡ New island challenge — check the deadline in-app.',
  challenge_closing: '⚡ Challenge closes soon — submit now.',
  vote_reminder: '🗳 Elimination Council is active — vote by your league deadline.',
  vote_received: '🗳 Your vote has been received.',
  idol_received: '🔮 You have received a secret power.',
  idol_expiring: '🔮 A power may expire at the merge — check @Chimmy.',
  tribal_tonight: '🔥 Elimination Council requires your attention.',
  merge_announced: '🌊 The merge is here — drop your buffs.',
  exile_challenge_live: '🏚 Exile challenge is live — earn tokens.',
  token_earned: '🪙 Token earned on Exile Island.',
  token_wiped: '🪙 Token reset — the Boss won this week.',
  jury_voting_open: '⚖️ Jury voting is open.',
  winner_revealed: '🏆 The Sole Survivor has been revealed.',
} as const
