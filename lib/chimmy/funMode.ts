/**
 * Fun mode — Chimmy with emojis (user decision 2026-10-01). Off by default; the drawer's "Fun"
 * toggle turns it on per user and sends `tone=fun` with each question.
 *
 * 🛑 PERSONALITY, NEVER SUBSTANCE. A grade, a number or a refusal with an emoji in it reads as a
 * joke about the answer, so the rules keep emojis to the voice around the analysis and out of the
 * analysis itself. The figures stay exactly what the tools returned.
 */

export const FUN_MODE_TONE = 'fun'

export function isFunModeTone(tone: string | null | undefined): boolean {
  return typeof tone === 'string' && tone.trim().toLowerCase() === FUN_MODE_TONE
}

export const FUN_MODE_DIRECTIVE = [
  'The user turned on Fun mode: answer with personality and a few emojis.',
  '- Use 2 to 4 emojis in the whole reply, in the opener, short reactions and the sign-off (e.g. 🔥 📈 📉 🏈 😬 🤝 💸 🧠).',
  '- Never put an emoji inside a number, a grade, a value, a player or team name, or a list of assets.',
  '- No emojis at all when you are refusing, saying data is missing, or giving bad news about an injury.',
  '- Keep every fact, number and recommendation exactly as it would be without Fun mode — only the voice changes.',
].join('\n')
