/**
 * Pure identity helpers for a Sleeper draft pick, shared by the historical draft sync and the
 * owner backfill so the two derive a pick's number and owner the same way.
 */

/** The pick's overall number, as the sync stores it in `dw_draft_facts.pickNumber`. */
export function normalizePickNumber(rawPick: any, fallbackPickNumber: number): number {
  const directPick = Number(rawPick?.pick_no)
  if (Number.isFinite(directPick) && directPick > 0) {
    return directPick
  }

  const round = Number(rawPick?.round)
  const draftSlot = Number(rawPick?.draft_slot)
  const rosterSize = Number(rawPick?.draft_slot_count)
  if (
    Number.isFinite(round) &&
    round > 0 &&
    Number.isFinite(draftSlot) &&
    draftSlot > 0 &&
    Number.isFinite(rosterSize) &&
    rosterSize > 0
  ) {
    return (round - 1) * rosterSize + draftSlot
  }

  return fallbackPickNumber
}

/**
 * The Sleeper user id of the manager whose team made this pick, IN THAT SEASON.
 *
 * ⚠ `managerId` CANNOT ANSWER "WHO", AND THIS EXISTS BECAUSE OF THAT. `managerId` is resolved to
 * the CURRENT team, and when a pick's owner has left the league it falls back to the raw roster
 * slot — a number Sleeper reuses, so the pick is silently credited to whoever holds that slot now
 * (see `canonicalManagerId` in SleeperHistoricalDraftSyncService). That is fine for a board of teams and wrong for anything that
 * describes a PERSON, such as Competitive Edge's "how this manager drafts". The owner is read from
 * that season's own rosters (`roster_id` -> `owner_id`) and from nothing else.
 *
 * ⚠ NOT `picked_by`. That is whoever CLICKED — in an offline or commissioner-entered draft it is
 * the commissioner on every pick, so falling back to it would credit a whole draft to one person.
 * A pick whose roster owner cannot be read gets no owner and is left out, never guessed.
 *
 * Shared with `./draftOwnerBackfill.ts`, which fills this in for seasons imported before it
 * existed — the completion gate means a finished season is never re-read otherwise.
 */
export function sleeperPickOwnerId(rawPick: any, ownerByRosterId: ReadonlyMap<string, string>): string | null {
  const rosterId = rawPick?.roster_id != null ? String(rawPick.roster_id) : ''
  return (rosterId && ownerByRosterId.get(rosterId)) || null
}

/** That season's `roster_id` -> `owner_id`, from Sleeper's rosters payload. */
export function sleeperOwnerByRosterId(rosters: unknown[] | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  for (const roster of rosters ?? []) {
    const raw = (roster as { roster_id?: unknown; owner_id?: unknown } | null) ?? {}
    if (raw.roster_id != null && typeof raw.owner_id === 'string' && raw.owner_id) {
      out.set(String(raw.roster_id), raw.owner_id)
    }
  }
  return out
}
