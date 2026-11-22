type Side = "HOME" | "AWAY";

type BracketNodeSeedSpec = {
  slot: string;
  round: number;
  region: string | null;
  seedHome?: number | null;
  seedAway?: number | null;
  nextSlot?: string | null;
  nextSide?: Side | null;
};

type FirstFourMapping = {
  ff16A: { nextSlot: string; nextSide: Side };
  ff16B: { nextSlot: string; nextSide: Side };
  ff11A: { nextSlot: string; nextSide: Side };
  ff11B: { nextSlot: string; nextSide: Side };
};

type FinalFourMapping = {
  semi1: { regionA: RegionKey; regionB: RegionKey };
  semi2: { regionA: RegionKey; regionB: RegionKey };
};

type RegionKey = "E" | "W" | "S" | "M";
type RegionName = "East" | "West" | "South" | "Midwest";

const REGION_NAME: Record<RegionKey, RegionName> = {
  E: "East",
  W: "West",
  S: "South",
  M: "Midwest",
};

const R64_MATCHUPS: Array<[number, number]> = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

function r64Slot(region: RegionKey, n: number) {
  return `${region}-R64-${n}`;
}
function r32Slot(region: RegionKey, n: number) {
  return `${region}-R32-${n}`;
}
function s16Slot(region: RegionKey, n: number) {
  return `${region}-S16-${n}`;
}
function e8Slot(region: RegionKey) {
  return `${region}-E8-1`;
}

function defaultFirstFourMapping(): FirstFourMapping {
  return {
    ff16A: { nextSlot: "E-R64-1", nextSide: "AWAY" },
    ff16B: { nextSlot: "W-R64-1", nextSide: "AWAY" },
    ff11A: { nextSlot: "S-R64-5", nextSide: "AWAY" },
    ff11B: { nextSlot: "M-R64-5", nextSide: "AWAY" },
  };
}

function defaultFinalFourMapping(): FinalFourMapping {
  return {
    semi1: { regionA: "E", regionB: "W" },
    semi2: { regionA: "S", regionB: "M" },
  };
}

export function generateNcaamBracketStructure(params: {
  season: number;
  firstFour?: FirstFourMapping;
  finalFour?: FinalFourMapping;
}): { name: string; sport: string; season: number; nodes: BracketNodeSeedSpec[] } {
  const firstFour = params.firstFour ?? defaultFirstFourMapping();
  const finalFour = params.finalFour ?? defaultFinalFourMapping();

  const nodes: BracketNodeSeedSpec[] = [];

  nodes.push(
    {
      slot: "FF-16-A",
      round: 0,
      region: null,
      seedHome: 16,
      seedAway: 16,
      nextSlot: firstFour.ff16A.nextSlot,
      nextSide: firstFour.ff16A.nextSide,
    },
    {
      slot: "FF-16-B",
      round: 0,
      region: null,
      seedHome: 16,
      seedAway: 16,
      nextSlot: firstFour.ff16B.nextSlot,
      nextSide: firstFour.ff16B.nextSide,
    },
    {
      slot: "FF-11-A",
      round: 0,
      region: null,
      seedHome: 11,
      seedAway: 11,
      nextSlot: firstFour.ff11A.nextSlot,
      nextSide: firstFour.ff11A.nextSide,
    },
    {
      slot: "FF-11-B",
      round: 0,
      region: null,
      seedHome: 11,
      seedAway: 11,
      nextSlot: firstFour.ff11B.nextSlot,
      nextSide: firstFour.ff11B.nextSide,
    }
  );

  const regions: RegionKey[] = ["E", "W", "S", "M"];

  for (const r of regions) {
    const regionName = REGION_NAME[r];

    for (let i = 0; i < 8; i++) {
      const gameNum = i + 1;
      const [seedHome, seedAway] = R64_MATCHUPS[i];
      const slot = r64Slot(r, gameNum);
      const r32Index = Math.floor(i / 2) + 1;
      const nextSlot = r32Slot(r, r32Index);
      const nextSide: Side = i % 2 === 0 ? "HOME" : "AWAY";

      nodes.push({
        slot,
        round: 1,
        region: regionName,
        seedHome,
        seedAway,
        nextSlot,
        nextSide,
      });
    }

    for (let i = 0; i < 4; i++) {
      const gameNum = i + 1;
      const slot = r32Slot(r, gameNum);
      const s16Index = i < 2 ? 1 : 2;
      const nextSlot = s16Slot(r, s16Index);
      const nextSide: Side = i % 2 === 0 ? "HOME" : "AWAY";

      nodes.push({
        slot,
        round: 2,
        region: regionName,
        seedHome: null,
        seedAway: null,
        nextSlot,
        nextSide,
      });
    }

    for (let i = 0; i < 2; i++) {
      const gameNum = i + 1;
      const slot = s16Slot(r, gameNum);
      const nextSlot = e8Slot(r);
      const nextSide: Side = i === 0 ? "HOME" : "AWAY";

      nodes.push({
        slot,
        round: 3,
        region: regionName,
        seedHome: null,
        seedAway: null,
        nextSlot,
        nextSide,
      });
    }

    const e8 = e8Slot(r);
    const feedsSemi1 = r === finalFour.semi1.regionA || r === finalFour.semi1.regionB;
    const semifinalSlot = feedsSemi1 ? "FF-1" : "FF-2";
    const isRegionA =
      (feedsSemi1 && r === finalFour.semi1.regionA) || (!feedsSemi1 && r === finalFour.semi2.regionA);
    const nextSide: Side = isRegionA ? "HOME" : "AWAY";

    nodes.push({
      slot: e8,
      round: 4,
      region: regionName,
      seedHome: null,
      seedAway: null,
      nextSlot: semifinalSlot,
      nextSide,
    });
  }

  nodes.push(
    {
      slot: "FF-1",
      round: 5,
      region: null,
      seedHome: null,
      seedAway: null,
      nextSlot: "CHAMP",
      nextSide: "HOME",
    },
    {
      slot: "FF-2",
      round: 5,
      region: null,
      seedHome: null,
      seedAway: null,
      nextSlot: "CHAMP",
      nextSide: "AWAY",
    }
  );

  nodes.push({
    slot: "CHAMP",
    round: 6,
    region: null,
    seedHome: null,
    seedAway: null,
    nextSlot: null,
    nextSide: null,
  });

  return {
    name: "NCAA Men's Tournament",
    sport: "ncaam",
    season: params.season,
    nodes,
  };
}
