/**
 * Canonical shape for league feed rows (stored in `LeagueEvent.payload` + title/description).
 */

type LeagueFeedActorType = "user" | "ai" | "system" | "commissioner"

type LeagueFeedImportance = "low" | "normal" | "high"

/** Stored inside LeagueEvent.payload JSON */
export type LeagueFeedPayload = {
  actorType: LeagueFeedActorType
  actorId?: string | null
  actorName?: string | null
  actorAvatar?: string | null
  teamId?: string | null
  teamName?: string | null
  flavorLine?: string | null
  category?: LeagueFeedCategory
  importance?: LeagueFeedImportance
  botArchetypeId?: string | null
  botArchetypeLabel?: string | null
  /** Original structured fields */
  details?: Record<string, unknown>
}

export type LeagueFeedCategory =
  | "draft"
  | "waivers"
  | "trades"
  | "lineups"
  | "matchups"
  | "commissioner"
  | "ai"
  | "system"
  | "other"

export type CreateLeagueFeedEventInput = {
  leagueId: string
  eventType: string
  /** Primary one-line summary — always accurate */
  message: string
  actorType: LeagueFeedActorType
  actorId?: string | null
  actorName?: string | null
  actorAvatar?: string | null
  teamId?: string | null
  teamName?: string | null
  flavorLine?: string | null
  category?: LeagueFeedCategory
  importance?: LeagueFeedImportance
  botArchetypeId?: string | null
  botArchetypeLabel?: string | null
  details?: Record<string, unknown>
  visibility?: "league" | "commissioners_only"
}
