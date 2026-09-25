import type { ChimmyAIAnalyticsIngressEvent } from '@/lib/chimmy-chat/analytics-events'
import type { ChimmyAssistantMode } from '@/lib/chimmy-chat/assistant-mode'

export type ChimmyFeedbackValue = 'helpful' | 'unhelpful'

const MAX_TOOLS = 12

export function buildChimmyFeedbackEvent(args: {
  messageId: string
  feedback: ChimmyFeedbackValue
  leagueId?: string | null
  surface: ChimmyAIAnalyticsIngressEvent['surface']
  mode: ChimmyAssistantMode
  source?: string | null
  topic?: ChimmyAIAnalyticsIngressEvent['topic']
  /**
   * Where the question was asked, in the same words the question row uses (`drawer:<screen>`, or
   * the caller's source) — so a thumbs-down joins to the question it is about.
   */
  entry?: string | null
  /** The tools the answer used, in order, from the route's `meta.toolsUsed`. What a rating is about. */
  tools?: readonly string[] | null
}): Omit<ChimmyAIAnalyticsIngressEvent, 'user_id'> {
  const tools = (args.tools ?? []).filter((t) => typeof t === 'string' && t.length > 0).slice(0, MAX_TOOLS)
  return {
    event_name: 'feedback_submit',
    league_id: args.leagueId ?? null,
    surface: args.surface,
    mode: args.mode,
    topic: args.topic,
    action: args.feedback === 'helpful' ? 'thumbs_up' : 'thumbs_down',
    timestamp: new Date().toISOString(),
    metadata: {
      messageId: args.messageId,
      feedbackValue: args.feedback,
      assistantMode: args.mode,
      surface: args.surface,
      source: args.source ?? null,
      entry: args.entry ?? null,
      tools,
    },
  }
}

/**
 * The analytics surface for a question asked from the /core drawer. The exact screen travels in
 * `entry`; this is the coarse bucket the analytics schema allows.
 */
export function drawerFeedbackSurface(
  coreSurface: string | null | undefined,
  hasLeague: boolean,
): ChimmyAIAnalyticsIngressEvent['surface'] {
  switch (coreSurface) {
    case 'waivers':
      return 'waiver'
    case 'trades':
      return 'trade'
    case 'war-room':
      return 'war_room'
    case 'draft-hq':
      return 'draft_room'
    default:
      return hasLeague ? 'league' : 'dashboard'
  }
}
