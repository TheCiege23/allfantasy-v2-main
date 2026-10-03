import { createHash } from "node:crypto";

export type PreparationContext = {
  sport: string;
  season: number;
  leagueType: string;
  draftType: string;
  teamCount: number;
  scoring: string;
  scoringRules: unknown;
  rosterSlots: string[];
  playerPool: string;
  purpose: string;
};
export type PreparationEntry = {
  playerKey: string;
  playerName: string;
  position: string;
  adp: number;
  sampleSize: number;
  minPick: number;
  maxPick: number;
  standardDeviation: number | null;
};
export type PreparationSnapshot = {
  version: 1;
  provider: "AllFantasy";
  context: PreparationContext;
  observedAt: string;
  entries: PreparationEntry[];
};
export type PreparationPlayer = PreparationEntry & {
  rank: number;
  tier: number;
  rosterFit: boolean;
  withinNextRound: number;
  personalRank?: number;
};
export const PREPARATION_VERSION = "hq-adp-v1";
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, stable(x)]),
    );
  return v;
}
export function preparationContext(
  league: {
    sport: unknown;
    season: number | null;
    scoring?: string | null;
    isDynasty?: boolean;
    leagueVariant?: string | null;
    settings?: unknown;
  },
  session: {
    draftType: string;
    teamCount: number;
    playerPool?: string;
    draftModeLabel?: string | null;
  },
): PreparationContext | null {
  const settings = record(league.settings);
  const foundation = record(settings.foundation_defaults);
  const roster = record(settings.rosterSettings ?? foundation.roster);
  const rawSlots = settings.roster_positions ?? settings.rosterPositions;
  const starterCounts = record(
    settings.starter_slots ?? roster.starter_slots ?? roster.starterSlots,
  );
  const slots = Array.isArray(rawSlots)
    ? rawSlots
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.toUpperCase())
        .sort()
    : Object.entries(starterCounts).flatMap(([slot, count]) =>
        typeof count === "number" &&
        Number.isInteger(count) &&
        count > 0 &&
        count <= 100
          ? (Array(count).fill(slot.toUpperCase()) as string[])
          : [],
      );
  if (!Array.isArray(rawSlots)) {
    for (const [slot, value] of [
      ["BN", settings.bench_slots ?? roster.benchSlots],
      ["IR", settings.ir_slots ?? roster.irSlots],
      ["TAXI", settings.taxi_slots ?? roster.taxiSlots],
    ] as const) {
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value > 0 &&
        value <= 100
      )
        slots.push(...Array(value).fill(slot));
    }
    slots.sort();
  }
  const rules =
    settings.scoring_settings ??
    settings.scoringSettings ??
    foundation.scoring ??
    settings.scoring;
  const scoring =
    league.scoring ?? settings.scoring_format ?? settings.scoringFormat;
  if (
    !league.season ||
    !Number.isInteger(session.teamCount) ||
    session.teamCount < 2 ||
    typeof scoring !== "string" ||
    !scoring.trim() ||
    !slots.length
  )
    return null;
  return {
    sport: String(league.sport).toUpperCase(),
    season: league.season,
    leagueType:
      league.leagueVariant?.toLowerCase() ||
      (typeof settings.league_type === "string"
        ? settings.league_type.toLowerCase()
        : "") ||
      (league.isDynasty ? "dynasty" : "redraft"),
    draftType: session.draftType.toLowerCase(),
    teamCount: session.teamCount,
    scoring: String(scoring).toLowerCase(),
    scoringRules: stable(rules ?? null),
    rosterSlots: slots,
    playerPool: (session.playerPool ?? "all").toLowerCase(),
    purpose: (session.draftModeLabel ?? "standard").toLowerCase(),
  };
}
export function preparationFormatKey(context: PreparationContext): string {
  return (
    "hq-v1:" +
    createHash("sha256")
      .update(JSON.stringify(stable(context)))
      .digest("hex")
      .slice(0, 24)
  );
}
export function preparationPlayerKey(name: string, position: string): string {
  return name.trim().toLowerCase() + "|" + position.trim().toUpperCase();
}
export function validPreparationSnapshot(
  raw: unknown,
  context: PreparationContext,
  cutoff: Date,
): PreparationSnapshot | null {
  const s = record(raw);
  if (
    s.version !== 1 ||
    s.provider !== "AllFantasy" ||
    !s.context ||
    JSON.stringify(stable(s.context)) !== JSON.stringify(stable(context))
  )
    return null;
  const observed =
    typeof s.observedAt === "string" ? Date.parse(s.observedAt) : NaN;
  if (
    !Number.isFinite(observed) ||
    observed > cutoff.getTime() ||
    !Array.isArray(s.entries)
  )
    return null;
  const entries = s.entries.filter((e): e is PreparationEntry => {
    const r = record(e);
    return (
      typeof r.playerName === "string" &&
      !!r.playerName.trim() &&
      typeof r.position === "string" &&
      !!r.position.trim() &&
      r.playerKey === preparationPlayerKey(r.playerName, r.position) &&
      typeof r.adp === "number" &&
      Number.isFinite(r.adp) &&
      r.adp > 0 &&
      typeof r.sampleSize === "number" &&
      Number.isInteger(r.sampleSize) &&
      r.sampleSize > 0 &&
      typeof r.minPick === "number" &&
      Number.isFinite(r.minPick) &&
      r.minPick > 0 &&
      typeof r.maxPick === "number" &&
      Number.isFinite(r.maxPick) &&
      r.maxPick >= r.minPick &&
      (r.standardDeviation === null ||
        (typeof r.standardDeviation === "number" &&
          Number.isFinite(r.standardDeviation) &&
          r.standardDeviation >= 0))
    );
  });
  const keys = new Set(entries.map((e) => e.playerKey));
  if (!entries.length || entries.length !== s.entries.length || keys.size !== entries.length)
    return null;
  return {
    version: 1,
    provider: "AllFantasy",
    context,
    observedAt: s.observedAt as string,
    entries,
  };
}
export function pickAdpDifference(
  overall: number,
  adp: number | null,
): number | null {
  return Number.isInteger(overall) &&
    overall > 0 &&
    adp != null &&
    Number.isFinite(adp) &&
    adp > 0
    ? Math.round((overall - adp) * 10) / 10
    : null;
}
export function preparationPlayers(
  snapshot: PreparationSnapshot,
  excluded: Set<string>,
  heldPositions: string[],
): PreparationPlayer[] {
  const slots = snapshot.context.rosterSlots.filter(
    (s) => !["BN", "BE", "IR", "TAXI"].includes(s),
  );
  const counts = new Map<string, number>();
  heldPositions.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
  const entries = snapshot.entries
    .filter((e) => !excluded.has(e.playerKey))
    .sort((a, b) => a.adp - b.adp || a.playerKey.localeCompare(b.playerKey));
  const positionAdps = new Map<string, number[]>();
  entries.forEach((e) => {
    const list = positionAdps.get(e.position) ?? [];
    list.push(e.adp);
    positionAdps.set(e.position, list);
  });
  const lowerBound = (values: number[], target: number) => {
    let lo = 0,
      hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (values[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return entries.map((e, i) => {
    const values = positionAdps.get(e.position)!;
    return {
      ...e,
      rank: i + 1,
      tier: Math.max(1, Math.ceil(e.adp / snapshot.context.teamCount)),
      rosterFit:
        slots.filter((p) => p === e.position).length >
        (counts.get(e.position) ?? 0),
      withinNextRound:
        lowerBound(values, e.adp + snapshot.context.teamCount) -
        lowerBound(values, e.adp),
    };
  });
}
export type OutlookInput = {
  id: string;
  name: string;
  capital: number;
  flexibility: number;
  keeperValue: number | null;
};
export function preDraftOutlook(
  teams: OutlookInput[],
  equivalentFreshRedraft: boolean,
) {
  const score = (v: number, all: number[]) => {
    const min = Math.min(...all),
      max = Math.max(...all);
    return max === min ? 50 : Math.round((1000 * (v - min)) / (max - min)) / 10;
  };
  const available = teams.filter((t) => t.keeperValue != null);
  if (available.length !== teams.length || teams.length < 2) return [];
  const rows = teams
    .map((t) => {
      const roster = equivalentFreshRedraft
        ? 50
        : score(
            t.keeperValue!,
            teams.map((x) => x.keeperValue!),
          );
      const capital = equivalentFreshRedraft
        ? 50
        : score(
            t.capital,
            teams.map((x) => x.capital),
          );
      const flexibility = equivalentFreshRedraft
        ? 50
        : score(
            t.flexibility,
            teams.map((x) => x.flexibility),
          );
      return {
        id: t.id,
        name: t.name,
        roster,
        capital,
        flexibility,
        score:
          Math.round(
            (roster * 0.45 + capital * 0.35 + flexibility * 0.2) * 10,
          ) / 10,
        rank: 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  rows.forEach(
    (t, i) =>
      (t.rank = i && t.score === rows[i - 1].score ? rows[i - 1].rank : i + 1),
  );
  return rows;
}
