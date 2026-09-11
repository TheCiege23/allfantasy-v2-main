/**
 * Dynasty historical import — normalize and persist: SeasonResult, LeagueDynastySeason, LeagueTrade.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { upsertSeasonResults } from "@/lib/rankings-engine/hall-of-fame";
import type { NormalizedStandingRow, NormalizedTradeFact } from "./types";

/**
 * Persist standings for one season under our internal leagueId.
 */
export async function persistStandings(
  leagueId: string,
  season: number,
  rows: NormalizedStandingRow[]
): Promise<void> {
  if (rows.length === 0) return;
  await upsertSeasonResults({
    leagueId,
    season: String(season),
    rows: rows.map((r) => ({
      rosterId: r.rosterId,
      wins: r.wins,
      losses: r.losses,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      champion: r.champion,
    })),
  });
}

/**
 * Upsert LeagueDynastySeason so graph and history know which platform league id to use per season.
 */
export async function persistDynastySeason(
  leagueId: string,
  season: number,
  platformLeagueId: string,
  provider: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  const metadataJson =
    metadata === undefined ? undefined : (metadata as Prisma.InputJsonValue | null)

  await prisma.leagueDynastySeason.upsert({
    where: {
      uniq_league_dynasty_season_league_season: { leagueId, season },
    },
    update: {
      platformLeagueId,
      provider,
      importedAt: new Date(),
      ...(metadataJson === null
        ? { metadata: Prisma.JsonNull }
        : metadataJson !== undefined
          ? { metadata: metadataJson }
          : {}),
    },
    create: {
      leagueId,
      season,
      platformLeagueId,
      provider,
      ...(metadataJson === null
        ? { metadata: Prisma.JsonNull }
        : metadataJson !== undefined
          ? { metadata: metadataJson }
          : {}),
    },
  });
}

/**
 * `LeagueTrade.partnerRosterId` is `Int?`, but a roster id is a provider-native string and Yahoo's
 * and MFL's are not integers. Rather than widen the column (a migration, and this field is
 * secondary display data), store it only when the round-trip is LOSSLESS and `null` otherwise.
 *
 * 🛑 "0001" MUST BECOME `null`, NOT `1`. Consumers join `partnerRosterId` against
 * `LeagueTeam.externalId`, which is a String column holding "0001" — so writing `1` produces a
 * value that looks populated and can never match, which is strictly worse than an honest null.
 * This is the same shape as the documented `previous_owner_roster_id` gap on `NormalizedTradedPick`.
 */
function toPartnerRosterColumn(rosterId: string | undefined): number | null {
  if (!rosterId) return null;
  const n = Number(rosterId);
  if (!Number.isInteger(n)) return null;
  return String(n) === rosterId ? n : null;
}

/**
 * Persist trades for one season: create LeagueTradeHistory per user involved, then LeagueTrade per (history, transaction).
 * rosterIdToOwner: roster_id (provider-native string) -> owner id (string).
 *
 * ⚠ EVERY ROSTER COMPARISON BELOW IS A STRING COMPARISON, DELIBERATELY. These were `Number(...)`
 * equality checks, which silently collapsed MFL's zero-padded ids and NaN'd Yahoo's dotted ones.
 * See `NormalizedTradeFact` for the measurement.
 */
export async function persistTradesForSeason(
  platformLeagueId: string,
  season: number,
  trades: NormalizedTradeFact[],
  rosterIdToOwner: Map<string, string>
): Promise<number> {
  if (trades.length === 0) return 0;
  const ownerIdsNeeded = new Set<string>();
  for (const t of trades) {
    for (const rid of t.rosterIds) {
      const owner = rosterIdToOwner.get(rid);
      if (owner) ownerIdsNeeded.add(owner);
    }
  }
  const historyByOwner = new Map<string, string>();
  for (const ownerId of ownerIdsNeeded) {
    const hist = await prisma.leagueTradeHistory.upsert({
      where: {
        sleeperLeagueId_sleeperUsername: {
          sleeperLeagueId: platformLeagueId,
          sleeperUsername: ownerId,
        },
      },
      update: { updatedAt: new Date() },
      create: {
        sleeperLeagueId: platformLeagueId,
        sleeperUsername: ownerId,
        status: "complete",
        tradesLoaded: 0,
        totalTradesFound: 0,
      },
      select: { id: true },
    });
    historyByOwner.set(ownerId, hist.id);
  }

  let inserted = 0;
  for (const t of trades) {
    const rosterIds = [...new Set(t.rosterIds)].filter(Boolean);
    const adds = t.adds ?? {};
    const drops = t.drops ?? {};
    const picks = t.draftPicks ?? [];
    for (const rosterId of rosterIds) {
      const ownerId = rosterIdToOwner.get(rosterId);
      if (!ownerId) continue;
      const historyId = historyByOwner.get(ownerId);
      if (!historyId) continue;
      const partnerRosterId = rosterIds.find((r) => r !== rosterId);
      const playersReceived = Object.entries(adds).filter(([, r]) => r === rosterId).map(([pid]) => pid);
      const playersGiven = Object.entries(drops).filter(([, r]) => r === rosterId).map(([pid]) => pid);
      const picksReceived = picks.filter((p) => p.ownerId === rosterId).map((p) => ({ season: p.season, round: p.round }));
      const picksGiven = picks.filter((p) => p.previousOwnerId === rosterId).map((p) => ({ season: p.season, round: p.round }));
      await prisma.leagueTrade.upsert({
        where: {
          historyId_transactionId: { historyId, transactionId: t.transactionId },
        },
        update: {
          week: t.week,
          season,
          playersGiven: playersGiven as any,
          playersReceived: playersReceived as any,
          picksGiven: picksGiven as any,
          picksReceived: picksReceived as any,
          partnerRosterId: toPartnerRosterColumn(partnerRosterId),
          tradeDate: t.created ? new Date(t.created) : null,
        },
        create: {
          historyId,
          transactionId: t.transactionId,
          week: t.week,
          season,
          playersGiven: playersGiven as any,
          playersReceived: playersReceived as any,
          picksGiven: picksGiven as any,
          picksReceived: picksReceived as any,
          partnerRosterId: toPartnerRosterColumn(partnerRosterId),
          partnerName: null,
          tradeDate: t.created ? new Date(t.created) : null,
          platform: "sleeper",
          sport: "nfl",
        },
      });
      inserted++;
    }
  }
  return inserted;
}
