/**
 * Presentation-layer personality for AI managers — gameplay stays deterministic elsewhere.
 * Tasteful, non-toxic, non-political copy only.
 */

import type { BotArchetypeId } from "./types"

type PersonalityTone =
  | "calm"
  | "analytical"
  | "cocky"
  | "competitive"
  | "chaotic"
  | "friendly"
  | "quiet"
  | "strategic"

type ConfidenceStyle = "measured" | "bold" | "understated"
type ReactionStyle = "minimal" | "balanced" | "expressive"
type TradePosture = "patient" | "aggressive" | "value_first"
type CelebrationStyle = "subtle" | "energetic" | "dry"
type FrustrationStyle = "stoic" | "honest" | "deflecting"

export type BotPersonalityProfile = {
  botId?: string
  archetypeId: BotArchetypeId
  /** Short label for badges, e.g. "Balanced Builder" */
  label: string
  tone: PersonalityTone
  confidenceStyle: ConfidenceStyle
  reactionStyle: ReactionStyle
  tradePosture: TradePosture
  celebrationStyle: CelebrationStyle
  frustrationStyle: FrustrationStyle
  /** 0 = terse, 1 = normal, 2 = slightly richer (never long paragraphs) */
  verbosity: 0 | 1 | 2
  /** Max trash-talk intensity is capped in voice templates */
  trashTalkLevel: 0 | 1 | 2
}

const MAP: Record<BotArchetypeId, BotPersonalityProfile> = {
  balanced_builder: {
    archetypeId: "balanced_builder",
    label: "Balanced Builder",
    tone: "analytical",
    confidenceStyle: "measured",
    reactionStyle: "balanced",
    tradePosture: "value_first",
    celebrationStyle: "subtle",
    frustrationStyle: "stoic",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  win_now_grinder: {
    archetypeId: "win_now_grinder",
    label: "Win-Now Grinder",
    tone: "competitive",
    confidenceStyle: "bold",
    reactionStyle: "expressive",
    tradePosture: "aggressive",
    celebrationStyle: "energetic",
    frustrationStyle: "honest",
    verbosity: 1,
    trashTalkLevel: 1,
  },
  rookie_hunter: {
    archetypeId: "rookie_hunter",
    label: "Rookie Hunter",
    tone: "strategic",
    confidenceStyle: "bold",
    reactionStyle: "balanced",
    tradePosture: "patient",
    celebrationStyle: "subtle",
    frustrationStyle: "deflecting",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  zero_rb_sharp: {
    archetypeId: "zero_rb_sharp",
    label: "Zero-RB Sharp",
    tone: "analytical",
    confidenceStyle: "measured",
    reactionStyle: "minimal",
    tradePosture: "value_first",
    celebrationStyle: "dry",
    frustrationStyle: "stoic",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  hero_rb_drafter: {
    archetypeId: "hero_rb_drafter",
    label: "Hero-RB",
    tone: "competitive",
    confidenceStyle: "bold",
    reactionStyle: "balanced",
    tradePosture: "aggressive",
    celebrationStyle: "subtle",
    frustrationStyle: "honest",
    verbosity: 1,
    trashTalkLevel: 1,
  },
  qb_early_drafter: {
    archetypeId: "qb_early_drafter",
    label: "QB Early",
    tone: "analytical",
    confidenceStyle: "measured",
    reactionStyle: "balanced",
    tradePosture: "value_first",
    celebrationStyle: "subtle",
    frustrationStyle: "stoic",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  te_premium_exploiter: {
    archetypeId: "te_premium_exploiter",
    label: "TE Premium",
    tone: "strategic",
    confidenceStyle: "measured",
    reactionStyle: "balanced",
    tradePosture: "value_first",
    celebrationStyle: "dry",
    frustrationStyle: "deflecting",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  chaos_gambler: {
    archetypeId: "chaos_gambler",
    label: "Chaos Gambler",
    tone: "chaotic",
    confidenceStyle: "bold",
    reactionStyle: "expressive",
    tradePosture: "aggressive",
    celebrationStyle: "energetic",
    frustrationStyle: "honest",
    verbosity: 2,
    trashTalkLevel: 2,
  },
  devy_hoarder: {
    archetypeId: "devy_hoarder",
    label: "Devy Hoarder",
    tone: "strategic",
    confidenceStyle: "measured",
    reactionStyle: "balanced",
    tradePosture: "patient",
    celebrationStyle: "subtle",
    frustrationStyle: "stoic",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  pick_collector: {
    archetypeId: "pick_collector",
    label: "Pick Collector",
    tone: "analytical",
    confidenceStyle: "understated",
    reactionStyle: "minimal",
    tradePosture: "patient",
    celebrationStyle: "dry",
    frustrationStyle: "stoic",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  aging_vet_buyer: {
    archetypeId: "aging_vet_buyer",
    label: "Vet Buyer",
    tone: "calm",
    confidenceStyle: "measured",
    reactionStyle: "balanced",
    tradePosture: "aggressive",
    celebrationStyle: "subtle",
    frustrationStyle: "honest",
    verbosity: 1,
    trashTalkLevel: 0,
  },
  risk_averse_floor: {
    archetypeId: "risk_averse_floor",
    label: "Floor Player",
    tone: "quiet",
    confidenceStyle: "understated",
    reactionStyle: "minimal",
    tradePosture: "patient",
    celebrationStyle: "subtle",
    frustrationStyle: "stoic",
    verbosity: 0,
    trashTalkLevel: 0,
  },
}

export function getPersonalityForArchetype(archetypeId: string): BotPersonalityProfile {
  const id = archetypeId as BotArchetypeId
  return MAP[id] ?? MAP.balanced_builder
}
