/**
 * Deterministic template rotation for bot “voice” lines — no LLM required.
 * Safe, short, non-toxic. Hash-based variety + templateKey for dedupe.
 */

import type { BotPersonalityProfile } from "./botPersonality"
import type { TradeResponseDecision } from "./types"

function stableHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const n = h >>> 0
  return n.toString(16).padStart(8, "0") + Math.imul(h, 31).toString(16).slice(0, 8)
}

type VoiceEventKind =
  | "draft_pick_made"
  | "auto_pick_made"
  | "waiver_claim_won"
  | "lineup_set"
  | "trade_accepted"
  | "trade_rejected"
  | "trade_countered"
  | "upset_win"
  | "tough_loss"
  | "playoff_clinch"
  | "elimination"
  | "orphan_takeover"
  | "commissioner_assigned_ai"

function hash(input: string): string {
  return stableHash(input)
}

function pickVariant(seed: string, lines: string[]): string {
  if (lines.length === 0) return ""
  const idx = parseInt(seed.slice(0, 8), 16) % lines.length
  return lines[idx]!
}

type FeedFlavorInput = {
  personality: BotPersonalityProfile
  kind: VoiceEventKind
  teamName: string
  playerName?: string
  position?: string
  round?: number
  pick?: number
  opponentName?: string
  /** Extra salt for rotation */
  salt?: string
}

/**
 * Returns flavor line + stable template key for history / dedupe.
 */
export function generateFeedFlavorLine(input: FeedFlavorInput): { flavor: string; templateKey: string; contentHash: string } {
  const { personality, kind, teamName, playerName, position, salt = "" } = input
  const base = `${kind}|${personality.archetypeId}|${teamName}|${playerName ?? ""}|${salt}`
  const seed = hash(base)

  let lines: string[] = []
  let key: string = kind

  switch (kind) {
    case "draft_pick_made":
    case "auto_pick_made": {
      key = `${kind}_${personality.tone}`
      const p = playerName ?? "this pick"
      const pos = position ? ` (${position})` : ""
      lines =
        personality.tone === "quiet" || personality.verbosity === 0
          ? [`${p}${pos}.`, `In.${pos}`, `Locked in ${p}.`]
          : personality.tone === "cocky" || personality.trashTalkLevel >= 1
            ? [`${p}${pos} — needed that profile.`, `Happy with ${p}${pos} here.`, `Board gave us ${p}; we take it.`]
            : personality.tone === "chaotic"
              ? [`Swinging on ${p}${pos}.`, `Let’s ride with ${p}.`, `${p}${pos} — why not.`]
              : [`Solid value with ${p}${pos}.`, `Fills a need with ${p}.`, `${p}${pos} fits the build.`]
      break
    }
    case "waiver_claim_won":
      lines =
        personality.reactionStyle === "minimal"
          ? [`Claim processed: ${playerName ?? "player"}.`]
          : [`Adding ${playerName ?? "help"} for the stretch.`, `Waiver win: ${playerName ?? "pickup"}.`]
      break
    case "trade_accepted":
      lines = [`Deal works for my roster.`, `Pulling the trigger.`, `This balances what I needed.`]
      break
    case "trade_rejected":
      lines = [`Pass — not enough there.`, `I'll hold.`, `Doesn't move the needle for me.`]
      break
    case "trade_countered":
      lines = [`Close — tweak the picks and we can talk.`, `Not quite — counter sent.`, `Needs a little more value.`]
      break
    case "upset_win":
      lines = [`We'll take that W.`, `Nice upset.`, `Big week.`]
      break
    case "tough_loss":
      lines = [`Rough one.`, `On to next week.`, `Regrouping.`]
      break
    case "playoff_clinch":
      lines = [`Playoffs locked in.`, `Clinched — eyes forward.`, `Mission one done.`]
      break
    case "elimination":
      lines = [`Season's done for us.`, `Tip the cap and move on.`, `We'll be back.`]
      break
    case "orphan_takeover":
      lines = [`Taking over the roster.`, `Stepping in here.`, `Managing this slot now.`]
      break
    case "commissioner_assigned_ai":
      lines = [`AI manager assigned.`, `Running this team now.`, `Locked in as AI.`]
      break
    case "lineup_set":
      lines = [`Lineup saved.`, `Starters set.`, `Locked starters.`]
      break
    default:
      lines = [`Update logged.`]
  }

  const flavor = pickVariant(seed, lines)
  const contentHash = hash(`${key}|${flavor}`)
  return { flavor, templateKey: key, contentHash }
}

export function flavorForTradeDecision(
  decision: TradeResponseDecision["decision"],
  personality: BotPersonalityProfile
): string | undefined {
  const input: FeedFlavorInput = {
    personality,
    kind:
      decision === "accept"
        ? "trade_accepted"
        : decision === "reject"
          ? "trade_rejected"
          : "trade_countered",
    teamName: "",
  }
  const { flavor } = generateFeedFlavorLine({ ...input, salt: decision })
  return personality.reactionStyle === "minimal" && decision === "reject" ? flavor.slice(0, 80) : flavor
}
