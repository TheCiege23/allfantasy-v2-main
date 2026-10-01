/**
 * The moods a Fun-mode answer may name for a GIF, and the line that names one. Pure, so the client
 * bundle can import Fun mode's rules without reaching the database; the lookup is chimmyGif.ts.
 */

export const CHIMMY_GIF_MOODS = {
  celebration: ['celebration', 'celebrate', 'touchdown'],
  hype: ['hype', 'lets go', 'fire'],
  facepalm: ['facepalm', 'fail'],
  laughing: ['laughing', 'laugh', 'lol'],
  shocked: ['shocked', 'shock', 'wow', 'omg'],
  robbery: ['robbery', 'steal', 'heist', 'fleeced'],
  sad: ['sad', 'crying', 'cry'],
  thinking: ['thinking', 'hmm', 'think'],
  deal: ['deal', 'handshake', 'agreement'],
} as const

export type ChimmyGifMood = keyof typeof CHIMMY_GIF_MOODS

export const CHIMMY_GIF_DIRECTIVE =
  `- If, and only if, the reply is a light reaction (a trade win, a fleecing, a big week, a bad beat), you may end it with ONE final line exactly like [gif: celebration], choosing from: ${Object.keys(CHIMMY_GIF_MOODS).join(', ')}. Never a link, never more than one, and never on a refusal, a missing-data answer or injury news.`

const GIF_LINE = /\n?[ \t]*\[gif:\s*([a-z-]+)\s*\][ \t]*$/i

/** The reply without its trailing `[gif: …]` line, and the mood it named when that mood is known. */
export function extractChimmyGifMood(text: string): { text: string; mood: ChimmyGifMood | null } {
  const m = GIF_LINE.exec(text.trimEnd())
  if (!m) return { text, mood: null }
  const mood = m[1]!.toLowerCase()
  return {
    text: text.trimEnd().slice(0, m.index).trimEnd(),
    mood: mood in CHIMMY_GIF_MOODS ? (mood as ChimmyGifMood) : null,
  }
}
