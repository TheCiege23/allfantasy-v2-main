/**
 * Survivor idol play-engine registry — the one source of truth for which idols can be played.
 *
 * Each entry is an engine power the server resolves today, the play route that resolves it
 * (`/api/leagues/:id/survivor/<route>`, handled in league-survivor/foundation), the play flow the
 * client renders, and the catalog idol type it plays as.
 *
 * An idol type is *playable* exactly when an entry here names it. Everything that decides which
 * idols a league can hold (the balanced draw, pick mode, the preview, seeding, the vault's Play
 * button, the IdolSetup "Coming soon" tags) derives from this registry, so a type joins
 * automatically the moment its engine is registered here. Client-safe: no server imports.
 */

export type SurvivorIdolPlayFlow = 'council' | 'roster'

export type SurvivorIdolPlayEngine = {
  /** Foundation route that resolves the play. */
  route: string
  flow: SurvivorIdolPlayFlow
  /** Catalog idol type this engine plays as; null for legacy powers with no catalog type. */
  idolTypeId: string | null
}

export const SURVIVOR_IDOL_PLAY_ENGINES = {
  vote_shield: { route: 'play-idol', flow: 'council', idolTypeId: 'immunity' },
  extra_vote: { route: 'play-extra-vote', flow: 'council', idolTypeId: 'extra-vote' },
  vote_steal: { route: 'play-vote-steal', flow: 'council', idolTypeId: 'vote-steal' },
  triple_steal: { route: 'play-steal-three', flow: 'roster', idolTypeId: 'steal-three' },
  // Legacy powers seeded by older leagues; they keep working but are never drawn.
  skip_tribal: { route: 'play-skip-tribal', flow: 'council', idolTypeId: null },
  island_raid: { route: 'play-steal-three', flow: 'roster', idolTypeId: null },
} as const satisfies Record<string, SurvivorIdolPlayEngine>

export type SurvivorIdolEnginePower = keyof typeof SURVIVOR_IDOL_PLAY_ENGINES

export function survivorIdolPlayEngine(power: string | null | undefined): SurvivorIdolPlayEngine | null {
  if (!power || !Object.prototype.hasOwnProperty.call(SURVIVOR_IDOL_PLAY_ENGINES, power)) return null
  return SURVIVOR_IDOL_PLAY_ENGINES[power as SurvivorIdolEnginePower]
}

/**
 * The engine power a catalog idol type plays as, or null while it has none. The registry wins;
 * a declared value (e.g. an `enginePowerType` column) counts only if it names a registered engine.
 */
export function survivorIdolEnginePowerFor(typeId: string, declared?: string | null): SurvivorIdolEnginePower | null {
  for (const [power, engine] of Object.entries(SURVIVOR_IDOL_PLAY_ENGINES)) {
    if (engine.idolTypeId === typeId) return power as SurvivorIdolEnginePower
  }
  return survivorIdolPlayEngine(declared) ? (declared as SurvivorIdolEnginePower) : null
}
