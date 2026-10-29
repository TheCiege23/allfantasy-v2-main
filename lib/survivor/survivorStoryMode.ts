/**
 * Story mode: how the weekly episode recap is told, set by the commissioner (AF Supreme, the
 * Premium command center's Story mode controls tile). Stored on League.settings under
 * `survivorStoryMode`; a league that never set it reads the defaults, which are exactly the recap
 * every league had before (classic tone, confessionals in, posted to league chat).
 *
 * Tone changes only the narration (the episode title and the host's closing line). It never adds
 * or removes a fact, so the spoiler rules of `buildSurvivorEpisode` hold for every tone.
 * Pure and client-safe.
 */

export const SURVIVOR_STORY_TONES = ['classic', 'dramatic', 'playful'] as const
export type SurvivorStoryTone = (typeof SURVIVOR_STORY_TONES)[number]

export type SurvivorStoryModeSettings = {
  tone: SurvivorStoryTone
  /** Include the voted-out manager's last confessional in the episode. */
  confessionals: boolean
  /** Post the episode to league chat. Off still keeps it on the Episodes page and the watch page. */
  postToChat: boolean
}

export const SURVIVOR_STORY_MODE_SETTING = 'survivorStoryMode'

export const SURVIVOR_STORY_MODE_DEFAULTS: SurvivorStoryModeSettings = { tone: 'classic', confessionals: true, postToChat: true }

export const SURVIVOR_STORY_TONE_LABELS: Record<SurvivorStoryTone, { label: string; hint: string }> = {
  classic: { label: 'Classic', hint: 'Straight reporting, like the recap has always read.' },
  dramatic: { label: 'Dramatic', hint: 'Prestige-TV narration: tension, torches and fate.' },
  playful: { label: 'Playful', hint: 'Light and cheeky, for leagues that like a laugh.' },
}

export function isSurvivorStoryTone(value: unknown): value is SurvivorStoryTone {
  return typeof value === 'string' && (SURVIVOR_STORY_TONES as readonly string[]).includes(value)
}

/** Read the setting from League.settings, falling back field by field to the defaults. */
export function readSurvivorStoryMode(settings: unknown): SurvivorStoryModeSettings {
  const root = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const raw = root[SURVIVOR_STORY_MODE_SETTING]
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    tone: isSurvivorStoryTone(row.tone) ? row.tone : SURVIVOR_STORY_MODE_DEFAULTS.tone,
    confessionals: typeof row.confessionals === 'boolean' ? row.confessionals : SURVIVOR_STORY_MODE_DEFAULTS.confessionals,
    postToChat: typeof row.postToChat === 'boolean' ? row.postToChat : SURVIVOR_STORY_MODE_DEFAULTS.postToChat,
  }
}

/** Validate a save. Unknown keys are ignored; a wrong type is an error, not a silent default. */
export function parseSurvivorStoryModeInput(body: unknown): { ok: true; value: SurvivorStoryModeSettings } | { ok: false; error: string } {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  if (!raw) return { ok: false, error: 'Send the story mode settings.' }
  if (!isSurvivorStoryTone(raw.tone)) return { ok: false, error: 'Tone must be classic, dramatic or playful.' }
  if (typeof raw.confessionals !== 'boolean' || typeof raw.postToChat !== 'boolean') return { ok: false, error: 'Confessionals and post to chat must be on or off.' }
  return { ok: true, value: { tone: raw.tone, confessionals: raw.confessionals, postToChat: raw.postToChat } }
}

type ToneFacts = { idolsPlayed: number; tie: boolean; eliminated: number; merged: boolean; remaining: number | null }

const TITLES: Record<SurvivorStoryTone, { idol: string; tie: string; double: string; single: string; quiet: string }> = {
  classic: { idol: 'Idol in Play', tie: 'Deadlock', double: 'Double Trouble', single: 'The Tribe Has Spoken', quiet: 'A Quiet Week on the Island' },
  dramatic: { idol: 'Hidden in Plain Sight', tie: 'No Way Out', double: 'Two Torches Fall', single: 'The Torch Goes Dark', quiet: 'The Calm Before the Storm' },
  playful: { idol: 'Surprise, Surprise', tie: 'Well, That Was Awkward', double: 'Buy One, Get One Gone', single: 'See Ya, Wouldn’t Wanna Be Ya', quiet: 'Nobody Panic (Yet)' },
}

/** The episode title for a tone. Classic is the title every recap has always had. */
export function storyEpisodeTitle(tone: SurvivorStoryTone, facts: ToneFacts): string {
  const t = TITLES[tone]
  if (facts.idolsPlayed) return t.idol
  if (facts.tie) return t.tie
  if (facts.eliminated > 1) return t.double
  if (facts.eliminated === 1) return t.single
  return t.quiet
}

/** The host's closing line. Classic keeps the plain "N managers remain" ending. */
export function storyClosingLine(tone: SurvivorStoryTone, facts: ToneFacts): string | null {
  if (facts.remaining == null || facts.remaining <= 0) return null
  const n = facts.remaining
  if (tone === 'dramatic') return facts.merged ? `${n} remain. Only one will outlast them all.` : `${n} remain. The merge looms, and alliances will be tested.`
  if (tone === 'playful') return facts.merged ? `${n} left standing. Somebody pack a snack, this could take a while.` : `${n} still on the beach. Merge rumours are flying, and so are the sandflies.`
  return `${n} managers remain${facts.merged ? '' : '. The merge is getting closer'}.`
}
