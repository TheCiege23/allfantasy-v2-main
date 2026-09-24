import type { SupportedSport } from '@/lib/create-league-v2/state'
import { SURVIVOR_CAST_SIZE_OPTIONS } from '@/lib/league-creation-wizard/sport-team-limits'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'

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

function guillotineTeamCounts(sport: SupportedSport): number[] {
  const profile = getGuillotineSportConfig(sport)
  const min = Math.max(4, profile?.minTeams ?? 8)
  const max = Math.max(min, profile?.maxTeams ?? 18)
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

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
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr', 'ncaaf_standard'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    dynasty: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_superflex'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    keeper: {
      NFL: ['fb_half_ppr', 'fb_ppr', 'fb_standard'],
      NBA: ['nba_points'],
      MLB: ['mlb_points'],
      NHL: ['nhl_points'],
      NCAAF: ['ncaaf_half_ppr', 'ncaaf_ppr', 'ncaaf_standard'],
      NCAAB: ['ncaab_points'],
      SOCCER: ['soc_points'],
    },
    best_ball: {
      NFL: ['fb_half_ppr', 'fb_ppr'],
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
      NFL: ['fb_half_ppr', 'fb_ppr'],
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
    // One chop per scoring period, so the sport's schedule decides how many teams fit. The
    // hand-written even list here allowed an 18-team NFL guillotine that 17 chops cannot finish.
    guillotine: {
      NFL: guillotineTeamCounts('NFL'),
      NCAAF: guillotineTeamCounts('NCAAF'),
      NBA: guillotineTeamCounts('NBA'),
      NHL: guillotineTeamCounts('NHL'),
      MLB: guillotineTeamCounts('MLB'),
    },
    zombie: {
      NFL: [8, 10, 12, 14],
      NBA: [8, 10, 12, 14],
      MLB: [8, 10, 12, 14],
      NHL: [8, 10, 12, 14],
    },
    // `SURVIVOR_CAST_SIZE_OPTIONS` is what `POST /api/league/create` clamps a submitted cast
    // size to, so anything this catalog offers that is not in that list gets silently rewritten
    // on save. Read it rather than restating it.
    survivor: {
      NFL: [...SURVIVOR_CAST_SIZE_OPTIONS],
      NCAAF: [...SURVIVOR_CAST_SIZE_OPTIONS],
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
