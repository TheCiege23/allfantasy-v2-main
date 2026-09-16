import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The writer for `provider_trade_offers` — provider-side trades that have not settled.
 *
 * ── 🛑 THE MIGRATION IS PARKED. NOTHING CALLS THIS YET, AND THAT IS DELIBERATE ─────────────────
 *
 * `prisma/migrations-pending/20260916030000_provider_trade_offers/` has not been applied. A
 * reader or a scheduled caller wired ahead of the apply does not no-op — a generated client that
 * knows about a table production lacks raises P2021 — so this module exists, is tested, and is
 * called by nobody until the migration lands. Wiring it is a separate, deliberate act.
 *
 * ── WHY THIS IS NOT A ROW IN `dw_transaction_facts` ───────────────────────────────────────────
 *
 * That table is a settled-events fact table and ten readers count it without filtering by `type`.
 * The sharpest is not even a count: `decisionReceipts` takes `_max(weekOrPeriod)` as the SYNC
 * WATERMARK, so a pending week-14 offer written there would advance "how far this league has
 * synced" past what actually settled. See the model's own doc comment in schema.prisma.
 *
 * ── READ-ONLY BY NATURE ───────────────────────────────────────────────────────────────────────
 *
 * Sleeper's public API has no write endpoint and a Yahoo offer is answered on Yahoo. This records
 * what the provider says; nothing here may grow an accept path, and no surface reading these rows
 * may render accept/reject controls. Same see-and-advise boundary `scanPendingSleeperTrades`
 * already documents.
 */

/** AllFantasy's normalised offer state. */
export type OfferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'vanished'
  | 'unknown'

export type NormalizedOfferAsset = {
  assetType: 'player' | 'pick' | 'faab'
  playerId: string | null
  pickSeason: number | null
  pickRound: number | null
  pickOriginalRosterId: string | null
  faabAmount: number | null
  fromRosterId: string | null
  toRosterId: string | null
}

export type NormalizedOffer = {
  provider: string
  providerTradeId: string
  status: OfferStatus
  providerStatus: string | null
  proposedByRosterId: string | null
  rosterIds: string[]
  consentedRosterIds: string[]
  proposedAt: Date | null
  weekOrPeriod: number | null
  assets: NormalizedOfferAsset[]
}

/** The subset of a Sleeper transaction this normaliser reads. */
export type SleeperTradeLike = {
  transaction_id?: string | null
  type?: string | null
  status?: string | null
  roster_ids?: number[] | null
  consenter_ids?: number[] | null
  creator?: string | null
  created?: number | null
  leg?: number | null
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  draft_picks?: Array<{
    season?: string | number | null
    round?: number | null
    roster_id?: number | null
    previous_owner_id?: number | null
    owner_id?: number | null
  }> | null
  waiver_budget?: Array<{ sender?: number | null; receiver?: number | null; amount?: number | null }> | null
}

/**
 * Sleeper's four transaction statuses, mapped onto ours.
 *
 * ⚠ AN UNRECOGNISED STATUS BECOMES `unknown`, NOT `pending`. Sleeper's vocabulary could grow, and
 * the two wrong answers are not symmetric: calling a new terminal state `pending` would park a
 * dead offer in a manager's "Needs you" queue forever, while `unknown` is visibly unhandled and
 * `providerStatus` keeps the provider's own word for whoever looks.
 *
 * 🛑 `vanished` IS NOT PRODUCED HERE AND CANNOT BE. It is not a thing a provider ever says — it is
 * an inference drawn from an offer's ABSENCE across a sweep, which a function looking at one
 * transaction has no way to observe. It is set by `markVanishedOffers`, under a proof obligation.
 */
export function mapSleeperStatus(raw: string | null | undefined): OfferStatus {
  switch (String(raw ?? '').toLowerCase()) {
    case 'complete':
      return 'accepted'
    case 'pending':
      return 'pending'
    case 'failed':
      return 'rejected'
    default:
      return 'unknown'
  }
}

const asRoster = (v: number | null | undefined): string | null =>
  v == null || !Number.isFinite(Number(v)) ? null : String(v)

/**
 * One Sleeper trade transaction, as roster-neutral ledger rows.
 *
 * ── ⚠ ROSTER-NEUTRAL, WHICH IS WHY `buildTradeAssetsForRoster` COULD NOT BE REUSED ────────────
 *
 * That helper answers "what does THIS manager give and get", which is the right shape for a panel
 * and the wrong one for a ledger: it has to be run once per roster, and a three-team trade then
 * produces three partial views that something has to reconcile. Here every asset carries its own
 * `from` and `to`, so the number of teams is simply however many distinct rosters the assets
 * mention, and a viewer-relative view is a trivial filter over it rather than a second parse.
 *
 * ⚠ A PLAYER IN BOTH `adds` AND `drops` IS ONE ASSET, NOT TWO. Sleeper records the same movement
 * from both ends — `adds` maps a player to the roster receiving him, `drops` to the roster giving
 * him up. Emitting a row per side would double every player in the ledger and make a two-player
 * swap read as a four-asset deal.
 *
 * Pure, so every branch is testable without a network or a database.
 */
export function normalizeSleeperTradeOffer(
  tx: SleeperTradeLike,
  ctx: { week: number | null },
): NormalizedOffer | null {
  if (tx.type !== 'trade') return null
  const providerTradeId = tx.transaction_id ? String(tx.transaction_id) : ''
  if (!providerTradeId) return null

  const assets: NormalizedOfferAsset[] = []
  const adds = tx.adds ?? {}
  const drops = tx.drops ?? {}

  for (const playerId of new Set([...Object.keys(adds), ...Object.keys(drops)])) {
    assets.push({
      assetType: 'player',
      playerId,
      pickSeason: null,
      pickRound: null,
      pickOriginalRosterId: null,
      faabAmount: null,
      fromRosterId: asRoster(drops[playerId]),
      toRosterId: asRoster(adds[playerId]),
    })
  }

  for (const pick of tx.draft_picks ?? []) {
    const season = Number(pick?.season)
    const round = Number(pick?.round)
    assets.push({
      assetType: 'pick',
      playerId: null,
      pickSeason: Number.isFinite(season) ? season : null,
      pickRound: Number.isFinite(round) ? round : null,
      /*
       * ⚠ `owner_id` IS THE ORIGINAL OWNER, AND IT IS THE FIELD THAT MAKES A PICK VALUABLE OR NOT.
       * `previous_owner_id` is whoever is handing it over now and `roster_id` is whoever receives
       * it; neither says whose season the pick tracks. A 1st from the worst team and a 1st from
       * the best are the same row without this.
       */
      pickOriginalRosterId: asRoster(pick?.owner_id),
      faabAmount: null,
      fromRosterId: asRoster(pick?.previous_owner_id),
      toRosterId: asRoster(pick?.roster_id),
    })
  }

  for (const move of tx.waiver_budget ?? []) {
    const amount = Number(move?.amount)
    // A zero or negative transfer is not an asset; it is noise that would render as "$0 FAAB".
    if (!Number.isFinite(amount) || amount <= 0) continue
    assets.push({
      assetType: 'faab',
      playerId: null,
      pickSeason: null,
      pickRound: null,
      pickOriginalRosterId: null,
      faabAmount: amount,
      fromRosterId: asRoster(move?.sender),
      toRosterId: asRoster(move?.receiver),
    })
  }

  /*
   * ⚠ `roster_ids` IS THE AUTHORITY AND THE ASSETS ARE THE FALLBACK, for the reason the import-side
   * sibling already records: a roster that only moved FAAB still participated, and a row with no
   * participant is a fact nobody can be asked about.
   */
  const rosterIds = new Set<string>()
  for (const r of tx.roster_ids ?? []) {
    const id = asRoster(r)
    if (id) rosterIds.add(id)
  }
  for (const a of assets) {
    if (a.fromRosterId) rosterIds.add(a.fromRosterId)
    if (a.toRosterId) rosterIds.add(a.toRosterId)
  }

  return {
    provider: 'sleeper',
    providerTradeId,
    status: mapSleeperStatus(tx.status),
    providerStatus: tx.status == null ? null : String(tx.status),
    /*
     * ⚠ `creator` IS A SLEEPER USER ID, NOT A ROSTER ID, SO IT IS NOT USED HERE. Writing it into
     * `proposedByRosterId` would put one id space into a column every other value reads from
     * another, and nothing would complain — the join would simply never match. Left null until a
     * user→roster resolution exists; `payload` keeps the raw record either way.
     */
    proposedByRosterId: null,
    rosterIds: [...rosterIds],
    consentedRosterIds: (tx.consenter_ids ?? [])
      .map(asRoster)
      .filter((v): v is string => v != null),
    proposedAt: typeof tx.created === 'number' && tx.created > 0 ? new Date(tx.created) : null,
    weekOrPeriod: ctx.week,
    assets,
  }
}

export type PersistOffersResult = {
  offersWritten: number
  assetsWritten: number
  vanished: number
  /** True when the sweep could not prove it read the whole feed, so nothing was marked vanished. */
  vanishSkipped: boolean
}

/**
 * Upsert one league's offers, and — only under proof — retire the ones that are gone.
 *
 * 🛑 THE PROOF OBLIGATION IS THE WHOLE POINT OF `feedComplete`, AND GETTING IT WRONG WOULD BE
 * WORSE THAN NOT WRITING AT ALL. `vanished` is an inference from ABSENCE, and absence has two
 * causes that look identical from here: the offer is gone, or we failed to read the feed. This
 * repo has already paid for that confusion once — a rate-limited Sleeper week used to be
 * indistinguishable from a week with no trades, which "writes silence into the warehouse and it
 * looks like data".
 *
 * So the caller must assert it read every week it meant to read. If it cannot, offers keep their
 * last known state and `vanishSkipped` says so, because a stale `pending` is a much smaller lie
 * than a fabricated `vanished`: the first is out of date, the second is a claim about the world
 * that nobody observed.
 *
 * ⚠ AND ONLY `pending` ROWS ARE RETIRED. A terminal state is a thing we saw; it does not stop
 * being true because the provider aged the transaction out of its feed.
 */
export async function persistProviderTradeOffers(args: {
  leagueId: string
  sport: string
  season: number | null
  provider: string
  offers: NormalizedOffer[]
  /** Proof the sweep read the whole feed. False ⇒ nothing is marked vanished. */
  feedComplete: boolean
  /** One timestamp for the whole sweep, so `lastSeenAt` means "this pass" and rows sort together. */
  seenAt?: Date
}): Promise<PersistOffersResult> {
  const seenAt = args.seenAt ?? new Date()
  const result: PersistOffersResult = {
    offersWritten: 0,
    assetsWritten: 0,
    vanished: 0,
    vanishSkipped: !args.feedComplete,
  }

  for (const offer of args.offers) {
    const header = {
      leagueId: args.leagueId,
      provider: args.provider,
      providerTradeId: offer.providerTradeId,
      sport: args.sport,
      season: args.season,
      weekOrPeriod: offer.weekOrPeriod,
      status: offer.status,
      providerStatus: offer.providerStatus,
      proposedByRosterId: offer.proposedByRosterId,
      rosterIds: offer.rosterIds,
      consentedRosterIds: offer.consentedRosterIds,
      proposedAt: offer.proposedAt,
      lastSeenAt: seenAt,
    }

    const row = await prisma.providerTradeOffer.upsert({
      where: {
        uniq_provider_trade_offer: {
          provider: args.provider,
          leagueId: args.leagueId,
          providerTradeId: offer.providerTradeId,
        },
      },
      /*
       * ⚠ `firstSeenAt` IS ONLY SET ON CREATE, AND IS ABSENT FROM THE UPDATE ON PURPOSE. It is how
       * long an offer has been outstanding — the thing a "sitting for 3 days" badge is computed
       * from — so re-stamping it every sweep would reset every offer's age to zero on a cadence
       * and make it permanently read as new.
       */
      create: { ...header, firstSeenAt: seenAt },
      update: header,
      select: { id: true },
    })
    result.offersWritten += 1

    /*
     * ⚠ REPLACE, NOT MERGE. An offer's contents are immutable at the provider — a changed deal is
     * a new transaction — so the only way the asset set differs on a re-read is that our own
     * parsing changed. Merging would then leave rows from the old parse beside rows from the new
     * one, with nothing able to tell them apart. Delete-then-insert is scoped to this one offer.
     */
    await prisma.providerTradeOfferAsset.deleteMany({ where: { offerId: row.id } })
    if (offer.assets.length > 0) {
      await prisma.providerTradeOfferAsset.createMany({
        data: offer.assets.map((a) => ({ offerId: row.id, ...a })),
      })
      result.assetsWritten += offer.assets.length
    }
  }

  if (!args.feedComplete) return result

  const seenIds = args.offers.map((o) => o.providerTradeId)
  const gone = await prisma.providerTradeOffer.updateMany({
    where: {
      leagueId: args.leagueId,
      provider: args.provider,
      status: 'pending',
      /*
       * ⚠ AN EMPTY FEED OMITS THE FILTER RATHER THAN PASSING A SENTINEL ID. A read feed with no
       * trades in it is a real, common state — every pending offer in that league IS gone — and
       * `notIn: []` matches nothing in Prisma, so the obvious spelling would silently retire
       * nobody in exactly the case the sweep exists to catch. A placeholder id would work and is
       * worse: this repo has already had a NUL byte written into source by a shell, and Postgres
       * text cannot hold one at all.
       */
      ...(seenIds.length > 0 ? { providerTradeId: { notIn: seenIds } } : {}),
    },
    /*
     * ⚠ `lastSeenAt` IS NOT TOUCHED HERE, WHICH IS THE POINT OF THE COLUMN. These are the offers
     * we did NOT see; advancing their last-seen would erase the only evidence that says so, and
     * would make "gone since when" unanswerable the moment it is asked.
     */
    data: { status: 'vanished' },
  })
  result.vanished = gone.count
  return result
}
