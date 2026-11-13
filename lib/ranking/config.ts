export type Tier = {
  tier: number;
  name: string;
  minLevel: number;
  color: string;
  description: string;
};

export const XP_PER_LEVEL = 500;

export const XP_SOURCES = {
  regularWin: 50,
  playoffAppearance: 200,
  championshipWin: 500,
  leagueParticipation: 25,
  uniqueFormatPlayed: 100,

  streak3: 25,
  streak5: 75,
  streak7plus: 150,
};

export const TIERS: Tier[] = [
  { tier: 1, name: "Practice Squad", minLevel: 0, color: "Gray", description: "New or casual players learning the ropes" },
  { tier: 2, name: "Rookie", minLevel: 30, color: "Green", description: "Shows flashes of skill; understands basic strategy" },
  { tier: 3, name: "Starter", minLevel: 100, color: "Blue", description: "Reliable weekly manager with competitive awareness" },
  { tier: 4, name: "Playmaker", minLevel: 200, color: "Purple", description: "Clutch wins, bold moves, and late-season pushes" },
  { tier: 5, name: "Game Manager", minLevel: 350, color: "Pink", description: "Calm, disciplined, avoids tilt, controls matchups" },
  { tier: 6, name: "Play Caller", minLevel: 400, color: "Amber", description: "Leads the offense with smart, timely decisions" },
  { tier: 7, name: "Coordinator", minLevel: 450, color: "Red", description: "Manages multiple leagues with coordinated strategy" },
  { tier: 8, name: "Strategist", minLevel: 500, color: "Teal", description: "Plans ahead for bye weeks, trades, and playoffs" },
  { tier: 9, name: "Captain", minLevel: 550, color: "Indigo", description: "Leads by example with consistent performance" },
  { tier: 10, name: "Commander", minLevel: 600, color: "Violet", description: "Commands respect in every league they join" },
  { tier: 11, name: "Field General", minLevel: 700, color: "Orange", description: "Reads the entire board across leagues and formats" },
  { tier: 12, name: "Shot Caller", minLevel: 850, color: "Cyan", description: "Confident risk-taker with high strategic accuracy" },
  { tier: 13, name: "Franchise Player", minLevel: 1100, color: "Lime", description: "Consistent playoff performer across seasons" },
  { tier: 14, name: "Problem", minLevel: 1500, color: "Red", description: "A matchup no one wants; excels in specialty formats" },
  { tier: 15, name: "Nightmare", minLevel: 2000, color: "Violet", description: "Dominates even in down years; feared competitor" },
  { tier: 16, name: "Menace", minLevel: 2700, color: "Fuchsia", description: "Drafts and trades in ways that shift entire leagues" },
  { tier: 17, name: "Meta Breaker", minLevel: 3600, color: "Cyan", description: "Finds edges before the meta realizes them" },
  { tier: 18, name: "Warlord", minLevel: 5000, color: "Bronze", description: "Multi-sport force across formats" },
  { tier: 19, name: "Icon", minLevel: 7500, color: "Indigo", description: "Proven champion with long-term elite performance" },
  { tier: 20, name: "AllFantasy Legend", minLevel: 12000, color: "Gold", description: "Top 0.1%; crest badge + Hall of Fame listing" },
];

