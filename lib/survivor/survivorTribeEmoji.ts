/**
 * Tribe emoji beside castaway names — display only. The original league had every manager rename
 * their team "name + tribe emoji"; here the commissioner switches it on (`tribeEmojiInNames`) and
 * Survivor screens draw the emoji beside each name. Stored team names are never changed.
 *
 * The emoji is the one the commissioner put in front of the tribe's name (the Tribes editor), else
 * the catalogue mascot's emoji, else none. Pure and client-safe.
 */
import { extractLeadingTribeIcon } from './survivorVisuals'

/** Catalogue mascot → emoji (lib/survivor/tribeCatalog.json ids). A mascot with no fitting emoji is left out. */
export const TRIBE_CATALOG_EMOJI: Readonly<Record<string, string>> = {
  crab: '🦀', shark: '🦈', turtle: '🐢', moray: '🐍', manta: '🌊', octopus: '🐙', barracuda: '🐟', hammerhead: '🦈',
  boar: '🐗', croc: '🐊', komodo: '🦎', macaw: '🦜', toucan: '🦜', flyingfox: '🦇', tiki: '🗿', cobra: '🐍',
  scorpion: '🦂', lobster: '🦞', gorilla: '🦍', jaguar: '🐆', tiger: '🐅', panther: '🐈‍⬛', gecko: '🦎', iguana: '🦎',
  frog: '🐸', hornbill: '🐦', seaeagle: '🦅', frigatebird: '🐦', puffer: '🐡', marlin: '🐟', mantis: '🦐', lionfish: '🐠',
  orca: '🐋', buffalo: '🐃', macaque: '🐒', orangutan: '🦧', salamander: '🦎', mongoose: '🦡', tarantula: '🕷️', jellyfish: '🪼',
  sealion: '🦭', piranha: '🐟', anaconda: '🐍', dingo: '🐕', osprey: '🦅', owl: '🦉', sunbear: '🐻', beetle: '🪲',
  devil: '😈', hyena: '🐺',
}

export function tribeEmojiFor(tribe: { name?: string | null; catalogId?: string | null } | null | undefined): string | null {
  if (!tribe) return null
  return extractLeadingTribeIcon(tribe.name) ?? (tribe.catalogId ? TRIBE_CATALOG_EMOJI[tribe.catalogId] ?? null : null)
}

/** "Jordan" → "Jordan 🦂" when the setting is on and the tribe has an emoji; otherwise unchanged. */
export function castawayNameWithTribeEmoji(name: string, emoji: string | null | undefined, enabled: boolean): string {
  if (!enabled || !emoji || name.includes(emoji)) return name
  return `${name} ${emoji}`
}

/**
 * Decorate a roster → name map from roster → tribe. Returns a new map; rosters with no tribe, or a
 * tribe with no emoji, keep their name.
 */
export function decorateNamesWithTribeEmoji(
  names: Readonly<Record<string, string>>,
  tribeByRoster: ReadonlyMap<string, { name?: string | null; catalogId?: string | null } | null>,
  enabled: boolean,
): Record<string, string> {
  if (!enabled) return { ...names }
  const out: Record<string, string> = {}
  for (const [rosterId, name] of Object.entries(names)) out[rosterId] = castawayNameWithTribeEmoji(name, tribeEmojiFor(tribeByRoster.get(rosterId)), true)
  return out
}
