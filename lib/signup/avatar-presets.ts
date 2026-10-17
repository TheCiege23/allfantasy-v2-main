/**
 * App-provided avatar preset options for signup (20 fun options).
 * Keys are stored in UserProfile.avatarPreset; UI can map to icons or images later.
 */
export const AVATAR_PRESETS = [
  "crest",
  "bolt",
  "crown",
  "trophy",
  "star",
  "flame",
  "shield",
  "diamond",
  "medal",
  "target",
  "zap",
  "comet",
  "moon",
  "sun",
  "football",
  "basketball",
  "baseball",
  "hockey",
  "soccer",
  "champion",
] as const

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]

export const AVATAR_PRESET_LABELS: Record<AvatarPresetId, string> = {
  crest: "Crest",
  bolt: "Bolt",
  crown: "Crown",
  trophy: "Trophy",
  star: "Star",
  flame: "Flame",
  shield: "Shield",
  diamond: "Diamond",
  medal: "Medal",
  target: "Target",
  zap: "Zap",
  comet: "Comet",
  moon: "Moon",
  sun: "Sun",
  football: "Football",
  basketball: "Basketball",
  baseball: "Baseball",
  hockey: "Hockey",
  soccer: "Soccer",
  champion: "Champion",
}

/**
 * i18n keys beside `AVATAR_PRESET_LABELS`. Display only — the preset id is what gets stored in
 * `UserProfile.avatarPreset`; the English label stays the fallback.
 */
export const AVATAR_PRESET_LABEL_KEYS = Object.fromEntries(
  AVATAR_PRESETS.map((id) => [id, `settings.profile.avatarPreset.${id}`]),
) as Record<AvatarPresetId, string>

export const DEFAULT_AVATAR_PRESET: AvatarPresetId = "crest"
