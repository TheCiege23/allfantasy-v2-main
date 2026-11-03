import type { PrismaClient } from '@prisma/client'

const TEMPLATES = [
  {
    sport: 'NFL',
    rosterSize: 15,
    starterCount: 9,
    benchCount: 6,
    irSlotsDefault: 0,
    lineupFrequency: 'weekly',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'Games span Thursday through Monday night. Lineups lock at each player\'s kickoff.',
    bashingThreshold: 60,
    maulingThreshold: 60,
    weaponShieldThreshold: 110,
    weaponAmbushThreshold: 140,
    serumAwardCondition: 'survivor_wins_by_30_or_more',
    serumAwardDesc: 'A Survivor earns an Antidote Serum when they win their matchup by 30+ points.',
    edgeCaseNotes:
      'Bye weeks significantly reduce roster scoring. Whisperer ambushes must be declared before TNF kickoff. Stat corrections from official NFL stats can trigger re-resolution — system waits 48 hours post-Monday before finalizing.',
    positionList: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K'],
    lineupLockDesc:
      'Each player locks at the kickoff of their individual NFL game. Thursday night players lock Thursday, Sunday players lock Sunday, Monday night players lock Monday.',
  },
  {
    sport: 'NBA',
    rosterSize: 13,
    starterCount: 5,
    benchCount: 8,
    irSlotsDefault: 1,
    lineupFrequency: 'daily',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'Games run daily across the week. Weekly score is cumulative from all games Monday through Sunday.',
    bashingThreshold: 80,
    maulingThreshold: 130,
    weaponShieldThreshold: 250,
    weaponAmbushThreshold: 320,
    serumAwardCondition: 'survivor_wins_with_3_or_more_players_in_top_20_pts',
    serumAwardDesc:
      'A Survivor earns an Antidote Serum when 3+ of their players finish in the top 20 scorers for the week.',
    edgeCaseNotes:
      'Load management and back-to-back rest days can cause star players to score 0. This is a core risk of NBA Zombie Mode — roster depth is critical. Lineup locks happen game-by-game daily.',
    positionList: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
    lineupLockDesc:
      'Each player locks at their individual game\'s tip-off. Daily lineup management is required.',
  },
  {
    sport: 'MLB',
    rosterSize: 25,
    starterCount: 14,
    benchCount: 11,
    irSlotsDefault: 2,
    lineupFrequency: 'daily',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'Games run daily. Weekly score accumulates Monday through Sunday. Pitchers can appear multiple times across the week.',
    bashingThreshold: 40,
    maulingThreshold: 75,
    weaponShieldThreshold: 200,
    weaponAmbushThreshold: 260,
    serumAwardCondition: 'survivor_pitcher_earns_two_wins_in_week',
    serumAwardDesc: 'A Survivor earns a Serum when one of their starting pitchers earns 2+ wins in a single week.',
    edgeCaseNotes:
      'Rain outs / postponements mean a game\'s stats count for the makeup date. Pitching streaming is common — roster moves daily are expected.',
    positionList: ['C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL', 'SP', 'RP'],
    lineupLockDesc:
      'Each player locks at first pitch of their game. Daily lineup adjustments are expected.',
  },
  {
    sport: 'NHL',
    rosterSize: 16,
    starterCount: 9,
    benchCount: 7,
    irSlotsDefault: 1,
    lineupFrequency: 'daily',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'Games run daily. Weekly score accumulates Monday through Sunday. Goalie starts matter significantly.',
    bashingThreshold: 35,
    maulingThreshold: 60,
    weaponShieldThreshold: 160,
    weaponAmbushThreshold: 200,
    serumAwardCondition: 'survivor_goalie_earns_two_wins_with_save_pct_above_920',
    serumAwardDesc:
      'A Survivor earns a Serum when their goalie wins 2+ games in a week while maintaining .920+ save percentage.',
    edgeCaseNotes:
      'Goalie starts are volatile — an unannounced starter change can devastate a week. Back-to-back pairs typically use a backup goalie for one game.',
    positionList: ['C', 'LW', 'RW', 'D', 'G', 'UTIL'],
    lineupLockDesc:
      'Each player locks at puck drop of their game. Goalie starts are announced morning-of — managers should check daily.',
  },
  {
    sport: 'NCAAF',
    rosterSize: 15,
    starterCount: 8,
    benchCount: 7,
    irSlotsDefault: 0,
    lineupFrequency: 'weekly',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'College football games run primarily on Saturdays. Most scores are finalized by Saturday night.',
    bashingThreshold: 35,
    maulingThreshold: 60,
    weaponShieldThreshold: 120,
    weaponAmbushThreshold: 160,
    serumAwardCondition: 'survivor_scores_160_or_more_points',
    serumAwardDesc: 'A Survivor earns a Serum when they score 160+ points in a single week.',
    edgeCaseNotes:
      'Player usage is far less predictable than NFL. Depth charts change weekly. Bye weeks are common mid-season.',
    positionList: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K'],
    lineupLockDesc:
      'Players lock at kickoff of their Saturday game. Early-week games lock earlier — commissioner should communicate deadlines.',
  },
  {
    sport: 'NCAAB',
    rosterSize: 10,
    starterCount: 5,
    benchCount: 5,
    irSlotsDefault: 0,
    lineupFrequency: 'daily',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'Games run multiple nights per week, especially Tuesday/Thursday/Saturday/Sunday. Weekly score is cumulative.',
    bashingThreshold: 50,
    maulingThreshold: 90,
    weaponShieldThreshold: 170,
    weaponAmbushThreshold: 220,
    serumAwardCondition: 'survivor_wins_with_all_5_starters_scoring_above_15_pts',
    serumAwardDesc:
      'A Survivor earns a Serum when all 5 of their starters score 15+ fantasy points in the same week.',
    edgeCaseNotes:
      'College basketball stats are less available in real-time than NBA. Tournament weeks require special handling.',
    positionList: ['PG', 'SG', 'SF', 'PF', 'C', 'UTIL'],
    lineupLockDesc:
      'Players lock at tip-off of their individual game. Daily management recommended during busy game weeks.',
  },
  {
    sport: 'SOCCER',
    rosterSize: 15,
    starterCount: 11,
    benchCount: 4,
    irSlotsDefault: 0,
    lineupFrequency: 'per_match',
    scoringPeriod: 'weekly',
    scoringWindowDesc:
      'Matches typically occur across Saturday and Sunday with occasional midweek fixtures. Weekly score totals all matches in that gameweek.',
    bashingThreshold: 15,
    maulingThreshold: 25,
    weaponShieldThreshold: 55,
    weaponAmbushThreshold: 70,
    serumAwardCondition: 'survivor_goalkeeper_keeps_clean_sheet_and_defender_scores',
    serumAwardDesc:
      'A Survivor earns a Serum when their goalkeeper keeps a clean sheet AND one of their defenders scores a goal in the same gameweek.',
    edgeCaseNotes:
      'Formation validity is critical. Double gameweeks inflate scores; blank gameweeks deflate them. Red cards remove a player for the rest of the match.',
    positionList: ['GK', 'DEF', 'MID', 'FWD'],
    lineupLockDesc:
      'Lineup locks at kickoff of the FIRST match in the gameweek.',
  },
] as const

export async function seedZombieRulesTemplates(prisma: PrismaClient): Promise<void> {
  for (const t of TEMPLATES) {
    await prisma.zombieRulesTemplate.upsert({
      where: { sport: t.sport },
      create: {
        sport: t.sport,
        rosterSize: t.rosterSize,
        starterCount: t.starterCount,
        benchCount: t.benchCount,
        irSlotsDefault: t.irSlotsDefault,
        lineupFrequency: t.lineupFrequency,
        scoringPeriod: t.scoringPeriod,
        scoringWindowDesc: t.scoringWindowDesc,
        bashingThreshold: t.bashingThreshold,
        maulingThreshold: t.maulingThreshold,
        weaponShieldThreshold: t.weaponShieldThreshold,
        weaponAmbushThreshold: t.weaponAmbushThreshold,
        serumAwardCondition: t.serumAwardCondition,
        serumAwardDesc: t.serumAwardDesc,
        edgeCaseNotes: t.edgeCaseNotes,
        positionList: [...t.positionList],
        lineupLockDesc: t.lineupLockDesc,
      },
      update: {
        rosterSize: t.rosterSize,
        starterCount: t.starterCount,
        benchCount: t.benchCount,
        irSlotsDefault: t.irSlotsDefault,
        lineupFrequency: t.lineupFrequency,
        scoringPeriod: t.scoringPeriod,
        scoringWindowDesc: t.scoringWindowDesc,
        bashingThreshold: t.bashingThreshold,
        maulingThreshold: t.maulingThreshold,
        weaponShieldThreshold: t.weaponShieldThreshold,
        weaponAmbushThreshold: t.weaponAmbushThreshold,
        serumAwardCondition: t.serumAwardCondition,
        serumAwardDesc: t.serumAwardDesc,
        edgeCaseNotes: t.edgeCaseNotes,
        positionList: [...t.positionList],
        lineupLockDesc: t.lineupLockDesc,
      },
    })
  }
}
