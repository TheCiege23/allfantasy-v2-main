import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'

export const NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION = 'nfl-redraft-communication-v1' as const

export type NflRedraftNotificationPriority = 'low' | 'medium' | 'high'
export type NflRedraftDeliveryChannel =
  | 'in_app'
  | 'league_feed'
  | 'league_chat'
  | 'discord'
  | 'email_placeholder'
  | 'push_placeholder'

export type NflRedraftCommunicationCategory =
  | 'draft'
  | 'lineups'
  | 'waivers'
  | 'trades'
  | 'scoring'
  | 'matchups'
  | 'playoffs'
  | 'commissioner'
  | 'chat'
  | 'system'

export type NflRedraftCommunicationTarget = {
  userId: string
  teamId?: string | null
}

export type NflRedraftNotificationIntent = {
  id: string
  sourceKey: string
  leagueId: string
  userId: string
  teamId: string | null
  eventType: CanonicalLeagueRuntimeEventType
  title: string
  body: string
  priority: NflRedraftNotificationPriority
  readAt: string | null
  createdAtIso: string
  deliveryChannels: NflRedraftDeliveryChannel[]
  relatedRuntimeEvent: CanonicalLeagueRuntimeEvent
  expiresAtIso: string | null
  actionHref: string
  actionLabel: string
  meta: Record<string, unknown>
}

export type NflRedraftLeagueChatIntent = {
  dedupeKey: string
  leagueId: string
  messageType: string
  body: string
  source: string | null
  metadata: Record<string, unknown>
}

export type NflRedraftLeagueFeedIntent = {
  dedupeKey: string
  leagueId: string
  eventType: string
  message: string
  category: NflRedraftCommunicationCategory
  importance: 'low' | 'normal' | 'high'
  details: Record<string, unknown>
}

export type NflRedraftDiscordIntent = {
  dedupeKey: string
  leagueId: string
  title: string
  body: string
  enabled: boolean
  channel: 'league_event_announcement'
}

export type NflRedraftCommunicationPlan = {
  version: typeof NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION
  event: CanonicalLeagueRuntimeEvent
  category: NflRedraftCommunicationCategory
  notifications: NflRedraftNotificationIntent[]
  feed: NflRedraftLeagueFeedIntent | null
  chat: NflRedraftLeagueChatIntent | null
  discord: NflRedraftDiscordIntent | null
  deliveryChannels: NflRedraftDeliveryChannel[]
}

type EventTemplate = {
  category: NflRedraftCommunicationCategory
  type: string
  title: string
  body: string
  priority: NflRedraftNotificationPriority
  actionHref: string
  actionLabel: string
  mirrorToChat: boolean
  mirrorToDiscord: boolean
  chatType: string
  expiresInHours?: number
}

type BuildPlanInput = {
  event: CanonicalLeagueRuntimeEvent
  audience: NflRedraftCommunicationTarget[]
  leagueName?: string | null
  now?: Date
  includeEmailPushPlaceholders?: boolean
}

const HIGH_PRIORITY = new Set<CanonicalLeagueRuntimeEventType>([
  'draft.started',
  'draft.autopick',
  'draft.completed',
  'lineup.illegal.flagged',
  'trade.proposed',
  'trade.accepted',
  'trade.vetoed',
  'playoffs.bracket.generated',
  'playoffs.champion.crowned',
  'commissioner.announcement.created',
])

const CHAT_MIRROR_EVENTS = new Set<CanonicalLeagueRuntimeEventType>([
  'draft.scheduled',
  'draft.started',
  'draft.pick',
  'draft.autopick',
  'draft.completed',
  'lineup.illegal.flagged',
  'roster.player.locked',
  'waiver.claim.submitted',
  'waiver.claim.won',
  'waiver.processed',
  'waiver.free_agent.added',
  'trade.proposed',
  'trade.accepted',
  'trade.vetoed',
  'scoring.updated',
  'matchup.finalized',
  'standings.updated',
  'playoffs.bracket.generated',
  'playoffs.champion.crowned',
  'commissioner.announcement.created',
  'league.chat.system_message',
])

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function firstText(payload: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = stringValue(payload[key])
    if (value) return value
  }
  return fallback
}

function formatScore(value: unknown): string | null {
  const n = numberValue(value)
  if (n == null) return null
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function formatDraftTime(value: unknown): string {
  const raw = stringValue(value)
  if (!raw) return 'when the commissioner starts it'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  }
  return Math.abs(hash >>> 0).toString(36)
}

export function communicationDedupeKey(event: CanonicalLeagueRuntimeEvent, suffix = 'event'): string {
  const seed = [
    NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION,
    event.leagueId,
    event.type,
    event.occurredAtIso,
    event.sourceEventType,
    JSON.stringify(event.payload ?? {}),
    suffix,
  ].join('|')
  return `g42:${simpleHash(seed)}`
}

function actionForCategory(leagueId: string, category: NflRedraftCommunicationCategory): {
  actionHref: string
  actionLabel: string
} {
  const encoded = encodeURIComponent(leagueId)
  switch (category) {
    case 'draft':
      return { actionHref: `/league/${encoded}/draft`, actionLabel: 'Open draft' }
    case 'waivers':
      return { actionHref: `/league/${encoded}?tab=players`, actionLabel: 'Open waivers' }
    case 'trades':
      return { actionHref: `/league/${encoded}?tab=trades`, actionLabel: 'Open trades' }
    case 'matchups':
    case 'scoring':
      return { actionHref: `/league/${encoded}?tab=matchup`, actionLabel: 'Open matchup' }
    case 'lineups':
      return { actionHref: `/league/${encoded}?tab=team`, actionLabel: 'Open lineup' }
    case 'playoffs':
      return { actionHref: `/league/${encoded}?tab=standings`, actionLabel: 'Open playoffs' }
    case 'chat':
    case 'commissioner':
      return { actionHref: `/league/${encoded}?tab=league_chat`, actionLabel: 'Open chat' }
    default:
      return { actionHref: `/league/${encoded}`, actionLabel: 'Open league' }
  }
}
function categoryForEvent(type: CanonicalLeagueRuntimeEventType): NflRedraftCommunicationCategory {
  if (type.startsWith('draft.')) return 'draft'
  if (type.startsWith('lineup.') || type.startsWith('roster.')) return 'lineups'
  if (type.startsWith('waiver.')) return 'waivers'
  if (type.startsWith('trade.')) return 'trades'
  if (type.startsWith('scoring.') || type === 'standings.updated' || type === 'standings.recalculated') return 'scoring'
  if (type.startsWith('matchup.')) return 'matchups'
  if (type.startsWith('playoffs.') || type === 'season.completed') return 'playoffs'
  if (type.startsWith('commissioner.')) return 'commissioner'
  if (type.startsWith('league.chat.')) return 'chat'
  return 'system'
}

function priorityForEvent(type: CanonicalLeagueRuntimeEventType): NflRedraftNotificationPriority {
  if (HIGH_PRIORITY.has(type)) return 'high'
  if (
    type.startsWith('trade.') ||
    type.startsWith('waiver.') ||
    type.startsWith('playoffs.') ||
    type === 'matchup.finalized' ||
    type === 'roster.player.locked'
  ) {
    return 'medium'
  }
  return 'low'
}

function labelForRoster(payload: Record<string, unknown>, fallback = 'A team'): string {
  return firstText(payload, ['teamName', 'displayName', 'rosterName', 'ownerName', 'rosterId'], fallback)
}

function templateForEvent(event: CanonicalLeagueRuntimeEvent, leagueName?: string | null): EventTemplate {
  const payload = event.payload ?? {}
  const category = categoryForEvent(event.type)
  const priority = priorityForEvent(event.type)
  const { actionHref, actionLabel } = actionForCategory(event.leagueId, category)
  const leagueLabel = leagueName?.trim() || 'your league'
  const player = firstText(payload, ['playerName', 'addPlayerName', 'dropPlayerName', 'name'], 'A player')
  const team = labelForRoster(payload)
  const week = firstText(payload, ['week', 'weekNumber'], '')
  const pickLabel = firstText(payload, ['pickLabel', 'overall', 'pick'], '')
  const scoreA = formatScore(payload.homeScore ?? payload.teamScore ?? payload.score)
  const scoreB = formatScore(payload.awayScore)
  let title = 'League update'
  let body = `${leagueLabel} has a new update.`
  let type = `redraft_${event.type.replace(/\./g, '_')}`
  let chatType = 'system'
  let expiresInHours: number | undefined

  switch (event.type) {
    case 'draft.scheduled':
      title = 'Draft scheduled'
      body = `The draft is scheduled for ${formatDraftTime(payload.scheduledAtIso ?? payload.scheduledAt)}.`
      type = 'draft_scheduled'
      chatType = 'draft_notice'
      expiresInHours = 72
      break
    case 'draft.started':
      title = 'Draft started'
      body = `The ${leagueLabel} draft is live.`
      type = 'draft_started'
      chatType = 'draft_notice'
      expiresInHours = 24
      break
    case 'draft.pick':
    case 'draft.pick.submitted':
    case 'draft.player_drafted':
      title = pickLabel ? `Draft pick ${pickLabel}` : 'Draft pick made'
      body = `${team} drafted ${player}.`
      type = 'draft_pick_made'
      chatType = 'draft_pick'
      expiresInHours = 24
      break
    case 'draft.autopick':
      title = 'Auto-pick made'
      body = `${team} was auto-picked ${player}.`
      type = 'draft_auto_pick_fired'
      chatType = 'draft_notice'
      expiresInHours = 24
      break
    case 'draft.completed':
      title = 'Draft completed'
      body = `The ${leagueLabel} draft is complete. Rosters and waivers are ready for review.`
      type = 'draft_completed'
      chatType = 'draft_summary'
      break
    case 'lineup.illegal.flagged':
      title = 'Lineup issue needs attention'
      body = firstText(payload, ['message', 'reason'], `${team} has a lineup issue before games lock.`)
      type = 'lineup_issue'
      chatType = 'lineup_notice'
      expiresInHours = 36
      break
    case 'roster.player.locked':
      title = 'Player locked'
      body = `${player} is locked in ${team}'s lineup.`
      type = 'player_locked'
      chatType = 'lineup_notice'
      expiresInHours = 24
      break
    case 'waiver.claim.submitted':
      title = 'Waiver claim submitted'
      body = `${team} submitted a claim for ${firstText(payload, ['addPlayerName', 'playerName'], player)}.`
      type = 'waiver_claim_submitted'
      chatType = 'waiver_notice'
      expiresInHours = 72
      break
    case 'waiver.claim.won':
      title = 'Waiver claim won'
      body = `${team} won ${firstText(payload, ['addPlayerName', 'playerName'], player)} on waivers.`
      type = 'waiver_claim_won'
      chatType = 'waiver_notice'
      break
    case 'waiver.processed':
      title = 'Waivers processed'
      body = `Waivers processed${week ? ` for Week ${week}` : ''}: ${payload.succeeded ?? 0} succeeded, ${payload.failed ?? 0} failed.`
      type = 'waiver_processed'
      chatType = 'waiver_notice'
      break
    case 'waiver.free_agent.added':
      title = 'Free agent added'
      body = `${team} added ${firstText(payload, ['addPlayerName', 'playerName'], player)}.`
      type = 'free_agent_added'
      chatType = 'waiver_notice'
      break
    case 'trade.proposed':
      title = 'Trade proposed'
      body = firstText(payload, ['summary', 'message'], `A trade was proposed in ${leagueLabel}.`)
      type = 'trade_proposed'
      chatType = 'trade_notice'
      expiresInHours = 96
      break
    case 'trade.accepted':
    case 'trade.processed':
      title = 'Trade accepted'
      body = firstText(payload, ['summary', 'message'], `A trade was accepted in ${leagueLabel}.`)
      type = 'trade_accepted'
      chatType = 'trade_accepted'
      break
    case 'trade.vetoed':
      title = 'Trade vetoed'
      body = firstText(payload, ['summary', 'reason'], `A trade was vetoed in ${leagueLabel}.`)
      type = 'trade_vetoed'
      chatType = 'trade_notice'
      break
    case 'scoring.updated':
    case 'scoring.team_score.updated':
    case 'scoring.matchup_score.updated':
      title = 'Scoring update'
      body = scoreA && scoreB ? `Score update: ${scoreA}-${scoreB}.` : firstText(payload, ['summary', 'message'], `Scores updated${week ? ` for Week ${week}` : ''}.`)
      type = 'scoring_update'
      chatType = 'scoring_notice'
      expiresInHours = 48
      break
    case 'matchup.finalized':
      title = 'Matchup finalized'
      body = firstText(payload, ['summary', 'message'], scoreA && scoreB ? `Final score: ${scoreA}-${scoreB}.` : `A matchup is final${week ? ` for Week ${week}` : ''}.`)
      type = 'matchup_finalized'
      chatType = 'matchup_notice'
      break
    case 'standings.updated':
    case 'standings.recalculated':
      title = 'Standings updated'
      body = `League standings have been updated${week ? ` after Week ${week}` : ''}.`
      type = 'standings_updated'
      chatType = 'scoring_notice'
      break
    case 'playoffs.bracket.generated':
      title = 'Playoff bracket generated'
      body = firstText(payload, ['summary', 'message'], `The ${leagueLabel} playoff bracket is ready.`)
      type = 'playoff_bracket_generated'
      chatType = 'playoff_notice'
      break
    case 'playoffs.champion.crowned':
      title = 'Champion crowned'
      body = firstText(payload, ['summary', 'message', 'championName'], `${team} is the ${leagueLabel} champion.`)
      type = 'champion_crowned'
      chatType = 'champion_announcement'
      break
    case 'commissioner.announcement.created':
      title = firstText(payload, ['title'], 'Commissioner announcement')
      body = firstText(payload, ['body', 'message', 'announcement'], 'The commissioner posted an announcement.')
      type = 'commissioner_announcement'
      chatType = 'commissioner_notice'
      expiresInHours = 168
      break
    case 'league.chat.message':
      title = 'League chat message'
      body = firstText(payload, ['body', 'message'], 'A new league chat message was posted.')
      type = 'league_chat_message'
      chatType = 'chat_message'
      expiresInHours = 72
      break
    case 'league.chat.system_message':
      title = firstText(payload, ['title'], 'League chat update')
      body = firstText(payload, ['body', 'message'], 'A system message was posted in league chat.')
      type = 'league_chat_system_message'
      chatType = 'system'
      expiresInHours = 72
      break
    default:
      title = event.type
        .split('.')
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
        .join(' ')
      body = firstText(payload, ['summary', 'message', 'body'], `${leagueLabel} has a new ${category} update.`)
      chatType = `${category}_notice`
      break
  }

  return {
    category,
    type,
    title,
    body,
    priority,
    actionHref,
    actionLabel,
    mirrorToChat: CHAT_MIRROR_EVENTS.has(event.type),
    mirrorToDiscord: CHAT_MIRROR_EVENTS.has(event.type),
    chatType,
    expiresInHours,
  }
}

function expiresAt(now: Date, hours: number | undefined): string | null {
  if (!hours) return null
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString()
}

function teamIdFromEvent(event: CanonicalLeagueRuntimeEvent): string | null {
  return firstText(event.payload, ['teamId', 'rosterId', 'managerTeamId'], '') || null
}

function importance(priority: NflRedraftNotificationPriority): 'low' | 'normal' | 'high' {
  if (priority === 'high') return 'high'
  if (priority === 'medium') return 'normal'
  return 'low'
}

export function buildNflRedraftCommunicationPlan(input: BuildPlanInput): NflRedraftCommunicationPlan {
  const now = input.now ?? new Date()
  const template = templateForEvent(input.event, input.leagueName)
  const baseDedupe = communicationDedupeKey(input.event)
  const channels: NflRedraftDeliveryChannel[] = ['in_app', 'league_feed']
  if (template.mirrorToChat) channels.push('league_chat')
  if (template.mirrorToDiscord) channels.push('discord')
  if (input.includeEmailPushPlaceholders) channels.push('email_placeholder', 'push_placeholder')

  const notifications = input.audience.map((target): NflRedraftNotificationIntent => {
    const sourceKey = communicationDedupeKey(input.event, `notification:${target.userId}`)
    return {
      id: sourceKey,
      sourceKey,
      leagueId: input.event.leagueId,
      userId: target.userId,
      teamId: target.teamId ?? teamIdFromEvent(input.event),
      eventType: input.event.type,
      title: template.title,
      body: template.body,
      priority: template.priority,
      readAt: null,
      createdAtIso: input.event.occurredAtIso || now.toISOString(),
      deliveryChannels: channels,
      relatedRuntimeEvent: input.event,
      expiresAtIso: expiresAt(now, template.expiresInHours),
      actionHref: template.actionHref,
      actionLabel: template.actionLabel,
      meta: {
        runtimeVersion: NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION,
        leagueId: input.event.leagueId,
        sport: 'NFL',
        category: template.category,
        priority: template.priority,
        deliveryChannels: channels,
        relatedRuntimeEventType: input.event.type,
        relatedRuntimeEvent: input.event,
        teamId: target.teamId ?? teamIdFromEvent(input.event),
        actionHref: template.actionHref,
        actionLabel: template.actionLabel,
        expiresAtIso: expiresAt(now, template.expiresInHours),
      },
    }
  })

  const feed: NflRedraftLeagueFeedIntent = {
    dedupeKey: `${baseDedupe}:feed`,
    leagueId: input.event.leagueId,
    eventType: template.type,
    message: template.title,
    category: template.category,
    importance: importance(template.priority),
    details: {
      runtimeVersion: NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION,
      body: template.body,
      actionHref: template.actionHref,
      actionLabel: template.actionLabel,
      relatedRuntimeEventType: input.event.type,
      relatedRuntimeEvent: input.event,
    },
  }

  const chat: NflRedraftLeagueChatIntent | null = template.mirrorToChat
    ? {
        dedupeKey: `${baseDedupe}:chat`,
        leagueId: input.event.leagueId,
        messageType: template.chatType,
        body: template.body,
        source: null,
        metadata: {
          isSystem: true,
          g42Communication: true,
          runtimeVersion: NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION,
          notificationTitle: template.title,
          category: template.category,
          priority: template.priority,
          actionHref: template.actionHref,
          actionLabel: template.actionLabel,
          relatedRuntimeEventType: input.event.type,
          relatedRuntimeEvent: input.event,
        },
      }
    : null

  const discord: NflRedraftDiscordIntent | null = template.mirrorToDiscord
    ? {
        dedupeKey: `${baseDedupe}:discord`,
        leagueId: input.event.leagueId,
        title: template.title,
        body: template.body,
        enabled: true,
        channel: 'league_event_announcement',
      }
    : null

  return {
    version: NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION,
    event: input.event,
    category: template.category,
    notifications,
    feed,
    chat,
    discord,
    deliveryChannels: channels,
  }
}
