/**
 * Price a redraft trade WITHOUT proposing it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
 * `TradeCenterModal` is a client component, so it cannot call `resolveTradeEnrichment` — that is
 * `server-only`. So it built its own preview, and that copy was strictly worse in three ways at
 * once: four of five value sources hardcoded to `null`, an empty `sport`/`scoring`, and no
 * `ScoringContext` — meaning no `LeagueShape`, so standard-league scarcity for everyone and no
 * format fit ever. A manager saw one number in the console and the snapshot written moments later
 * carried another, with nothing saying which to believe.
 *
 * This route calls the SAME function the capture path calls. A preview and a capture are the same
 * valuation; the only difference is whether a row is written afterwards, and this one writes
 * nothing.
 *
 * ── 🛑 IT IS A READ, AND IT IS GATED LIKE A WRITE ──────────────────────────────────────────
 * Pricing a trade reads roster composition, so the gate mirrors `POST /api/redraft/trade-proposals`
 * exactly rather than being relaxed because "it is only a preview":
 *
 *   1. a session, or 401
 *   2. league membership via `assertLeagueMember`, or 403
 *   3. both rosters must belong to THIS season and league, or 404
 *   4. the proposer roster must be owned by the caller, or 403
 *
 * ⚠ STEP 4 IS THE ONE IT WOULD BE EASY TO DROP. Without it any league member could enumerate
 * another manager's roster by pricing trades they never intend to send, and read back the
 * per-asset breakdown for a team they cannot see. A preview that leaks is still a leak.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
/*
 * ⚠ THERE ARE TWO `assertLeagueMember`s IN THIS REPO — this one and `@/lib/league-access`. This
 * is the module `POST /api/redraft/trade-proposals` gates on, and matching it exactly is the
 * point: a preview that admitted someone the proposal route refuses would be a hole, not a
 * convenience.
 */
import { assertLeagueMember } from '@/lib/league/league-access'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { computeRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'

export const dynamic = 'force-dynamic'

/**
 * The asset shape the client already sends to `POST /api/redraft/trade-proposals`, so the console
 * can reuse the exact array it has built rather than assembling a second one.
 *
 * 🛑 `metadata` IS LOAD-BEARING AND WAS NEARLY DROPPED. The compute function reads `position` and
 * `team` from it (position drives the whole scarcity multiplier), `label` for a pick, `amount` for
 * FAAB, and `restOfSeasonProjection` as the fallback when the resolver has nothing. Forwarding
 * only the top-level fields would have priced every player at a 1.0 scarcity and valued every
 * FAAB asset at zero — quietly, with no error anywhere.
 */
type RawAssetBody = {
  fromRosterId?: string
  toRosterId?: string
  assetType?: string
  playerId?: string | null
  playerName?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  metadata?: Record<string, unknown> | null
}

/** Keeps a runaway client from turning a keystroke into a hundred valuations. */
const MAX_ASSETS = 40

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  /*
   * Keyed on the USER, not the IP. The console re-prices as a manager picks players, so a shared
   * office IP would otherwise throttle colleagues against each other.
   */
  const ip = getClientIp(req as never) || 'unknown'
  const rl = rateLimit(`trade-value-preview:${userId}:${ip}`, 60, 60_000)
  if (!rl.success) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  let body: {
    leagueId?: string
    seasonId?: string
    proposerRosterId?: string
    receiverRosterId?: string
    assets?: RawAssetBody[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  const seasonId = body.seasonId?.trim()
  const proposerRosterId = body.proposerRosterId?.trim()
  const receiverRosterId = body.receiverRosterId?.trim()
  const assets = Array.isArray(body.assets) ? body.assets : []

  if (!leagueId || !seasonId || !proposerRosterId || !receiverRosterId) {
    return NextResponse.json({ error: 'Missing leagueId, seasonId or roster ids' }, { status: 400 })
  }
  if (proposerRosterId === receiverRosterId) {
    return NextResponse.json({ error: 'Rosters must be different' }, { status: 400 })
  }
  if (assets.length === 0) {
    return NextResponse.json({ error: 'No assets to price' }, { status: 400 })
  }
  if (assets.length > MAX_ASSETS) {
    return NextResponse.json({ error: `At most ${MAX_ASSETS} assets` }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const [season, proposer, receiver] = await Promise.all([
    prisma.redraftSeason.findFirst({ where: { id: seasonId, leagueId } }),
    prisma.redraftRoster.findFirst({ where: { id: proposerRosterId, seasonId, leagueId } }),
    prisma.redraftRoster.findFirst({ where: { id: receiverRosterId, seasonId, leagueId } }),
  ])

  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  if (!proposer || !receiver) {
    return NextResponse.json({ error: 'Roster not found for season' }, { status: 404 })
  }
  /*
   * ⚠ See the header. Without this a member can price trades from somebody else's roster and read
   * the per-asset breakdown back.
   */
  if (proposer.ownerId !== userId) {
    return NextResponse.json({ error: 'Only the proposer roster owner can price this trade' }, { status: 403 })
  }

  try {
    const snapshot = await computeRedraftTradeValueSnapshot({
      seasonId,
      /*
       * ⚠ WITHOUT THIS EVERY VALUE IS PRICED AS A STANDARD 12-TEAM 1-QB LEAGUE — the exact defect
       * this route exists to remove. The `scoring` string below is a LABEL for the context record;
       * the real scarcity settings are read from the league inside the compute function, and only
       * when this id is supplied.
       */
      leagueId,
      proposerRosterId,
      receiverRosterId,
      sport: season.sport,
      scoring: season.sport === 'NCAAF' ? 'standard' : 'ppr',
      rosterFormat: 'standard',
      currentSeason: season.season ?? null,
      assets: assets.map((a) => ({
        fromRosterId: String(a.fromRosterId ?? ''),
        toRosterId: String(a.toRosterId ?? ''),
        assetType: String(a.assetType ?? 'player'),
        playerId: a.playerId ?? null,
        playerName: a.playerName ?? null,
        pickSeason: a.pickSeason ?? null,
        pickRound: a.pickRound ?? null,
        // See RawAssetBody: dropping this silently prices every player at 1.0 scarcity.
        metadata: a.metadata ?? null,
      })),
    })

    return NextResponse.json({ snapshot })
  } catch {
    /*
     * ⚠ A FAILED VALUATION MUST NOT LOOK LIKE A CHEAP TRADE. The caller falls back to its own
     * client-side estimate on a non-200 and labels it as such; returning a zeroed snapshot here
     * would be indistinguishable from a real one saying both sides are worthless.
     */
    return NextResponse.json({ error: 'Could not price this trade' }, { status: 500 })
  }
}
