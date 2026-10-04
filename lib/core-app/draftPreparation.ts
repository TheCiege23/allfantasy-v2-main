import "server-only";
import { prisma } from "@/lib/prisma";
import { getDraftPlanningPreference } from './draftPlanningPreferenceStore';
import type { DraftPlanningPreference } from './draftPlanningPreferenceModel';
import { createHash } from "node:crypto";
import {
  preparationContext,
  preparationFormatKey,
  preparationPlayerKey,
  validPreparationSnapshot,
  preparationPlayers,
  preDraftOutlook,
  pickAdpDifference,
  matchingPreparationEntry,
  type PreparationContext,
  type PreparationPlayer,
} from "./draftPreparationModel";
import { computePickInventory } from "./draftPickInventory";
import { buildKeeperLocks } from "@/lib/live-draft-engine/keeper/KeeperDraftOrder";
import type { KeeperSelection } from "@/lib/live-draft-engine/keeper/types";
import type {
  DraftType,
  TradedPickRecord,
} from "@/lib/live-draft-engine/types";
import {
  isDraftPickRowEmpty,
  isDraftPickSkipped,
} from "@/lib/live-draft-engine/draftPickEmpty";

export type DraftPreparationData = {
  planningPreference?: DraftPlanningPreference | null;
  planningPreferenceState?: 'ready' | 'error';
  state: "ready" | "empty" | "unsupported" | "error";
  reason: string | null;
  sessionId: string | null;
  context: PreparationContext | null;
  observedAt: string | null;
  historical: boolean;
  players: PreparationPlayer[];
  comparisons: Array<{
    overall: number;
    playerName: string;
    teamName: string | null;
    adp: number | null;
    difference: number | null;
    sampleSize: number | null;
  }>;
  outlook: ReturnType<typeof preDraftOutlook>;
  outlookReason: string | null;
  keeperCosts: Array<{
    playerName: string;
    teamName: string;
    round: number;
    adp: number | null;
    costOverall: number | null;
    difference: number | null;
  }>;
  queue: {
    state: "ready" | "empty" | "unsupported" | "error";
    count: number | null;
    autopick: string;
  };
  preferenceScope: string | null;
  customRankingsEnabled: boolean;
};
export type PreparationSession = {
  id: string;
  status: string;
  draftType: string;
  rounds: number;
  teamCount: number;
  slotOrder: unknown;
  tradedPicks: unknown;
  keeperSelections: unknown;
  thirdRoundReversal: boolean;
  startedAt: Date | null;
  playerPool: string;
  draftModeLabel: string | null;
  sleeperDraftId: string | null;
  customRankingsEnabled: boolean;
};
export function unavailablePreparation(
  reason: string,
  state: DraftPreparationData["state"] = "unsupported",
): DraftPreparationData {
  return {
    state,
    reason,
    sessionId: null,
    context: null,
    observedAt: null,
    historical: false,
    players: [],
    comparisons: [],
    outlook: [],
    outlookReason: reason,
    keeperCosts: [],
    queue: {
      state: "unsupported",
      count: null,
      autopick: "Queue settings are unavailable.",
    },
    customRankingsEnabled: false,
    preferenceScope: null,
  };
}
export async function getDraftPreparationData(
  league: {
    id: string;
    sport: unknown;
    season: number | null;
    scoring?: string | null;
    isDynasty: boolean;
    leagueVariant: string | null;
    settings: unknown;
  },
  session: PreparationSession | null,
  userId: string,
  myRosterId?: string,
): Promise<DraftPreparationData> {
  if (!session)
    return unavailablePreparation(
      "Choose a draft scheduled in AllFantasy to prepare. Historical imported ADP needs a preserved draft-time context.",
    );
  let context = preparationContext(league, session);
  const historical = ![
    "pre_draft",
    "scheduled",
    "configuring",
    "configured",
  ].includes(session.status);
  if (historical) {
    const start = session.startedAt ? await prisma.leagueAuditLog.findFirst({
      where: { leagueId: league.id, entityType: 'draft_session', entityId: session.id, actionType: 'draft_archive_event', AND: [
        { afterState: { path: ['event'], equals: 'start' } },
        { afterState: { path: ['snapshot', 'session', 'startedAt'], equals: session.startedAt.toISOString() } },
      ] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { afterState: true },
    }) : null;
    const state = start?.afterState && typeof start.afterState === 'object' ? start.afterState as Record<string, unknown> : {};
    context = state.context ? state.context as PreparationContext : null;
  }
  const base = {
    ...unavailablePreparation(
      "No compatible observed ADP snapshot is available.",
      "empty",
    ),
    sessionId: session.id,
    preferenceScope: createHash("sha256")
      .update(userId + "|" + session.id)
      .digest("hex")
      .slice(0, 24),
    context,
    historical,
    customRankingsEnabled: session.customRankingsEnabled !== false,
  };
  if (!["snake", "linear", "auction"].includes(session.draftType))
    return {
      ...base,
      state: "unsupported",
      reason: "This draft format has no compatible preparation benchmark.",
    };
  if (session.draftType === "auction")
    return {
      ...base,
      state: "unsupported",
      reason:
        "Auction preparation needs observed bid prices and budgets. Pick-order ADP is not a price benchmark.",
    };
  if (!context)
    return {
      ...base,
      state: "unsupported",
      reason:
        "Scoring and roster slots must be recorded before this draft can use a matching ADP board.",
    };
  const cutoff = historical ? session.startedAt : new Date();
  if (!cutoff)
    return {
      ...base,
      state: "unsupported",
      reason:
        "This draft has no verified start time, so a draft-time ADP comparison cannot be made.",
    };
  const [history, picks, queueResult, planning] = await Promise.all([
    prisma.aiAdpSnapshotHistory.findFirst({
      where: {
        sport: context.sport,
        leagueType: "draft_hq",
        formatKey: preparationFormatKey(context),
        computedAt: { lte: cutoff },
      },
      orderBy: [{ computedAt: "desc" }, { id: "desc" }],
      select: { snapshotData: true },
    }),
    prisma.draftPick.findMany({
      where: { sessionId: session.id },
      orderBy: { overall: "asc" },
      take: 10000,
      select: {
        playerId: true,
        overall: true,
        playerName: true,
        position: true,
        rosterId: true,
        displayName: true,
        pickMetadata: true,
      },
    }),
    session.sleeperDraftId
      ? Promise.resolve({
          state: "unsupported" as const,
          count: null,
          autopick: "The provider controls its own queue and autopick.",
        })
      : Promise.all([
          prisma.draftQueue.findUnique({
            where: { sessionId_userId: { sessionId: session.id, userId } },
            select: { order: true },
          }),
          prisma.liveDraftAutopickPreference.findUnique({
            where: {
              draft_session_user_unique: { draftSessionId: session.id, userId },
            },
            select: { enabled: true, mode: true },
          }),
        ])
          .then(([queue, pref]) => {
            return {
              state: "ready" as const,
              count: 0,
              autopick: pref?.enabled
                ? pref.mode === "ai_queue"
                  ? "Chimmy queue autopick is enabled."
                  : "Standard autopick is enabled; it tries your live queue before fallback rules."
                : "Your personal autopick is disabled.",
              order: queue?.order,
            };
          })
          .catch(() => ({
            state: "error" as const,
            count: null,
            autopick:
              "Queue or autopick settings could not be loaded. Retry this page.",
          })),
    getDraftPlanningPreference(userId, league.id, session.id).then(value => ({ value, state: 'ready' as const })).catch(() => ({ value: null, state: 'error' as const })),
  ]);
  const validPicks = picks.filter(
    (p) => !isDraftPickRowEmpty(p) && !isDraftPickSkipped(p),
  );
  const selected = new Set(
    validPicks.map((p) =>
      preparationPlayerKey(p.playerName, p.position, p.playerId),
    ),
  );
  const queued =
    "order" in queueResult && Array.isArray(queueResult.order)
      ? (queueResult.order as Array<{ playerName?: string; position?: string }>)
      : [];
  const selectedNames = new Set([
    ...validPicks.map((p) => p.playerName.trim().toLowerCase()),
    ...(Array.isArray(session.keeperSelections)
      ? (session.keeperSelections as Array<{ playerName: string }>).map((k) =>
          k.playerName.trim().toLowerCase(),
        )
      : []),
  ]);
  const queueKeys = new Set(
    queued
      .filter((e) => e.playerName)
      .map((e) => e.playerName!.trim().toLowerCase())
      .filter((key) => key && !selectedNames.has(key)),
  );
  const queue =
    queueResult.state === "ready"
      ? {
          ...queueResult,
          state: queueKeys.size ? ("ready" as const) : ("empty" as const),
          count: queueKeys.size,
        }
      : queueResult;
  const snapshot = validPreparationSnapshot(
    history?.snapshotData,
    context,
    cutoff,
  );
  const order = Array.isArray(session.slotOrder)
    ? (session.slotOrder as Array<{
        slot: number;
        rosterId: string;
        displayName: string;
      }>)
    : [];
  const keepers = Array.isArray(session.keeperSelections)
    ? (session.keeperSelections as Array<{
        rosterId: string;
        playerName: string;
        position: string;
        roundCost: number;
        playerId?: string | null;
        team?: string | null;
      }>)
    : [];
  const lookup = new Map(snapshot?.entries.map((e) => [e.playerKey, e]) ?? []);
  const trades = Array.isArray(session.tradedPicks)
    ? (session.tradedPicks as TradedPickRecord[])
    : [];
  const inventories = order.map((t) => ({
    team: t,
    inventory: computePickInventory({
      myRosterId: t.rosterId,
      slotOrder: order,
      teamCount: session.teamCount,
      rounds: session.rounds,
      draftType: session.draftType as DraftType,
      thirdRoundReversal: session.thirdRoundReversal,
      tradedPicks: trades,
    }),
  }));
  const locks = buildKeeperLocks(
    keepers.map((k) => ({
      ...k,
      team: k.team ?? null,
      playerId: k.playerId ?? null,
    })) as KeeperSelection[],
    order,
    trades,
    session.teamCount,
    session.rounds,
    session.draftType as DraftType,
    session.thirdRoundReversal,
  );
  const keeperCosts = locks.map((k) => {
    const inv = inventories.find((i) => i.team.rosterId === k.rosterId);
    const cost = k.overall;
    const adp =
      matchingPreparationEntry(lookup, k.playerName, k.position, k.playerId)
        ?.adp ?? null;
    return {
      playerName: k.playerName,
      teamName: inv?.team.displayName ?? k.rosterId,
      round: k.round,
      adp,
      costOverall: cost,
      difference: cost ? pickAdpDifference(cost, adp) : null,
    };
  });
  const fullOrder =
    order.length === session.teamCount &&
    new Set(order.map((t) => t.rosterId)).size === session.teamCount &&
    new Set(order.map((t) => t.slot)).size === session.teamCount &&
    order.every((t) => t.slot >= 1 && t.slot <= session.teamCount);
  const dynasty =
    context.leagueType.includes("dynasty") ||
    context.purpose !== "standard" ||
    context.playerPool !== "all";
  const outlookReason = historical
    ? "Pre-draft outlook is available only before the draft starts."
    : dynasty
      ? "A draft-time existing-roster value snapshot is required for this league format."
      : session.sleeperDraftId
        ? "Provider pick ownership is not complete enough to rank draft capital."
        : !fullOrder
          ? "A complete draft order is required to compare teams."
          : keepers.some(
                (k) =>
                  !matchingPreparationEntry(
                    lookup,
                    k.playerName,
                    k.position,
                    k.playerId,
                  ),
              )
            ? "At least one keeper has no compatible ADP; team outlook is unavailable."
            : null;
  const teams = inventories.map(({ team, inventory }) => {
    const mine = locks.filter((k) => k.rosterId === team.rosterId);
    const spent = new Set(mine.map((k) => k.overall));
    const free = inventory.held.filter((p) => !spent.has(p.overall));
    return {
      id: team.rosterId,
      name: team.displayName || team.rosterId,
      capital: free.reduce((sum, p) => sum + 1 / Math.sqrt(p.overall), 0),
      flexibility: free.length,
      keeperValue: mine.every(
        (k) =>
          !!matchingPreparationEntry(
            lookup,
            k.playerName,
            k.position,
            k.playerId,
          ),
      )
        ? mine.reduce(
            (sum, k) =>
              sum +
              1 /
                Math.sqrt(
                  lookup.get(
                    preparationPlayerKey(k.playerName, k.position, k.playerId),
                  )!.adp,
                ),
            0,
          )
        : null,
    };
  });
  return {
    ...base,
    planningPreference: planning.value,
    planningPreferenceState: planning.state,
    state: snapshot ? "ready" : "empty",
    reason: snapshot ? null : base.reason,
    observedAt: snapshot?.observedAt ?? null,
    queue,
    players: snapshot
      ? preparationPlayers(
          snapshot,
          new Set([
            ...selected,
            ...keepers.map((k) =>
              preparationPlayerKey(k.playerName, k.position, k.playerId),
            ),
          ]),
          [
            ...new Map(
              [
                ...locks.filter((k) => k.rosterId === myRosterId),
                ...validPicks.filter((p) => p.rosterId === myRosterId),
              ].map((p) => [
                preparationPlayerKey(p.playerName, p.position, p.playerId),
                p.position,
              ]),
            ).values(),
          ],
        )
      : [],
    comparisons: validPicks.map((p) => {
      const entry = matchingPreparationEntry(
        lookup,
        p.playerName,
        p.position,
        p.playerId,
      );
      return {
        overall: p.overall,
        playerName: p.playerName,
        teamName: p.displayName,
        adp: entry?.adp ?? null,
        difference: pickAdpDifference(p.overall, entry?.adp ?? null),
        sampleSize: entry?.sampleSize ?? null,
      };
    }),
    outlook: outlookReason
      ? []
      : preDraftOutlook(teams, trades.length === 0 && keepers.length === 0),
    outlookReason,
    keeperCosts,
  };
}
