import type { Prisma } from '@prisma/client'

/** Provider facts, never ingestion times or today's canonical manager slot. */
export function sleeperDraftArchiveMetadata(args: {
  sourceDraftId: string; sourceLeagueId: string; season: number;
  draft: unknown; league: unknown; pick: unknown; tradedPicks: unknown[] | null;
  includeDraftSnapshot: boolean;
}): Prisma.InputJsonObject {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const json = (value: unknown): Prisma.InputJsonValue =>
    JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const id = (value: unknown) => typeof value === 'number' || typeof value === 'string' ? String(value) : null
  const time = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }
  const draft = record(args.draft), league = record(args.league), pick = record(args.pick)
  const player = record(pick.metadata)
  const metadata: Prisma.InputJsonObject = {
    archiveVersion: 1, provider: 'sleeper', sourceDraftId: args.sourceDraftId,
    sourceLeagueId: args.sourceLeagueId, season: args.season,
    selectionRosterId: id(pick.roster_id), providerPickedBy: id(pick.picked_by),
    originalDraftSlot: typeof pick.draft_slot === 'number' ? pick.draft_slot : null,
    playerSnapshot: {
      name: [text(player.first_name), text(player.last_name)].filter(Boolean).join(' ') || null,
      position: text(player.position), team: text(player.team), sport: text(player.sport),
    },
    // Public picks do not document exact selection or clock-event timestamps.
    timingCoverage: 'not_supplied_by_provider',
  }
  if (args.includeDraftSnapshot) metadata.archiveDraft = {
    format: text(draft.type), status: text(draft.status), sport: text(draft.sport),
    name: text(record(draft.metadata).name) ?? text(league.name),
    startTime: time(draft.start_time), lastPickedTime: time(draft.last_picked),
    // last_picked stays named as such; it is not relabelled completedAt.
    draftSettings: json(draft.settings), draftOrder: json(draft.draft_order),
    slotToRosterId: json(draft.slot_to_roster_id),
    observedSeasonScoring: json(league.scoring_settings),
    observedSeasonRosterPositions: json(league.roster_positions),
    tradedPicks: json(args.tradedPicks),
    tradeCoverage: args.tradedPicks === null ? 'unavailable' : 'provider_ownership_snapshot',
  }
  return metadata
}
