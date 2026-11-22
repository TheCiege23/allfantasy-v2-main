import type { AvatarPresetId } from "@/lib/signup/avatar-presets"

/**
 * Maps each of the 20 app-provided avatar presets to an emoji for consistent,
 * playful display in picker and identity. Sports-app appropriate and distinct.
 */
export const AVATAR_PRESET_EMOJI: Record<AvatarPresetId, string> = {
  crest: "🎖️",
  bolt: "⚡",
  crown: "👑",
  trophy: "🏆",
  star: "⭐",
  flame: "🔥",
  shield: "🛡️",
  diamond: "💎",
  medal: "🏅",
  target: "🎯",
  zap: "💥",
  comet: "☄️",
  moon: "🌙",
  sun: "☀️",
  football: "🏈",
  basketball: "🏀",
  baseball: "⚾",
  hockey: "🏒",
  soccer: "⚽",
  champion: "🥇",
}

export function getAvatarPresetEmoji(presetId: string | null | undefined): string | null {
  if (!presetId) return null
  const emoji = AVATAR_PRESET_EMOJI[presetId as AvatarPresetId]
  return emoji ?? null
}

