"use client";

import Link from "next/link";

type Profile = {
  strongestRivalries?: Array<{ nodeA: string; nodeB: string; intensityScore: number; weight: number }>;
  tradeClusters?: Array<{ id: string; members: Array<{ nodeId: string; entityId: string }>; dominantPair?: { nodeA: string; nodeB: string; weight: number } }>;
  influenceLeaders?: Array<{ nodeId: string; entityId: string; compositeScore: number; centralityScore: number; tradeInfluenceScore: number; rivalryInfluenceScore: number; championshipImpactScore: number }>;
  centralManagers?: Array<{ nodeId: string; entityId: string }>;
  isolatedManagers?: Array<{ nodeId: string; entityId: string }>;
};

function parseManagerIdCandidates(entityId: string): { managerId: string; ownerName: string } {
  if (!entityId.startsWith("manager:")) {
    return { managerId: entityId, ownerName: entityId };
  }
  const parts = entityId.split(":");
  const ownerName = parts[1] ?? entityId;
  const managerId = parts[2] ?? ownerName;
  return { managerId, ownerName };
}

export function ManagerRelationshipCard({
  leagueId,
  entityId,
  nodeId,
  centralityScore,
  profile,
  sport,
  season,
  highlighted = false,
}: {
  leagueId: string;
  entityId: string;
  nodeId: string;
  centralityScore: number;
  profile: Profile;
  sport?: string | null;
  season?: number | null;
  highlighted?: boolean;
}) {
  const rivals = (profile.strongestRivalries ?? []).filter(
    (r) => r.nodeA === nodeId || r.nodeB === nodeId
  );
  const myClusters = (profile.tradeClusters ?? []).filter((c) =>
    c.members?.some((m: { nodeId: string }) => m.nodeId === nodeId)
  );
  const tradePartners = myClusters.flatMap((c) =>
    (c.members ?? []).filter((m: { nodeId: string }) => m.nodeId !== nodeId)
  );
  const influence = (profile.influenceLeaders ?? []).find((l) => l.nodeId === nodeId || l.entityId === entityId);
  const nodeEntityMap = new Map<string, string>([
    ...((profile.centralManagers ?? []).map((m) => [m.nodeId, m.entityId] as const)),
    ...((profile.isolatedManagers ?? []).map((m) => [m.nodeId, m.entityId] as const)),
  ]);

  const { managerId, ownerName } = parseManagerIdCandidates(entityId);
  const displayName = ownerName.slice(0, 24);
  const topRivalNodeId = rivals[0] ? (rivals[0].nodeA === nodeId ? rivals[0].nodeB : rivals[0].nodeA) : null;
  const topRivalEntityId = topRivalNodeId ? nodeEntityMap.get(topRivalNodeId) ?? null : null;
  const topRivalManagerId = topRivalEntityId ? parseManagerIdCandidates(topRivalEntityId).managerId : null;
  const query = new URLSearchParams();
  if (sport) query.set("sport", sport);
  if (season != null) query.set("season", String(season));
  query.set("relatedManagerId", managerId);

  return (
    <div
      className={`rounded-xl border bg-black/20 p-3 ${
        highlighted ? "border-cyan-400/35" : "border-white/10"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-white">{displayName}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">
          Centrality {(centralityScore * 100).toFixed(0)}%
        </span>
      </div>
      {influence && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
          <span>Influence {(influence.compositeScore * 100).toFixed(0)}%</span>
          {influence.championshipImpactScore > 0 && (
            <span>Champ impact {(influence.championshipImpactScore * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
      {rivals.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-white/50">Key rivals</div>
          <ul className="mt-1 space-y-0.5 text-sm text-white/80">
            {rivals.slice(0, 3).map((r, i) => (
              <li key={i}>
                vs {nodeEntityMap.get(r.nodeA === nodeId ? r.nodeB : r.nodeA) ?? (r.nodeA === nodeId ? r.nodeB : r.nodeA)}{" "}
                (intensity {r.intensityScore.toFixed(0)})
              </li>
            ))}
          </ul>
        </div>
      )}
      {tradePartners.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-white/50">Trade cluster partners</div>
          <ul className="mt-1 space-y-0.5 text-sm text-white/80">
            {tradePartners.slice(0, 5).map((m: { entityId: string; nodeId: string }, i: number) => (
              <li key={i}>{m.entityId?.replace(/^manager:/, "").split(":")[0] ?? m.nodeId}</li>
            ))}
          </ul>
        </div>
      )}
      {rivals.length === 0 && tradePartners.length === 0 && !influence && (
        <p className="mt-2 text-xs text-white/50">No relationship data for this manager.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Link
          href={`/app/league/${encodeURIComponent(leagueId)}/drama?${query.toString()}`}
          className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
        >
          Open drama context
        </Link>
        {topRivalManagerId ? (
          <Link
            href={`/app/league/${encodeURIComponent(
              leagueId
            )}/psychological-profiles/compare?managerAId=${encodeURIComponent(
              managerId
            )}&managerBId=${encodeURIComponent(topRivalManagerId)}${sport ? `&sport=${encodeURIComponent(sport)}` : ""}`}
            className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
          >
            Compare behavior profile
          </Link>
        ) : (
          <Link
            href={`/app/league/${encodeURIComponent(leagueId)}/psychological-profiles`}
            className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
          >
            Open behavior profiles
          </Link>
        )}
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
          className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
        >
          Trade context
        </Link>
      </div>
    </div>
  );
}
