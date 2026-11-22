import type { LeagueFeedPayload } from "./leagueFeedTypes"
import type { LeagueFeedCategory } from "./leagueFeedTypes"

type FormattedFeedItem = {
  id: string
  source: "league_event"
  type: string
  message: string
  title?: string | null
  flavorLine?: string | null
  actorType?: string | null
  actorName?: string | null
  teamName?: string | null
  category?: LeagueFeedCategory
  importance?: string | null
  botArchetypeLabel?: string | null
  createdAt: string
  metadata?: unknown
}

function parsePayload(raw: unknown): LeagueFeedPayload | null {
  if (!raw || typeof raw !== "object") return null
  return raw as LeagueFeedPayload
}

export function formatLeagueEventRow(row: {
  id: string
  eventType: string
  title: string
  description: string | null
  payload: unknown
  createdAt: Date
}): FormattedFeedItem {
  const p = parsePayload(row.payload)
  const firstLine =
    row.description?.split("\n\n")[0]?.trim() ||
    row.description?.trim() ||
    ""
  const primary = row.title?.trim() || firstLine || ""
  const flavor = p?.flavorLine ?? null
  return {
    id: `le:${row.id}`,
    source: "league_event",
    type: row.eventType,
    message: primary,
    title: row.title,
    flavorLine: flavor,
    actorType: p?.actorType ?? null,
    actorName: p?.actorName ?? null,
    teamName: p?.teamName ?? null,
    category: p?.category,
    importance: p?.importance ?? null,
    botArchetypeLabel: p?.botArchetypeLabel ?? null,
    createdAt: row.createdAt.toISOString(),
    metadata: row.payload,
  }
}
