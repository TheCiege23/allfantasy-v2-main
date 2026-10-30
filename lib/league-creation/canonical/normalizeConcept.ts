/**
 * Maps public concept strings (including aliases) to format-engine ids.
 */

import type { LeagueFormatId } from '@/lib/league/format-engine'

const CONCEPT_TO_FORMAT: Record<string, LeagueFormatId> = {
  redraft: 'redraft',
  dynasty: 'dynasty',
  keeper: 'keeper',
  best_ball: 'best_ball',
  guillotine: 'guillotine',
  survivor: 'survivor',
  tournament: 'tournament',
  devy: 'devy',
  c2c: 'c2c',
  zombie: 'zombie',
  salary_cap: 'salary_cap',
  big_brother: 'big_brother',
  pirate: 'pirate',
  // common aliases / uppercase
  REDRAFT: 'redraft',
  DYNASTY: 'dynasty',
  KEEPER: 'keeper',
  BEST_BALL: 'best_ball',
  GUILLOTINE: 'guillotine',
  SURVIVOR: 'survivor',
  TOURNAMENT: 'tournament',
  DEVY: 'devy',
  C2C: 'c2c',
  ZOMBIE: 'zombie',
  SALARY_CAP: 'salary_cap',
  BIG_BROTHER: 'big_brother',
  PIRATE: 'pirate',
  // product aliases → closest supported format (extend FORMAT_REGISTRY when adding first-class formats)
  pirate_vampire: 'dynasty',
  PIRATE_VAMPIRE: 'dynasty',
  royal: 'dynasty',
  ROYAL: 'dynasty',
  king_of_the_hill: 'redraft',
  KING_OF_THE_HILL: 'redraft',
  idp: 'redraft',
  IDP: 'redraft',
}

export interface NormalizedConcept {
  formatId: LeagueFormatId
  /** Extra tags merged into conceptRules (e.g. pirate_vampire flavor on dynasty shell). */
  aliasTags: string[]
}

export function normalizeConceptToFormat(rawConcept: string | null | undefined): NormalizedConcept | null {
  const key = String(rawConcept ?? '').trim()
  if (!key) return null
  const lower = key.toLowerCase()
  const formatId = CONCEPT_TO_FORMAT[key] ?? CONCEPT_TO_FORMAT[lower]
  if (!formatId) return null

  const aliasTags: string[] = []
  if (lower === 'pirate_vampire' || key === 'PIRATE_VAMPIRE') aliasTags.push('pirate_vampire')
  if (lower === 'royal' || key === 'ROYAL') aliasTags.push('royal')
  if (lower === 'king_of_the_hill' || key === 'KING_OF_THE_HILL') aliasTags.push('king_of_the_hill')
  if (lower === 'idp' || key === 'IDP') aliasTags.push('idp')

  return { formatId, aliasTags }
}
