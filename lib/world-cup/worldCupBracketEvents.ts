/**
 * World Cup bracket league + pool chat system event types.
 * Pool chat JSON uses { isSystem, type, content } — map via `toPoolChatSystemType`.
 */

export const WORLD_CUP_BRACKET_EVENT_TYPES = {
  CHALLENGE_CREATED: "world_cup.challenge_created",
  USER_JOINED: "world_cup.user_joined",
  ENTRY_CREATED: "world_cup.entry_created",
  BRACKET_COMPLETED: "world_cup.bracket_completed",
  BRACKET_LOCKED: "world_cup.bracket_locked",
  MATCH_STARTING: "world_cup.match_starting",
  MATCH_HALFTIME: "world_cup.match_halftime",
  MATCH_FINAL: "world_cup.match_final",
  UPSET: "world_cup.upset",
  CHAMPION_PICK_ELIMINATED: "world_cup.champion_pick_eliminated",
  TOOK_FIRST_PLACE: "world_cup.took_first_place",
  LEADERBOARD_LEAD_CHANGE: "world_cup.leaderboard_lead_change",
  PERFECT_ROUND: "world_cup.perfect_round",
  NO_PERFECT_BRACKETS: "world_cup.no_perfect_brackets",
  CHAMPION_ALIVE_COUNT: "world_cup.champion_alive_count",
  /** @deprecated Prefer granular lock_reminder_* types for new emits */
  LOCK_REMINDER: "world_cup.lock_reminder",
  LOCK_REMINDER_24H: "world_cup.lock_reminder_24h",
  LOCK_REMINDER_6H: "world_cup.lock_reminder_6h",
  LOCK_REMINDER_1H: "world_cup.lock_reminder_1h",
  LOCK_REMINDER_15M: "world_cup.lock_reminder_15m",
  /** Commissioner / system nudge listing incomplete entries before lock */
  INCOMPLETE_BRACKETS_WARNING: "world_cup.incomplete_brackets_warning",
  COMMISSIONER_BRAIN_MESSAGE: "world_cup.commissioner_brain_message",
  KNOCKOUT_OVERRIDE: "world_cup.knockout_override",
} as const

/** Subset of PoolChat system `type` keys (see `PoolChat.tsx` typeColors). */
export type WorldCupPoolChatSystemKind =
  | "TOURNAMENT_READY"
  | "UPSET_ALERT"
  | "BRACKET_BUSTED"
  | "BIG_SWING"
  | "LEAD_CHANGE"
  | "BRACKET_LOCKED"

export function toPoolChatSystemType(
  eventType: string
): WorldCupPoolChatSystemKind {
  if (eventType.includes("upset")) return "UPSET_ALERT"
  if (eventType.includes("champion") && eventType.includes("elimin")) return "BRACKET_BUSTED"
  if (eventType.includes("first_place") || eventType.includes("lead")) return "LEAD_CHANGE"
  if (eventType.includes("lock_reminder") || eventType.includes("lock")) {
    return "BRACKET_LOCKED"
  }
  if (eventType.includes("perfect") || eventType.includes("round")) return "BIG_SWING"
  return "TOURNAMENT_READY"
}
