/**
 * EmojiPickerService - shared emoji catalog and insert-at-cursor helpers.
 *
 * The catalog is local on purpose: emoji lookup must not depend on a provider
 * key, and chat should keep working when GIF services are disabled.
 */

export const EMOJI_CATEGORIES = [
  "recent",
  "smileys",
  "gestures",
  "hearts",
  "sports",
  "food",
  "travel",
  "objects",
  "symbols",
  "flags",
] as const

export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number]

export const EMOJI_BY_CATEGORY: Record<EmojiCategory, string[]> = {
  recent: ["🔥", "😂", "👏", "🏆", "⚽", "👀", "💯", "🙌", "😤", "🥶", "🤝", "✨"],
  smileys: [
    "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉",
    "😍", "🥰", "😘", "😋", "😜", "🤪", "🤩", "🥳", "😎", "🤔", "🫡", "🤫",
    "😬", "😮", "😲", "😳", "🥹", "😤", "😡", "😭", "😴", "🥶", "🫠", "🤯",
  ],
  gestures: [
    "👍", "👎", "👏", "🙌", "👐", "🤝", "🙏", "✌️", "🤞", "🤟", "🤘", "👌",
    "👊", "✊", "💪", "🫶", "👋", "☝️", "👇", "👈", "👉", "🫵", "✍️", "🤌",
  ],
  hearts: [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕",
    "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️",
  ],
  sports: [
    "⚽", "🏆", "🥇", "🥈", "🥉", "🎖️", "🏅", "🏟️", "🎯", "📣", "🚩", "🧤",
    "🏀", "🏈", "⚾", "🏒", "🎾", "🏐", "🏉", "🥅", "⛳", "🥊", "🏋️", "🏃",
  ],
  food: [
    "🍕", "🍔", "🌮", "🌯", "🍟", "🍗", "🥨", "🍿", "🍩", "🍪", "🍫", "🍻",
    "☕", "🥤", "🍾", "🥂", "🍎", "🍌", "🍓", "🥑", "🌶️", "🧊",
  ],
  travel: [
    "🌎", "🌍", "🌏", "🗺️", "🧭", "✈️", "🚀", "🚆", "🚗", "🚌", "🚕", "🚇",
    "🏨", "🏠", "🏖️", "🏜️", "🏔️", "🌆", "🌃", "🌅", "☀️", "🌙", "⭐", "⚡",
  ],
  objects: [
    "🎮", "🎧", "📱", "💻", "⌚", "📷", "🎥", "🎙️", "📌", "📎", "📝", "📊",
    "📈", "📉", "🔒", "🔓", "🔑", "🧠", "💎", "🛡️", "🎁", "💰", "💳", "🧾",
  ],
  symbols: [
    "✅", "❌", "⚠️", "🚨", "💢", "💤", "💥", "💫", "✨", "💯", "🔁", "🔄",
    "⬆️", "⬇️", "➡️", "⬅️", "⭐", "🔔", "🔕", "🟢", "🟡", "🔴", "🔵", "🟣",
  ],
  flags: [
    "🇺🇸", "🇲🇽", "🇨🇦", "🇧🇷", "🇦🇷", "🇺🇾", "🇨🇴", "🇪🇨", "🇯🇵", "🇰🇷", "🇦🇺", "🇳🇿",
    "🇫🇷", "🇪🇸", "🇩🇪", "🇬🇧", "🇬🇧", "🇵🇹", "🇳🇱", "🇧🇪", "🇭🇷", "🇲🇦", "🇸🇳", "🇬🇭",
  ],
}

/** Flattened compatibility list used by older chat surfaces. */
export const EMOJI_LIST: string[] = Array.from(
  new Set(EMOJI_CATEGORIES.flatMap((category) => EMOJI_BY_CATEGORY[category]))
)

export function appendEmoji(text: string, emoji: string): string {
  return text + emoji
}

export function getEmojiCategoryLabel(cat: EmojiCategory, locale?: string | null): string {
  const es = locale?.toLowerCase().startsWith("es")
  const labels: Record<EmojiCategory, { en: string; es: string }> = {
    recent: { en: "Recent", es: "Recientes" },
    smileys: { en: "Smileys", es: "Caras" },
    gestures: { en: "Gestures", es: "Gestos" },
    hearts: { en: "Hearts", es: "Corazones" },
    sports: { en: "Sports", es: "Deportes" },
    food: { en: "Food", es: "Comida" },
    travel: { en: "Travel", es: "Viajes" },
    objects: { en: "Objects", es: "Objetos" },
    symbols: { en: "Symbols", es: "Simbolos" },
    flags: { en: "Flags", es: "Banderas" },
  }
  return es ? labels[cat].es : labels[cat].en
}

export function searchEmojiCatalog(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return EMOJI_LIST
  const category = EMOJI_CATEGORIES.find((item) => item.includes(q))
  if (category) return EMOJI_BY_CATEGORY[category]
  return EMOJI_LIST.filter((emoji) => emoji.includes(q))
}
