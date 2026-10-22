import type { SupportedSport } from '@/lib/create-league-v2/state'
import { SURVIVOR_CREATE_CAST_SIZES } from '@/lib/league-creation-wizard/sport-team-limits'
import { guillotineTeamCountOptions } from '@/lib/guillotine/teamCountLimits'
import { SURVIVOR_CREATION_SPORTS } from '@/lib/survivor/survivorCreationAvailability'

export type CreateMode = 'quick' | 'advanced'

export interface LeagueCreateConceptSeed {
  id: string
  title: string
  subtitle: string
  introVideoUrl: string
  introPosterUrl: string
}

export interface LeagueCreateOptionsCatalog {
  version: number
  defaultTimezone: string
  supportedModes: CreateMode[]
  concepts: LeagueCreateConceptSeed[]
  sports: SupportedSport[]
  allowedSportsByConcept: Record<string, SupportedSport[]>
  allowedDraftTypesByConcept: Record<string, string[]>
  allowedScoringPresetsByConceptSport: Record<string, Partial<Record<SupportedSport, string[]>>>
  teamCountOptionsByConceptSport: Record<string, Partial<Record<SupportedSport, number[]>>>
}

const ALL_SPORTS: SupportedSport[] = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']

const SURVIVOR_ALLOWED_SPORTS: SupportedSport[] = [...SURVIVOR_CREATION_SPORTS]

const UNIVERSAL_CREATE_TEAM_COUNTS = Array.from({ length: 31 }, (_, index) => index + 2)

export const LEAGUE_CREATE_OPTIONS_CATALOG_V1: LeagueCreateOptionsCatalog = {
  version: 1,
  defaultTimezone: 'America/New_York',
  supportedModes: ['quick', 'advanced'],
  concepts: [
    {
      id: 'redraft',
      title: 'Redraft',
      subtitle: 'Fresh draft every season',
      introVideoUrl: '/media/create-league/concept/videos/Redraft.mp4',
      introPosterUrl: '/images/league-types/redraft.png',
    },
    {
      id: 'dynasty',
      title: 'Dynasty',
      subtitle: 'Keep your core forever',
      introVideoUrl: '/league-type-dynasty-intro.mp4',
      introPosterUrl: '/league-type-dynasty.png',
    },
    {
      id: 'keeper',
      title: 'Keeper',
      subtitle: 'Hold a few, draft the rest',
      introVideoUrl: '/league-type-keeper-intro.mp4',
      introPosterUrl: '/league-type-keeper.png',
    },
    {
      id: 'best_ball',
      title: 'Best Ball',
      subtitle: 'Set and forget',
      introVideoUrl: '/league-type-best-ball-intro.mp4',
      introPosterUrl: '/league-type-best-ball.png',
    },
    {
      id: 'idp',
      title: 'IDP',
      subtitle: 'Individual defensive players',
      introVideoUrl: '/league-type-idp-intro.mp4',
      introPosterUrl: '/league-type-idp.png',
    },
    {
      id: 'salary_cap',
      title: 'Salary Cap',
      subtitle: 'Budget-based rosters',
      introVideoUrl: '/league-type-salary-cap-intro.mp4',
      introPosterUrl: '/league-type-salary-cap.png',
    },
    {
      id: 'devy',
      title: 'Devy',
      subtitle: 'Draft college prospects',
      introVideoUrl: '/league-type-devy-intro.mp4',
      introPosterUrl: '/league-type-devy.png',
    },
    {
      id: 'c2c',
      title: 'C2C',
      subtitle: 'College to pros',
      introVideoUrl: '/league-type-c2c-intro.mp4',
      introPosterUrl: '/league-type-c2c.png',
    },
    {
      id: 'guillotine',
      title: 'Guilly',
      subtitle: 'Lowest score is eliminated',
      introVideoUrl: '/league-type-guillotine-intro.mp4',
      introPosterUrl: '/league-type-guillotine.png',
    },
    {
      id: 'zombie',
      title: 'Zombie',
      subtitle: 'Infection-style survival',
      introVideoUrl: '/league-type-zombie-intro.mp4',
      introPosterUrl: '/league-type-zombie.png',
    },
    {
      id: 'survivor',
      title: 'Survivor',
      subtitle: 'Vote players off',
      introVideoUrl: '/league-type-survivor-intro.mp4',
      introPosterUrl: '/league-type-survivor.png',
    },
    // Tournament Mode retired from active creation (2026-07-23). Removing the
    // catalog entry takes it out of every creation selector; the server also
    // refuses the concept (lib/league-creation/retiredConcepts.ts). Existing
    // tournaments keep working — this list only drives NEW league creation.
    {
      id: 'big_brother',
      title: 'Big Brother',
      subtitle: 'Weekly nominations',
      introVideoUrl: '/league-type-big-brother-intro.mp4',
      introPosterUrl: '/league-type-big-brother.png',
    },
  ],
  sports: ALL_SPORTS,
  allowedSportsByConcept: {
    redraft: ALL_SPORTS,
    dynasty: ALL_SPORTS,
    keeper: ALL_SPORTS,
    best_ball: ALL_SPORTS,
    idp: ['NFL', 'NCAAF'],
    salary_cap: ALL_SPORTS,
    devy: ['NFL', 'NCAAF'],
    c2c: ['NFL', 'NCAAF', 'NCAAB'],
    /*
     * Only sports whose weekly finalizer can run. A guillotine league needs a completed week
     * before it can eliminate a roster. This list controls both the wizard and create API.
     */
    guillotine: ['NFL', 'NBA', 'NHL', 'MLB'],
    zombie: ['NFL', 'NBA', 'MLB', 'NHL'],
    survivor: SURVIVOR_ALLOWED_SPORTS,
    tournament: ALL_SPORTS,
    big_brother: ALL_SPORTS,
  },
  allowedDraftTypesByConcept: {
    // A slow Redraft is a snake draft with a longer pick clock, not a create API draft type.
    redraft: ['snake', 'linear', 'auction', 'mock_draft', 'offline', 'auto'],
    dynasty: ['snake', 'linear', 'auction', 'offline', 'auto'],
    keeper: ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team'],
    best_ball: ['snake', 'linear', 'auction', 'offline', 'auto'],
    idp: ['snake', 'linear', 'auction', 'offline', 'auto'],
    salary_cap: ['auction'],
    devy: ['snake', 'linear', 'auction', 'offline', 'auto'],
    c2c: ['snake', 'linear', 'auction', 'offline', 'auto'],
    guillotine: ['snake', 'linear', 'auction', 'offline', 'auto'],
    zombie: ['snake', 'offline', 'auto'],
    survivor: ['snake', 'linear', 'auction', 'offline', 'auto'],
    tournament: ['snake', 'linear', 'auction', 'offline', 'auto'],
    big_brother: ['snake', 'offline', 'auto'],
  },
  // NFL: every concept offering Full PPR also offers ESPN default, Sleeper default and Classic.
  allowedScoringPresetsByConceptSport: {
    redraft: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard', 'fb_espn_ppr', 'fb_sleeper_ppr'],
      NBA: ['nba_points', 'nba_8cat', 'nba_9cat', 'nba_9cat_roto'],
      MLB: ['mlb_points', 'mlb_5x5_each', 'mlb_5x5_most', 'mlb_5x5_roto', 'mlb_6x6_each', 'mlb_6x6_most', 'mlb_6x6_roto'],
      NHL: ['nhl_points', 'nhl_cats_each', 'nhl_cats_most', 'nhl_cats_roto'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr', 'ncaaf_standard'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    dynasty: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_superflex', 'fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard'],
      NBA: ['nba_points', 'nba_8cat', 'nba_9cat', 'nba_9cat_roto'],
      MLB: ['mlb_points', 'mlb_5x5_each', 'mlb_5x5_most', 'mlb_5x5_roto', 'mlb_6x6_each', 'mlb_6x6_most', 'mlb_6x6_roto'],
      NHL: ['nhl_points', 'nhl_cats_each', 'nhl_cats_most', 'nhl_cats_roto'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    keeper: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard', 'fb_espn_ppr', 'fb_sleeper_ppr'],
      NBA: ['nba_points', 'nba_8cat', 'nba_9cat', 'nba_9cat_roto'],
      MLB: ['mlb_points', 'mlb_5x5_each', 'mlb_5x5_most', 'mlb_5x5_roto', 'mlb_6x6_each', 'mlb_6x6_most', 'mlb_6x6_roto'],
      NHL: ['nhl_points', 'nhl_cats_each', 'nhl_cats_most', 'nhl_cats_roto'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr', 'ncaaf_standard'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    best_ball: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    idp: {
      NFL: ['idp_balanced'],
      NCAAF: ['idp_balanced'],
    },
    salary_cap: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    devy: {
      NFL: ['fb_half_ppr', 'fb_superflex'],
      NCAAF: ['ncaaf_half_ppr'],
    },
    c2c: {
      NFL: ['fb_half_ppr', 'fb_superflex'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
    },
    guillotine: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard'],
      NCAAF: ['ncaaf_half_ppr'],
      NBA: ['nba_points'],
      NHL: ['nhl_points'],
      MLB: ['mlb_points'],
    },
    zombie: {
      NFL: ['fb_half_ppr'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
    },
    survivor: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_espn_ppr', 'fb_sleeper_ppr', 'fb_standard'],
      NCAAF: ['ncaaf_half_ppr'],
      NBA: ['nba_points'],
      NHL: ['nhl_points'],
    },
    tournament: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard', 'fb_espn_ppr', 'fb_sleeper_ppr'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    big_brother: {
      NFL: ['fb_half_ppr'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
  },
  teamCountOptionsByConceptSport: {
    redraft: {
      NFL: UNIVERSAL_CREATE_TEAM_COUNTS,
      NBA: UNIVERSAL_CREATE_TEAM_COUNTS,
      MLB: UNIVERSAL_CREATE_TEAM_COUNTS,
      NHL: UNIVERSAL_CREATE_TEAM_COUNTS,
      NCAAF: UNIVERSAL_CREATE_TEAM_COUNTS,
      NCAAB: UNIVERSAL_CREATE_TEAM_COUNTS,
      SOCCER: UNIVERSAL_CREATE_TEAM_COUNTS,
    },
    dynasty: {
      NFL: [4, 6, 8, 10, 12, 14, 16],
      NBA: [4, 6, 8, 10, 12, 14, 16],
      MLB: [4, 6, 8, 10, 12, 14, 16],
      NHL: [4, 6, 8, 10, 12, 14, 16],
      NCAAF: [4, 6, 8, 10, 12, 14, 16],
      NCAAB: [4, 6, 8, 10, 12, 14, 16],
      SOCCER: [4, 6, 8, 10, 12, 14, 16],
    },
    keeper: {
      NFL: [4, 6, 8, 10, 12, 14, 16],
      NBA: [4, 6, 8, 10, 12, 14, 16],
      MLB: [4, 6, 8, 10, 12, 14, 16],
      NHL: [4, 6, 8, 10, 12, 14, 16],
      NCAAF: [4, 6, 8, 10, 12, 14, 16],
      NCAAB: [4, 6, 8, 10, 12, 14, 16],
      SOCCER: [4, 6, 8, 10, 12, 14, 16],
    },
    best_ball: {
      NFL: [4, 6, 8, 10, 12, 14, 16],
      NBA: [4, 6, 8, 10, 12, 14, 16],
      MLB: [4, 6, 8, 10, 12, 14, 16],
      NHL: [4, 6, 8, 10, 12, 14, 16],
      NCAAF: [4, 6, 8, 10, 12, 14, 16],
      NCAAB: [4, 6, 8, 10, 12, 14, 16],
      SOCCER: [4, 6, 8, 10, 12, 14, 16],
    },
    idp: {
      NFL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
    },
    salary_cap: {
      NFL: [8, 10, 12, 14, 16],
      NBA: [8, 10, 12, 14, 16],
      MLB: [8, 10, 12, 14, 16],
      NHL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
      NCAAB: [8, 10, 12, 14, 16],
      SOCCER: [8, 10, 12, 14, 16],
    },
    devy: {
      NFL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
    },
    c2c: {
      NFL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
      NCAAB: [8, 10, 12, 14, 16],
    },
    // Guilly: 4–27 teams single elimination, up to 35 with double-elimination weeks — the
    // same for every sport (lib/guillotine/teamCountLimits.ts). A commissioner on a short
    // schedule adds double-chop weeks in league settings to finish a large league in time.
    guillotine: Object.fromEntries(ALL_SPORTS.map((sport) => [sport, guillotineTeamCountOptions()])),
    zombie: {
      NFL: [8, 10, 12, 14],
      NBA: [8, 10, 12, 14],
      MLB: [8, 10, 12, 14],
      NHL: [8, 10, 12, 14],
    },
    // `SURVIVOR_CAST_SIZE_OPTIONS` is what `POST /api/league/create` clamps a submitted cast
    // size to, so anything this catalog offers that is not in that list gets silently rewritten
    // on save. New leagues are offered the 16 / 20 subset of it; read it rather than restating it.
    survivor: {
      NFL: [...SURVIVOR_CREATE_CAST_SIZES],
      NCAAF: [...SURVIVOR_CREATE_CAST_SIZES],
      NBA: [...SURVIVOR_CREATE_CAST_SIZES],
      NHL: [...SURVIVOR_CREATE_CAST_SIZES],
    },
    tournament: {
      NFL: [32, 64, 96, 128, 160, 192, 224],
      NBA: [32, 64, 96, 128, 160, 192, 224],
      MLB: [32, 64, 96, 128, 160, 192, 224],
      NHL: [32, 64, 96, 128, 160, 192, 224],
      NCAAF: [32, 64, 96, 128, 160, 192, 224],
      NCAAB: [32, 64, 96, 128, 160, 192, 224],
      SOCCER: [32, 64, 96, 128, 160, 192, 224],
    },
    big_brother: {
      NFL: [12, 14, 16, 18],
      NBA: [12, 14, 16, 18],
      MLB: [12, 14, 16, 18],
      NHL: [12, 14, 16, 18],
      NCAAF: [12, 14, 16, 18],
      NCAAB: [12, 14, 16, 18],
      SOCCER: [12, 14, 16, 18],
    },
  },
}
