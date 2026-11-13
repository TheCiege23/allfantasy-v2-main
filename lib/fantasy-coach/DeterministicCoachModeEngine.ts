import {
  buildLineupForSimulationPreset,
  getDefaultScheduleFactorsForPreset,
  getSimulationTeamPresets,
  type SimulationTeamPreset,
} from '@/lib/matchup-simulator/SportSimulationUIResolver';
import { summarizeMatchupTeamInput } from '@/lib/simulation-engine/DeterministicMatchupEngine';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import type { MatchupLineupSlotSummary } from '@/lib/simulation-engine/types';
import {
  getRankingsToolHref,
  getTradeAnalyzerHref,
  getWaiverToolHref,
} from './CoachToolResolver';
import { getStrategyRecommendation } from './StrategyRecommendationEngine';
import type {
  ActionRecommendation,
  CoachContext,
  CoachEvaluationMetric,
  CoachEvaluationResult,
  CoachProviderInsights,
  CoachTeamSnapshot,
  TradeSuggestion,
  WaiverOpportunity,
} from './types';

type CoachSlotTemplate = {
  name: string;
  focus: string;
};

type CoachEngineSnapshot = {
  sport: string;
  teamName: string;
  week: number;
  leagueId?: string;
  leagueName?: string;
  deterministicSeed: number;
  teamPreset: SimulationTeamPreset;
  peerPreset: SimulationTeamPreset;
  teamSummary: ReturnType<typeof summarizeMatchupTeamInput>;
  peerSummary: ReturnType<typeof summarizeMatchupTeamInput>;
  strongestSlot: MatchupLineupSlotSummary;
  weakestSlot: MatchupLineupSlotSummary;
  swingSlot: MatchupLineupSlotSummary;
  secondaryWeakestSlot: MatchupLineupSlotSummary;
  bestFloorSlot: MatchupLineupSlotSummary;
  topCeilingSlot: MatchupLineupSlotSummary;
  lineupStrategy: Awaited<ReturnType<typeof getStrategyRecommendation>>;
  tradeStrategy: Awaited<ReturnType<typeof getStrategyRecommendation>>;
  waiverStrategy: Awaited<ReturnType<typeof getStrategyRecommendation>>;
};

const WAIVER_CANDIDATES: Record<string, Record<string, CoachSlotTemplate[]>> = {
  NFL: {
    QB: [
      { name: 'Pocket Tempo QB', focus: 'rushing floor and red-zone snaps' },
      { name: 'Late Window Streamer QB', focus: 'home split leverage and pass volume' },
    ],
    RB: [
      { name: 'Satellite Back Stash', focus: 'receiving work and injury insurance' },
      { name: 'Goal-Line RB Claim', focus: 'touchdown equity and short-yardage work' },
    ],
    WR: [
      { name: 'Slot Volume WR', focus: 'target share stability' },
      { name: 'Downfield Spike WR', focus: 'ceiling routes and splash-play upside' },
    ],
    TE: [
      { name: 'Red-Zone TE Streamer', focus: 'end-zone usage and route growth' },
      { name: 'Move TE Stash', focus: 'snap climb and matchup insulation' },
    ],
    FLEX: [
      { name: 'Flex Touches Swingman', focus: 'multi-role volume' },
      { name: 'Passing-Down Flex Add', focus: 'portable weekly floor' },
    ],
    K: [{ name: 'Indoor Kicker Boost', focus: 'clean kicking environment' }],
    DST: [{ name: 'Pressure Front DST', focus: 'sack rate and turnover pressure' }],
  },
  NBA: {
    PG: [
      { name: 'Usage Spike Guard', focus: 'ball dominance and assist runway' },
      { name: 'Pace Guard Streamer', focus: 'tempo-driven counting stats' },
    ],
    SG: [
      { name: 'Volume Wing Gunner', focus: 'shot attempts and threes' },
      { name: 'Minutes-Safe SG', focus: 'stable rotation floor' },
    ],
    SF: [
      { name: 'Stocks Wing Add', focus: 'steals and block coverage' },
      { name: 'Rebounding Wing', focus: 'category balance on busy slates' },
    ],
    PF: [
      { name: 'Boards-and-Blocks PF', focus: 'frontcourt defensive stats' },
      { name: 'Stretch Four Streamer', focus: 'spacing plus rebound volume' },
    ],
    C: [
      { name: 'Paint Anchor C', focus: 'rebounds and field-goal stability' },
      { name: 'Pick-and-Roll Big', focus: 'easy buckets and block floor' },
    ],
    G: [{ name: 'Combo Guard Streamer', focus: 'minutes security across both guard slots' }],
    F: [{ name: 'Switchable Forward Add', focus: 'multi-category floor' }],
    UTIL: [{ name: 'Back-to-Back Util Play', focus: 'games-played edge this week' }],
  },
  NHL: {
    C: [
      { name: 'Top-Line Center', focus: 'shot volume and power-play touch' },
      { name: 'Faceoff Floor Center', focus: 'usage stability across scoring lines' },
    ],
    LW: [{ name: 'Attack-Wing LW', focus: 'rush chance creation' }],
    RW: [{ name: 'Power-Play RW', focus: 'special-teams scoring bump' }],
    D: [
      { name: 'Shots-and-Blocks D', focus: 'peripheral floor' },
      { name: 'PP1 Defenseman', focus: 'assist path and usage climb' },
    ],
    G: [
      { name: 'Volume Start Goalie', focus: 'save-count upside' },
      { name: 'Home-Ice Goalie', focus: 'win equity and cleaner matchup' },
    ],
    UTIL: [{ name: 'Streaming Skater', focus: 'games-played leverage this week' }],
  },
  MLB: {
    C: [{ name: 'Split-Friendly Catcher', focus: 'platoon advantage and lineup spot' }],
    '1B': [{ name: 'Barrel 1B Add', focus: 'RBI pockets and hard-contact profile' }],
    '2B': [{ name: 'Runs Table-Setter 2B', focus: 'plate appearances and steals' }],
    '3B': [{ name: 'Pull-Power 3B', focus: 'home-run ceiling' }],
    SS: [{ name: 'Speed SS Claim', focus: 'stolen-base pressure and lineup stickiness' }],
    OF: [
      { name: 'Leadoff OF Boost', focus: 'volume and runs scored' },
      { name: 'Platoon Crusher OF', focus: 'short-term matchup ceiling' },
    ],
    DH: [{ name: 'Hot-Bat DH', focus: 'middle-of-order RBI runway' }],
    UTIL: [{ name: 'Series Stream Bat', focus: 'park and platoon edge' }],
    SP: [
      { name: 'Two-Start SP', focus: 'innings volume and strikeout lane' },
      { name: 'Whiff Rate SP', focus: 'K upside against chase-heavy lineups' },
    ],
    RP: [{ name: 'Saves Spec RP', focus: 'ninth-inning access' }],
    P: [{ name: 'Ratio Stabilizer P', focus: 'clean innings and control profile' }],
  },
  NCAAB: {
    PG: [{ name: 'Lead Guard Streamer', focus: 'assist share and pace control' }],
    SG: [{ name: 'Microwave SG', focus: 'shot volume and scoring bursts' }],
    SF: [{ name: 'Glue Wing Add', focus: 'minutes safety and stat stuffing' }],
    PF: [{ name: 'Boards PF Target', focus: 'rebound cushion and inside touches' }],
    C: [{ name: 'Paint Finisher C', focus: 'blocks and second-chance points' }],
    G: [{ name: 'Rotation Guard Lift', focus: 'extra possessions in uptempo spots' }],
    F: [{ name: 'Switch Forward Stash', focus: 'multi-column production' }],
    UTIL: [{ name: 'Conference Heater Util', focus: 'recent role growth' }],
  },
  NCAAF: {
    QB: [
      { name: 'Rushing QB Streamer', focus: 'designed-run floor' },
      { name: 'Tempo QB Add', focus: 'extra drive volume' },
    ],
    RB: [
      { name: 'Workload RB Claim', focus: 'goal-line share and touch security' },
      { name: 'Pass-Catching RB', focus: 'catch volume in negative game scripts' },
    ],
    WR: [
      { name: 'Target Funnel WR', focus: 'team target concentration' },
      { name: 'Explosive Slot WR', focus: 'yards after catch' },
    ],
    TE: [{ name: 'Play-Action TE', focus: 'red-zone routes and efficiency' }],
    FLEX: [{ name: 'Flex Usage Swingman', focus: 'portable touch volume' }],
    K: [{ name: 'High-Total Kicker', focus: 'scoring environment' }],
    DST: [{ name: 'Havoc Defense', focus: 'pressure rate and takeaway ceiling' }],
  },
  SOCCER: {
    GKP: [{ name: 'Save-Volume Keeper', focus: 'shot-stopping floor' }],
    DEF: [
      { name: 'Crossing Fullback', focus: 'chance creation from wide zones' },
      { name: 'Clean-Sheet Defender', focus: 'defensive floor and set-piece threat' },
    ],
    MID: [
      { name: 'Set-Piece Midfielder', focus: 'corners and key passes' },
      { name: 'Box-to-Box Midfielder', focus: 'peripheral floor plus late runs' },
    ],
    FWD: [
      { name: 'Penalty-Box Forward', focus: 'shot volume in high-pressure areas' },
      { name: 'Transition Striker', focus: 'counterattack ceiling' },
    ],
    UTIL: [{ name: 'Double-Chance Utility', focus: 'multi-category match fit' }],
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCoachSeed(context: CoachContext, sport: string, week: number): number {
  return hashString(
    [
      sport,
      String(context.leagueId ?? ''),
      String(context.leagueName ?? ''),
      String(context.teamName ?? ''),
      String(week),
    ].join('|')
  );
}

function getResolvedWeek(context: CoachContext): number {
  const value = Number(context.week ?? 1);
  if (!Number.isFinite(value)) return 1;
  return clamp(Math.round(value), 1, 38);
}

function getResolvedTeamName(context: CoachContext, preset: SimulationTeamPreset): string {
  const explicitTeamName = String(context.teamName ?? '').trim();
  if (explicitTeamName) return explicitTeamName;

  const explicitLeagueName = String(context.leagueName ?? '').trim();
  if (explicitLeagueName) return `${explicitLeagueName} XI`;

  return `${preset.name} Core`;
}

function buildCoachLineup(
  sport: string,
  preset: SimulationTeamPreset,
  seed: number
) {
  const baseLineup = buildLineupForSimulationPreset(sport, preset);
  const rng = createSeededRandom(seed);

  return baseLineup.map((slot, index) => {
    const indexWeight = index / Math.max(1, baseLineup.length - 1);
    const varianceNudge = (rng() - 0.5) * 2.4;
    const projection = Math.max(0.5, (slot.projection ?? 0.5) + varianceNudge);
    const spreadBase = Math.max(1.6, (slot.ceiling ?? projection) - (slot.floor ?? projection));
    const floorSwing = spreadBase * (0.45 + indexWeight * 0.2 + rng() * 0.08);
    const ceilingSwing = spreadBase * (0.55 + (1 - indexWeight) * 0.18 + rng() * 0.1);

    return {
      ...slot,
      projection: roundToTenth(projection),
      floor: roundToTenth(Math.max(0, projection - floorSwing)),
      ceiling: roundToTenth(projection + ceilingSwing),
      volatility: roundToTenth(clamp((slot.volatility ?? 1) + (rng() - 0.5) * 0.18, 0.7, 1.4)),
    };
  });
}

function buildScheduleFactors(preset: SimulationTeamPreset, seed: number, week: number) {
  const base = getDefaultScheduleFactorsForPreset(preset);
  const rng = createSeededRandom(seed ^ hashString(String(week)));

  return {
    venue: roundToTenth(clamp(base.venue + (rng() - 0.5) * 0.4, -1, 1)),
    rest: roundToTenth(clamp(base.rest + ((week % 3) - 1) * 0.15 + (rng() - 0.5) * 0.2, -1, 1)),
    matchup: roundToTenth(clamp(base.matchup + (rng() - 0.5) * 0.45, -1, 1)),
    tempo: roundToTenth(clamp(base.tempo + ((week % 2 === 0 ? 1 : -1) * 0.1) + (rng() - 0.5) * 0.2, -1, 1)),
  };
}

function buildPeerPreset(presets: SimulationTeamPreset[], index: number, seed: number): SimulationTeamPreset {
  if (presets.length <= 1) return presets[0]!;
  const offset = (seed % (presets.length - 1)) + 1;
  return presets[(index + offset) % presets.length]!;
}

function getReferenceSlot(
  peerSummary: ReturnType<typeof summarizeMatchupTeamInput>,
  slotId: string
) {
  return peerSummary.lineup.find((slot) => slot.slotId === slotId) ?? peerSummary.lineup[0]!;
}

function buildCoachSummary(snapshot: CoachEngineSnapshot): string {
  const favoriteBand = `${snapshot.teamSummary.adjustedFloor.toFixed(1)}-${snapshot.teamSummary.adjustedCeiling.toFixed(1)}`;
  const strongestEdge =
    snapshot.strongestSlot.adjustedProjection -
    getReferenceSlot(snapshot.peerSummary, snapshot.strongestSlot.slotId).adjustedProjection;

  return `${snapshot.teamName} projects for ${snapshot.teamSummary.adjustedMean.toFixed(1)} adjusted points in Week ${snapshot.week}, with a likely band of ${favoriteBand}. ${snapshot.strongestSlot.slotLabel} is the cleanest edge at +${strongestEdge.toFixed(1)} versus a neutral peer baseline, while ${snapshot.weakestSlot.slotLabel} is the pressure point that should drive waiver and trade work.`;
}

function buildRosterStrengths(snapshot: CoachEngineSnapshot): string[] {
  const strongestRef = getReferenceSlot(snapshot.peerSummary, snapshot.strongestSlot.slotId);
  const swingRef = getReferenceSlot(snapshot.peerSummary, snapshot.swingSlot.slotId);
  const floorRatio =
    snapshot.bestFloorSlot.floor / Math.max(1, snapshot.bestFloorSlot.adjustedProjection);

  return [
    `${snapshot.strongestSlot.slotLabel} is pacing the build at ${snapshot.strongestSlot.adjustedProjection.toFixed(1)} adjusted points, ${(
      snapshot.strongestSlot.adjustedProjection - strongestRef.adjustedProjection
    ).toFixed(1)} above the neutral baseline.`,
    `${snapshot.bestFloorSlot.slotLabel} is giving you the steadiest weekly floor with ${Math.round(floorRatio * 100)}% of its projection still intact on the downside band.`,
    `${snapshot.swingSlot.slotLabel} carries the biggest swing lane, so your lineup still has ceiling access up to ${snapshot.swingSlot.ceiling.toFixed(1)} when you need to chase upside.`,
  ];
}

function buildRosterWeaknesses(snapshot: CoachEngineSnapshot): string[] {
  const weakestRef = getReferenceSlot(snapshot.peerSummary, snapshot.weakestSlot.slotId);
  const secondRef = getReferenceSlot(snapshot.peerSummary, snapshot.secondaryWeakestSlot.slotId);

  return [
    `${snapshot.weakestSlot.slotLabel} is the thinnest starter spot right now at ${snapshot.weakestSlot.adjustedProjection.toFixed(1)} adjusted points, trailing baseline by ${Math.abs(
      snapshot.weakestSlot.adjustedProjection - weakestRef.adjustedProjection
    ).toFixed(1)}.`,
    `${snapshot.secondaryWeakestSlot.slotLabel} does not have much insulation either, with only ${snapshot.secondaryWeakestSlot.floor.toFixed(1)} on the low end of its range.`,
    `${snapshot.weakestSlot.scheduleImpact < 0 ? `${snapshot.weakestSlot.slotLabel} is also carrying a ${snapshot.weakestSlot.scheduleImpact.toFixed(1)} schedule drag,` : `${snapshot.secondaryWeakestSlot.slotLabel} is vulnerable to variance,`} which raises the need for a safer fallback this week.`,
  ];
}

function buildLineupImprovements(snapshot: CoachEngineSnapshot): string[] {
  const positiveScheduleSlots = [...snapshot.teamSummary.lineup]
    .filter((slot) => slot.scheduleImpact > 0.4)
    .sort((slotA, slotB) => slotB.scheduleImpact - slotA.scheduleImpact);
  const primaryLift = positiveScheduleSlots[0] ?? snapshot.swingSlot;

  return [
    `Treat ${snapshot.weakestSlot.slotLabel} as a protection spot this week and avoid building your ceiling plan around a range that falls to ${snapshot.weakestSlot.floor.toFixed(1)}.`,
    `Lean into ${primaryLift.slotLabel} in close lineup decisions because the schedule is worth ${primaryLift.scheduleImpact >= 0 ? '+' : ''}${primaryLift.scheduleImpact.toFixed(1)} adjusted points there.`,
    `If you need to swing for upside, route it through ${snapshot.topCeilingSlot.slotLabel}; that slot stretches to ${snapshot.topCeilingSlot.ceiling.toFixed(1)} without collapsing the rest of the build.`,
  ];
}

function getWaiverTemplatesForSlot(sport: string, slotId: string): CoachSlotTemplate[] {
  const sportTemplates = WAIVER_CANDIDATES[sport] ?? WAIVER_CANDIDATES.NFL;
  return sportTemplates[slotId] ?? sportTemplates.UTIL ?? [{ name: `${slotId} Streamer`, focus: 'short-term role growth' }];
}

function buildWaiverOpportunities(snapshot: CoachEngineSnapshot): WaiverOpportunity[] {
  const weakSlots = [snapshot.weakestSlot, snapshot.secondaryWeakestSlot];

  return weakSlots.map((slot, index) => {
    const templates = getWaiverTemplatesForSlot(snapshot.sport, slot.slotId);
    const template = templates[index % templates.length]!;
    const playerName = `${template.name} ${slot.slotLabel}`;

    return {
      playerName,
      position: slot.slotLabel,
      priority: index === 0 ? 'high' : 'medium',
      reason: `${slot.slotLabel} is the softest weekly room on the roster, so add a ${template.focus} profile that can cover a ${slot.floor.toFixed(1)} downside band without forcing a panic trade.`,
      // `playerName` is an ARCHETYPE ("Pocket Tempo QB"), not a person, so there is no player page to
      // open. It linked /player-comparison (a landing page that ignored it); it now opens the waiver
      // tool on that slot, exactly as this coach's own "Open Waiver AI" action does (2026-11-12).
      playerHref: getWaiverToolHref(snapshot.leagueId, {
        sport: snapshot.sport,
        focus: slot.slotLabel,
      }),
    };
  });
}

function buildTradeSuggestions(snapshot: CoachEngineSnapshot): TradeSuggestion[] {
  return [
    {
      summary: `Move surplus confidence from ${snapshot.strongestSlot.slotLabel} into a steadier ${snapshot.weakestSlot.slotLabel} starter before the floor gap becomes a weekly leak.`,
      targetHint: `Target managers who need help at ${snapshot.strongestSlot.slotLabel} and can move a stable ${snapshot.weakestSlot.slotLabel} piece.`,
      priority: 'high',
      tradeAnalyzerHref: getTradeAnalyzerHref(snapshot.leagueId, {
        sport: snapshot.sport,
        teamName: snapshot.teamName,
        surplus: snapshot.strongestSlot.slotLabel,
        need: snapshot.weakestSlot.slotLabel,
      }),
    },
    {
      summary: `Package a volatility piece from ${snapshot.swingSlot.slotLabel} with depth to flatten the downside at ${snapshot.secondaryWeakestSlot.slotLabel}.`,
      targetHint: `Use the analyzer to test 2-for-1 offers that trade ceiling excess for weekly safety.`,
      priority: 'medium',
      tradeAnalyzerHref: getTradeAnalyzerHref(snapshot.leagueId, {
        sport: snapshot.sport,
        teamName: snapshot.teamName,
        surplus: snapshot.swingSlot.slotLabel,
        need: snapshot.secondaryWeakestSlot.slotLabel,
      }),
    },
  ];
}

function buildEvaluationMetrics(snapshot: CoachEngineSnapshot): CoachEvaluationMetric[] {
  const starterFloorScore = clampScore(
    (snapshot.teamSummary.adjustedFloor / Math.max(1, snapshot.teamSummary.adjustedMean)) * 100
  );
  const ceilingAccessScore = clampScore(
    ((snapshot.teamSummary.adjustedCeiling - snapshot.teamSummary.adjustedMean) /
      Math.max(8, snapshot.teamSummary.adjustedMean * 0.22)) *
      100
  );
  const waiverPressure =
    Math.max(
      0,
      getReferenceSlot(snapshot.peerSummary, snapshot.weakestSlot.slotId).adjustedProjection -
        snapshot.weakestSlot.adjustedProjection
    ) * 10;
  const waiverFlexibilityScore = clampScore(
    100 -
      waiverPressure -
      Math.max(0, Math.abs(snapshot.weakestSlot.scheduleImpact) * 12) -
      Math.max(0, Math.abs(snapshot.secondaryWeakestSlot.scheduleImpact) * 6)
  );
  const tradeLeverageScore = clampScore(
    52 +
      Math.max(0, snapshot.strongestSlot.adjustedProjection - getReferenceSlot(snapshot.peerSummary, snapshot.strongestSlot.slotId).adjustedProjection) *
        8 -
      Math.max(0, getReferenceSlot(snapshot.peerSummary, snapshot.weakestSlot.slotId).adjustedProjection - snapshot.weakestSlot.adjustedProjection) *
        4
  );

  return [
    {
      id: 'starter-floor',
      label: 'Starter floor',
      score: starterFloorScore,
      trend: starterFloorScore >= 74 ? 'up' : starterFloorScore >= 58 ? 'steady' : 'down',
      summary: `Your downside band still holds ${starterFloorScore}% of the adjusted projection total.`,
    },
    {
      id: 'ceiling-access',
      label: 'Ceiling access',
      score: ceilingAccessScore,
      trend: ceilingAccessScore >= 68 ? 'up' : ceilingAccessScore >= 52 ? 'steady' : 'down',
      summary: `${snapshot.topCeilingSlot.slotLabel} and ${snapshot.swingSlot.slotLabel} are the main spike-week levers.`,
    },
    {
      id: 'waiver-flexibility',
      label: 'Waiver flexibility',
      score: waiverFlexibilityScore,
      trend: waiverFlexibilityScore >= 68 ? 'up' : waiverFlexibilityScore >= 52 ? 'steady' : 'down',
      summary: `${snapshot.weakestSlot.slotLabel} is the first room to patch if you want a cleaner weekly floor.`,
    },
    {
      id: 'trade-leverage',
      label: 'Trade leverage',
      score: tradeLeverageScore,
      trend: tradeLeverageScore >= 70 ? 'up' : tradeLeverageScore >= 54 ? 'steady' : 'down',
      summary: `${snapshot.strongestSlot.slotLabel} is giving you enough surplus to shop for help elsewhere.`,
    },
  ];
}

function buildFallbackProviderInsights(snapshot: CoachEngineSnapshot): CoachProviderInsights {
  const deepseek = `The roster math points to ${snapshot.teamSummary.adjustedMean.toFixed(1)} adjusted points with a ${snapshot.teamSummary.adjustedFloor.toFixed(1)}-${snapshot.teamSummary.adjustedCeiling.toFixed(1)} band. ${snapshot.strongestSlot.slotLabel} is carrying the strongest efficiency edge, while ${snapshot.weakestSlot.slotLabel} is the only room falling meaningfully below baseline.`;
  const grok = `${snapshot.teamName} looks like a team with one reliable hammer at ${snapshot.strongestSlot.slotLabel} and one clear weekly tension point at ${snapshot.weakestSlot.slotLabel}, which makes this a classic patch-the-floor-before-you-chase-more-ceiling spot.`;
  const openai = `Coach read: keep the lineup anchored around ${snapshot.bestFloorSlot.slotLabel}, make a waiver move that protects ${snapshot.weakestSlot.slotLabel}, and test one trade that turns ${snapshot.strongestSlot.slotLabel} surplus into a steadier starter.`;

  return {
    deepseek,
    grok,
    openai,
  };
}

async function buildSnapshot(context: CoachContext): Promise<CoachEngineSnapshot> {
  const sport = context.sport ? normalizeToSupportedSport(String(context.sport)) : 'NFL';
  const week = getResolvedWeek(context);
  const presets = getSimulationTeamPresets(sport);
  const deterministicSeed = buildCoachSeed(context, sport, week);
  const presetIndex = deterministicSeed % presets.length;
  const teamPreset = presets[presetIndex]!;
  const peerPreset = buildPeerPreset(presets, presetIndex, deterministicSeed >>> 2);
  const teamName = getResolvedTeamName(context, teamPreset);

  const teamSummary = summarizeMatchupTeamInput(
    {
      teamName,
      lineup: buildCoachLineup(sport, teamPreset, deterministicSeed),
      scheduleFactors: buildScheduleFactors(teamPreset, deterministicSeed, week),
    },
    sport
  );
  const peerSummary = summarizeMatchupTeamInput(
    {
      teamName: peerPreset.name,
      lineup: buildCoachLineup(sport, peerPreset, deterministicSeed ^ 0x9e3779b9),
      scheduleFactors: buildScheduleFactors(peerPreset, deterministicSeed ^ 0x85ebca6b, week),
    },
    sport
  );

  const strongestSlot = [...teamSummary.lineup].sort((slotA, slotB) => {
    const edgeA = slotA.adjustedProjection - getReferenceSlot(peerSummary, slotA.slotId).adjustedProjection;
    const edgeB = slotB.adjustedProjection - getReferenceSlot(peerSummary, slotB.slotId).adjustedProjection;
    return edgeB - edgeA;
  })[0]!;
  const weakestSlots = [...teamSummary.lineup].sort((slotA, slotB) => {
    const edgeA = slotA.adjustedProjection - getReferenceSlot(peerSummary, slotA.slotId).adjustedProjection;
    const edgeB = slotB.adjustedProjection - getReferenceSlot(peerSummary, slotB.slotId).adjustedProjection;
    return edgeA - edgeB;
  });
  const swingSlot = [...teamSummary.lineup].sort(
    (slotA, slotB) => Math.abs(slotB.scheduleImpact) - Math.abs(slotA.scheduleImpact)
  )[0]!;
  const bestFloorSlot = [...teamSummary.lineup].sort(
    (slotA, slotB) =>
      slotB.floor / Math.max(1, slotB.adjustedProjection) -
      slotA.floor / Math.max(1, slotA.adjustedProjection)
  )[0]!;
  const topCeilingSlot = [...teamSummary.lineup].sort((slotA, slotB) => slotB.ceiling - slotA.ceiling)[0]!;

  const [lineupStrategy, tradeStrategy, waiverStrategy] = await Promise.all([
    getStrategyRecommendation('lineup', {
      ...context,
      sport,
      teamName,
      week,
    }),
    getStrategyRecommendation('trade', {
      ...context,
      sport,
      teamName,
      week,
    }),
    getStrategyRecommendation('waiver', {
      ...context,
      sport,
      teamName,
      week,
    }),
  ]);

  return {
    sport,
    teamName,
    week,
    leagueId: context.leagueId as string | undefined,
    leagueName: context.leagueName as string | undefined,
    deterministicSeed,
    teamPreset,
    peerPreset,
    teamSummary,
    peerSummary,
    strongestSlot,
    weakestSlot: weakestSlots[0]!,
    secondaryWeakestSlot: weakestSlots[1] ?? weakestSlots[0]!,
    swingSlot,
    bestFloorSlot,
    topCeilingSlot,
    lineupStrategy,
    tradeStrategy,
    waiverStrategy,
  };
}

export async function buildDeterministicCoachEvaluation(
  context: CoachContext = {}
): Promise<CoachEvaluationResult> {
  const snapshot = await buildSnapshot(context);
  const evaluationMetrics = buildEvaluationMetrics(snapshot);
  const lineupImprovements = buildLineupImprovements(snapshot);
  const waiverOpportunities = buildWaiverOpportunities(snapshot);
  const tradeSuggestions = buildTradeSuggestions(snapshot);
  const providerInsights = buildFallbackProviderInsights(snapshot);
  const teamSummary = buildCoachSummary(snapshot);

  const teamSnapshot: CoachTeamSnapshot = {
    presetId: snapshot.teamPreset.id,
    presetName: snapshot.teamPreset.name,
    teamName: snapshot.teamName,
    week: snapshot.week,
    adjustedProjection: snapshot.teamSummary.adjustedMean,
    adjustedFloor: snapshot.teamSummary.adjustedFloor,
    adjustedCeiling: snapshot.teamSummary.adjustedCeiling,
    scheduleAdjustment: snapshot.teamSummary.scheduleAdjustment,
    strongestSlot: snapshot.strongestSlot.slotLabel,
    weakestSlot: snapshot.weakestSlot.slotLabel,
    swingSlot: snapshot.swingSlot.slotLabel,
  };

  const actionRecommendations: ActionRecommendation[] = [
    {
      id: 'waiver',
      type: 'waiver',
      label: 'Open Waiver AI',
      summary: `${snapshot.waiverStrategy.summary} Start with ${waiverOpportunities[0]?.position ?? snapshot.weakestSlot.slotLabel}.`,
      priority: waiverOpportunities[0]?.priority ?? 'high',
      toolHref: getWaiverToolHref(snapshot.leagueId, {
        sport: snapshot.sport,
        teamName: snapshot.teamName,
        week: snapshot.week,
        focus: snapshot.weakestSlot.slotLabel,
      }),
    },
    {
      id: 'trade',
      type: 'trade',
      label: 'Open Trade Analyzer',
      summary: tradeSuggestions[0]?.summary ?? snapshot.tradeStrategy.summary,
      priority: tradeSuggestions[0]?.priority ?? 'medium',
      toolHref: getTradeAnalyzerHref(snapshot.leagueId, {
        sport: snapshot.sport,
        teamName: snapshot.teamName,
        week: snapshot.week,
        surplus: snapshot.strongestSlot.slotLabel,
        need: snapshot.weakestSlot.slotLabel,
      }),
    },
    {
      id: 'lineup',
      type: 'lineup',
      label: 'Review Rankings',
      summary: lineupImprovements[0] ?? snapshot.lineupStrategy.summary,
      priority: 'medium',
      toolHref: getRankingsToolHref(snapshot.leagueId, {
        sport: snapshot.sport,
        teamName: snapshot.teamName,
        week: snapshot.week,
      }),
    },
  ];

  return {
    sport: snapshot.sport,
    rosterStrengths: buildRosterStrengths(snapshot),
    rosterWeaknesses: buildRosterWeaknesses(snapshot),
    waiverOpportunities,
    tradeSuggestions,
    lineupImprovements,
    actionRecommendations,
    evaluationMetrics,
    teamSummary,
    teamSnapshot,
    providerInsights,
    rosterMathSummary: providerInsights.deepseek,
    strategyInsight: providerInsights.grok,
    weeklyAdvice: providerInsights.openai,
    deterministicSeed: snapshot.deterministicSeed,
    lastEvaluatedAt: new Date().toISOString(),
  };
}
