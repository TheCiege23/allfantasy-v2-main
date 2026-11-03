/**
 * Dynasty draft-room identity: what kind of dynasty draft this is, and what a rookie AUCTION
 * did with traded rookie picks. Pure, so the top bar and the pool panel read one answer.
 *
 * Every input is a field the draft room already has — `DraftSessionSnapshot.draftModeLabel`
 * (written by `createNextLeagueDraft`: `'rookie'` for a dynasty league's follow-up draft), the
 * snapshot's `auction.auctionState.rookieAuction` (written once, when the rookie auction is
 * created) and `League.season` (advanced to the incoming season by
 * `ensureNextRedraftSeasonShell` before a rookie draft is created, so it IS the rookie class
 * year). Nothing here is inferred from player data.
 */

export type DynastyDraftKind = 'rookie' | 'startup' | 'supplemental' | 'dispersal'

/**
 * Which dynasty draft this is. `null` for a non-dynasty league and for an imported roster
 * snapshot (that has its own banner and is not a draft that was run).
 *
 * A dynasty league's FIRST draft is its startup. `createNextLeagueDraft` writes `'rookie'` for
 * every later dynasty draft, so a dynasty session labelled `standard`, `startup` or nothing at
 * all is the startup.
 */
export function resolveDynastyDraftKind(
  draftModeLabel: string | null | undefined,
  isDynasty: boolean,
): DynastyDraftKind | null {
  if (!isDynasty) return null
  const mode = String(draftModeLabel ?? '').trim().toLowerCase()
  if (mode === 'imported_rosters') return null
  if (mode === 'rookie') return 'rookie'
  if (mode === 'supplemental') return 'supplemental'
  if (mode === 'dispersal') return 'dispersal'
  if (mode === '' || mode === 'standard' || mode === 'startup') return 'startup'
  return null
}

/** A plausible season year, or null. Rejects 0, NaN and junk rather than printing them. */
export function normalizeDraftSeasonYear(season: unknown): number | null {
  const n = typeof season === 'string' ? Number(season.trim()) : typeof season === 'number' ? season : NaN
  if (!Number.isInteger(n) || n < 1990 || n > 2100) return null
  return n
}

/**
 * "Rookie draft · 2027" / "Startup draft". The year is shown only for a rookie draft, and only
 * when the league's season is known — a startup has no class year to name.
 */
export function formatDynastyDraftKindLabel(
  kind: DynastyDraftKind | null,
  seasonYear: number | null,
  t: (key: string) => string,
): string | null {
  if (!kind) return null
  if (kind === 'rookie') {
    return seasonYear != null
      ? t('draftRoom.dynasty.kind.rookieWithYear').replace('{{year}}', String(seasonYear))
      : t('draftRoom.dynasty.kind.rookie')
  }
  return t(`draftRoom.dynasty.kind.${kind}`)
}

/** A rookie draft opens its pool on rookies; the commissioner can still clear the filter. */
export function shouldDefaultRookiesOnly(draftModeLabel: string | null | undefined): boolean {
  return String(draftModeLabel ?? '').trim().toLowerCase() === 'rookie'
}

export type RookieAuctionPolicyNote = {
  policy: 'block' | 'budget' | 'nominations'
  /** How many traded rookie picks were converted when the auction was created. */
  tradeCount: number
}

/**
 * What the rookie auction did with traded rookie picks, read from the stored plan
 * (`auctionState.rookieAuction` = settings + resolved trades). `null` when this is not a rookie
 * auction or the stored plan is missing / malformed — the room then says nothing about it.
 */
export function readRookieAuctionPolicyNote(snapshot: {
  draftModeLabel?: string | null
  draftType?: string | null
  auction?: { auctionState?: { rookieAuction?: unknown } | null } | null
} | null | undefined): RookieAuctionPolicyNote | null {
  if (!snapshot) return null
  if (String(snapshot.draftModeLabel ?? '').toLowerCase() !== 'rookie') return null
  if (String(snapshot.draftType ?? '').toLowerCase() !== 'auction') return null
  const raw = snapshot.auction?.auctionState?.rookieAuction
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const policy = (raw as Record<string, unknown>).policy
  if (policy !== 'block' && policy !== 'budget' && policy !== 'nominations') return null
  const trades = (raw as Record<string, unknown>).trades
  const tradeCount = Array.isArray(trades) ? trades.length : 0
  return { policy, tradeCount }
}

/** One honest line for the rookie auction banner, or null when there is nothing to say. */
export function formatRookieAuctionPolicyNote(
  note: RookieAuctionPolicyNote | null,
  t: (key: string) => string,
): string | null {
  if (!note) return null
  // `block` refuses to create an auction while any rookie pick is traded, so there is nothing
  // to convert and nothing to explain.
  if (note.policy === 'block' || note.tradeCount === 0) return null
  const key =
    note.policy === 'budget'
      ? note.tradeCount === 1 ? 'draftRoom.dynasty.rookieAuction.budgetOne' : 'draftRoom.dynasty.rookieAuction.budgetOther'
      : note.tradeCount === 1 ? 'draftRoom.dynasty.rookieAuction.nominationsOne' : 'draftRoom.dynasty.rookieAuction.nominationsOther'
  return t(key).replace('{{count}}', String(note.tradeCount))
}

/**
 * Which rooms announce a round-1 pick. The redraft snake room always did. Dynasty rooms lost it
 * only because the announcement rode on the `redraft_snake` variant, which dynasty is kept out
 * of for its this-season-only semantics — so they get it back here, on their own chrome. An
 * auction has no pick order, so "Round 1 · Pick 4" would describe nothing real.
 */
export function roomAnnouncesRoundOne(input: {
  presentationVariant: string | null | undefined
  isDynasty: boolean
  draftType: string | null | undefined
}): boolean {
  if (input.presentationVariant === 'redraft_snake' && !input.isDynasty) return true
  return input.isDynasty && String(input.draftType ?? '').toLowerCase() !== 'auction'
}
