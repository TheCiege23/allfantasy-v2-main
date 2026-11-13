// lib/franchise-roadmap/index.ts — Franchise Roadmap Exports

export { computeFranchiseRoadmap } from './franchise-roadmap-engine'
export {
  computeDynastyExtension,
  computeDevyExtension,
  computeC2CExtension,
} from './franchise-mode-adapters'

export {
  FranchiseRoadmapInputSchema,
} from './franchise-roadmap-types'

export type {
  FranchiseRoadmap,
  FranchiseRoadmapInput,
  FranchisePhase,
  WindowStrength,
  ChampionshipWindow,
  YearPlan,
  AssetStrategy,
  RoadmapPlayer,
  DynastyRoadmapExtension,
  DevyRoadmapExtension,
  C2CRoadmapExtension,
} from './franchise-roadmap-types'
