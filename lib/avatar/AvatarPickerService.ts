import { AVATAR_PRESETS } from "@/lib/signup/avatar-presets"
import { AVATAR_PRESET_EMOJI } from "./AvatarCatalogResolver"
import { AVATAR_PRESET_LABELS } from "@/lib/signup/avatar-presets"
import type { AvatarPresetId } from "@/lib/signup/avatar-presets"

interface AvatarCatalogEntry {
  id: AvatarPresetId
  label: string
  emoji: string
}

/**
 * Returns the full catalog of 20 app-provided avatars for picker UI.
 */
export function getAvatarCatalog(): AvatarCatalogEntry[] {
  return AVATAR_PRESETS.map((id) => ({
    id,
    label: AVATAR_PRESET_LABELS[id],
    emoji: AVATAR_PRESET_EMOJI[id],
  }))
}
