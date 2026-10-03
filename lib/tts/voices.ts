/** ElevenLabs voice presets for Chimmy TTS (IDs from ElevenLabs). */

export type ChimmyVoice = {
  id: string
  name: string
  description: string
  /** i18n key for `description` (display only); the English description stays the fallback. */
  descriptionKey?: string
  gender: 'female' | 'male' | 'neutral'
  accent: string
  preview?: string
}

/** ElevenLabs premade Rachel (same id as `ELEVENLABS_RACHEL_PREMADE` in chimmy voice route). */
export const ELEVENLABS_RACHEL_PREMADE_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

export const CHIMMY_VOICES: ChimmyVoice[] = [
  {
    id: 'XrExE9yKIg1WjnnlVkGX',
    name: 'Allison',
    description: 'Warm, clear, friendly',
    descriptionKey: 'settings.chimmyVoice.voiceDesc.allison',
    gender: 'female',
    accent: 'American',
  },
  {
    id: ELEVENLABS_RACHEL_PREMADE_VOICE_ID,
    name: 'Rachel',
    description: 'Calm, professional',
    descriptionKey: 'settings.chimmyVoice.voiceDesc.rachel',
    gender: 'female',
    accent: 'American',
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    name: 'Josh',
    description: 'Deep, casual, energetic',
    descriptionKey: 'settings.chimmyVoice.voiceDesc.josh',
    gender: 'male',
    accent: 'American',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    description: 'Smooth, well-rounded',
    descriptionKey: 'settings.chimmyVoice.voiceDesc.antoni',
    gender: 'male',
    accent: 'American',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    description: 'Authoritative, sports-ready',
    descriptionKey: 'settings.chimmyVoice.voiceDesc.adam',
    gender: 'male',
    accent: 'American',
  },
  {
    id: 'yoZ06aMxZJJ28mfd3POQ',
    name: 'Sam',
    description: 'Raspy, confident',
    descriptionKey: 'settings.chimmyVoice.voiceDesc.sam',
    gender: 'male',
    accent: 'American',
  },
]

export const DEFAULT_VOICE_ID = CHIMMY_VOICES[0]!.id

/**
 * Chimmy dashboard voice dropdown: primary ElevenLabs options (Allison custom + Rachel premade).
 * Full list stays in {@link CHIMMY_VOICES} for TTS allowlist / localStorage.
 */
export const CHIMMY_VOICE_DROPDOWN_OPTIONS: ChimmyVoice[] = CHIMMY_VOICES.filter((v) =>
  v.name === 'Allison' || v.name === 'Rachel',
)

export const CHIMMY_VOICE_ID_STORAGE_KEY = 'chimmy_voice_id'

export function getChimmyVoiceLabel(voiceId: string): string {
  return CHIMMY_VOICES.find((v) => v.id === voiceId)?.name ?? 'Voice'
}

/** Client-only: read persisted voice from localStorage. */
export function readStoredChimmyVoiceId(): string {
  if (typeof window === 'undefined') return DEFAULT_VOICE_ID
  try {
    const s = localStorage.getItem(CHIMMY_VOICE_ID_STORAGE_KEY)
    if (s && CHIMMY_VOICES.some((v) => v.id === s)) return s
  } catch {
    /* ignore */
  }
  return DEFAULT_VOICE_ID
}

/** IDs allowed for POST /api/tts (static list + optional env override). */
export function getAllowedElevenLabsVoiceIds(): Set<string> {
  const ids = new Set(CHIMMY_VOICES.map((v) => v.id))
  if (typeof process !== 'undefined') {
    const env = process.env.ELEVENLABS_VOICE_ID?.trim()
    if (env) ids.add(env)
    const envRachel = process.env.ELEVENLABS_RACHEL_VOICE_ID?.trim()
    if (envRachel) ids.add(envRachel)
  }
  return ids
}

/** Server-side: persist only voice IDs that TTS will accept. */
export function isSelectableChimmyTtsVoiceId(id: string): boolean {
  const t = id.trim()
  if (!t) return false
  return getAllowedElevenLabsVoiceIds().has(t)
}

/** Client-side: preset list only (env-only IDs are not selectable in UI). */
export function isPresetChimmyTtsVoiceId(id: string): boolean {
  return CHIMMY_VOICES.some((v) => v.id === id)
}
