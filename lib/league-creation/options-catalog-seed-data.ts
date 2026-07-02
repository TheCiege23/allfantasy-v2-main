import type { SupportedSport } from '@/lib/create-league-v2/state'

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

const SURVIVOR_ALLOWED_SPORTS: SupportedSport[] = ['NFL', 'NCAAF']

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
      introVideoUrl: '/media/league-intros/redraft-league-intro.mp4',
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
      title: 'Guillotine',
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
    {
      id: 'tournament',
      title: 'Tournament',
      subtitle: 'Multi-league elimination event',
      introVideoUrl: '/league-type-tournament-intro.mp4',
      introPosterUrl: '/league-type-tournament.png',
    },
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
    guillotine: ['NFL', 'NCAAF', 'NBA', 'NHL', 'MLB'],
    zombie: ['NFL', 'NBA', 'MLB', 'NHL'],
    survivor: SURVIVOR_ALLOWED_SPORTS,
    tournament: ALL_SPORTS,
    big_brother: ALL_SPORTS,
  },
  allowedDraftTypesByConcept: {
    redraft: ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto'],
    dynasty: ['snake', 'linear', 'auction', 'offline', 'auto'],
    keeper: ['snake', 'linear', 'auction', 'slow_draft', 'mock_draft', 'offline', 'auto', 'team'],
    best_ball: ['snake', 'linear', 'auction', 'offline', 'auto'],
    idp: ['snake', 'linear', 'auction', 'offline', 'auto'],
    salary_cap: ['auction', 'snake', 'offline', 'auto'],
    devy: ['snake', 'linear', 'auction', 'offline', 'auto'],
    c2c: ['snake', 'linear', 'auction', 'offline', 'auto'],
    guillotine: ['snake', 'linear', 'auction', 'offline', 'auto'],
    zombie: ['snake', 'linear', 'auction', 'offline', 'auto'],
    survivor: ['snake', 'linear', 'auction', 'real_time', 'by_team', 'offline', 'auto'],
    tournament: ['snake', 'linear', 'auction', 'offline', 'auto'],
    big_brother: ['snake', 'linear', 'offline', 'auto'],
  },
  allowedScoringPresetsByConceptSport: {
    redraft: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard'],
      NBA: ['nba_points', 'nba_categories'],
      MLB: ['mlb_roto_5x5', 'mlb_points'],
      NHL: ['nhl_points', 'nhl_category'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr', 'ncaaf_standard'],
      NCAAB: ['ncaab_points', 'ncaab_categories'],
      SOCCER: ['soccer_classic', 'soccer_draft'],
    },
    dynasty: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_superflex'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soccer_classic'],
    },
    keeper: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard'],
      NBA: ['nba_points'],
      MLB: ['mlb_roto_5x5', 'mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr', 'ncaaf_standard'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soccer_classic'],
    },
    best_ball: {
      NFL: ['fb_half_ppr', 'fb_ppr'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soccer_draft'],
    },
    idp: {
      NFL: ['idp_balanced', 'idp_heavy'],
      NCAAF: ['idp_balanced'],
    },
    salary_cap: {
      NFL: ['fb_half_ppr', 'fb_ppr'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soccer_draft'],
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
      NFL: ['fb_half_ppr', 'fb_ppr'],
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
      NFL: ['fb_half_ppr', 'fb_ppr'],
      NCAAF: ['ncaaf_half_ppr'],
    },
    tournament: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soccer_classic'],
    },
    big_brother: {
      NFL: ['fb_half_ppr'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soccer_classic'],
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
      NFL: [8, 10, 12, 14, 16],
      NBA: [8, 10, 12, 14, 16],
      MLB: [8, 10, 12, 14, 16],
      NHL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
      NCAAB: [8, 10, 12, 14, 16],
      SOCCER: [8, 10, 12, 14, 16],
    },
    keeper: {
      NFL: [8, 10, 12, 14, 16],
      NBA: [8, 10, 12, 14, 16],
      MLB: [8, 10, 12, 14, 16],
      NHL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
      NCAAB: [8, 10, 12, 14, 16],
      SOCCER: [8, 10, 12, 14, 16],
    },
    best_ball: {
      NFL: [8, 10, 12, 14, 16],
      NBA: [8, 10, 12, 14, 16],
      MLB: [8, 10, 12, 14, 16],
      NHL: [8, 10, 12, 14, 16],
      NCAAF: [8, 10, 12, 14, 16],
      NCAAB: [8, 10, 12, 14, 16],
      SOCCER: [8, 10, 12, 14, 16],
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
    guillotine: {
      NFL: [8, 10, 12, 14, 16, 18],
      NCAAF: [8, 10, 12, 14, 16, 18],
      NBA: [8, 10, 12, 14, 16, 18],
      NHL: [8, 10, 12, 14, 16, 18],
      MLB: [8, 10, 12, 14, 16, 18],
    },
    zombie: {
      NFL: [8, 10, 12, 14],
      NBA: [8, 10, 12, 14],
      MLB: [8, 10, 12, 14],
      NHL: [8, 10, 12, 14],
    },
    survivor: {
      NFL: [16, 17, 18, 19, 20],
      NCAAF: [16, 17, 18, 19, 20],
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
