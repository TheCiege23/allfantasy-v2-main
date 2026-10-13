/**
 * [NEW] lib/nfl-scoring/index.ts — NFL scoring system barrel exports.
 */
export * from './NflScoringPresets'
export { nflScoringSeedForCreate, TE_PREMIUM_POINT_OPTIONS, isValidTePremiumPoints, type NflScoringSeed } from './nflScoringSeedForCreate'
export { getLeagueNflScoringConfig, saveLeagueNflScoringConfig, applyDefaultNflScoringOnCreate, type LeagueNflScoringConfig } from './NflScoringConfigService'
export { NFL_SCORING_CATEGORIES, NFL_PREMIUM_SCORING, buildFullNflDefaultConfig, getAllNflScoringKeys, type ScoringRow, type ScoringCategory } from './NflScoringCategories'
