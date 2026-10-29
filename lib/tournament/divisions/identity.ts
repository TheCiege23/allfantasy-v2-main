/**
 * Division identity — names, palettes and images for a two-division tournament.
 *
 * Built on the shipped catalog (`seasonArtworkCatalog.json`, a copy of the
 * division-identity handoff's `manifest.json`): 20 preset pairs, 40 sides, 50
 * unnamed library images. No image carries a name; the app sets every name, so a
 * rename never needs new art.
 *
 * What is stored per tournament (README "Build notes"):
 *   each division:   { name, sideId (palette), emblem (library id) }
 *   each conference: { name, image (library id) }
 * A league's display name is `{Conference} {Division}` — "Smoke Angelic".
 */
import { z } from 'zod'
import { containsProfanity } from '@/lib/profanity'
import { seasonArtCatalog, seasonArtSides, seasonArtEmblems } from '@/lib/tournament/seasonArtwork'

export const DIVISION_NAME_MAX = 16
export const CONFERENCE_NAME_MAX = 14
export const CONFERENCE_COUNT_OPTIONS = [2, 4, 6, 8, 10] as const

export const IDENTITY_ART_BASE = '/artwork/tournaments/identity'
export const BLACK_GOLD_BASE = '/artwork/tournaments/black-gold'

/** Overlay geometry, in percent of the art's box (division-identity README). */
export const CREST_GEOMETRY = {
  /** 300×340 frame. */
  aspect: 300 / 340,
  emblem: { left: 19.3, top: 18.2, width: 61.3 },
  /** Division name sits in the tab. */
  tab: { left: 20, top: 5.6, width: 60, height: 7.4 },
  /** Conference name sits on the ribbon. */
  ribbon: { left: 13, top: 79, width: 74, height: 10.4 },
} as const
export const RING_GEOMETRY = { emblem: { left: 19.3, top: 19.3, width: 61.3 } } as const

export type SideId = (typeof seasonArtSides)[number]
export type Side = (typeof seasonArtCatalog.sides)[SideId]

export function side(sideId: string): Side {
  return seasonArtCatalog.sides[sideId as SideId] ?? seasonArtCatalog.sides.gold
}

export const libraryImages: readonly string[] = seasonArtEmblems
export const isLibraryImage = (id: string) => libraryImages.includes(id)
export const isSide = (id: string) => (seasonArtSides as readonly string[]).includes(id)

export const framePath = (sideId: string) => `${IDENTITY_ART_BASE}/frames/${isSide(sideId) ? sideId : 'gold'}.svg`
export const ringPath = (sideId: string) => `${IDENTITY_ART_BASE}/rings/${isSide(sideId) ? sideId : 'gold'}.svg`
export const medallionPath = (sideId: string) => `${IDENTITY_ART_BASE}/medallions/${isSide(sideId) ? sideId : 'gold'}.svg`
export const libraryPath = (id: string) => `${IDENTITY_ART_BASE}/library/${isLibraryImage(id) ? id : 'shieldstar'}.svg`
/** The side's own emblem id, e.g. `angelic` → `angel`. */
export const defaultEmblem = (sideId: string) => side(sideId).icon.replace('library/', '').replace('.svg', '')

// ── presets ──────────────────────────────────────────────────────────────────

export type Preset = { id: string; a: SideId; b: SideId; label: string }
export const PRESETS: Preset[] = seasonArtCatalog.pairs.map(p => ({
  id: `${p.a}-${p.b}`, a: p.a as SideId, b: p.b as SideId, label: `${side(p.a).name} vs ${side(p.b).name}`,
}))
export const BLACK_GOLD_PRESET_ID = 'black-gold'

/** The ten conference mascots that also have Black & Gold pack art. */
export const KB_CONFERENCES = ['beast', 'goat', 'grizz', 'kings', 'rebels', 'smoke', 'stealth', 'swamp', 'thunder', 'warrior'] as const
export type KbConference = (typeof KB_CONFERENCES)[number]

/** Conference accent colours from the art pack README (eye glow, details, banner glow). */
export const KB_CONFERENCE_ACCENT: Record<KbConference, string> = {
  beast: '#e5432f', goat: '#9b6bff', grizz: '#e08a3c', kings: '#3d7dff', rebels: '#e0334f',
  smoke: '#7fd6d0', stealth: '#b06bff', swamp: '#4fcf6a', thunder: '#ffd23f', warrior: '#ff7a2f',
}

// ── stored shape ─────────────────────────────────────────────────────────────

const divisionSchema = z.object({
  name: z.string().trim().min(1, 'Name every division.').max(DIVISION_NAME_MAX, `Division names: up to ${DIVISION_NAME_MAX} characters.`),
  sideId: z.string().refine(isSide, 'Choose a supplied colour.'),
  emblem: z.string().refine(isLibraryImage, 'Choose an emblem from the library.'),
})
const conferenceSchema = z.object({
  name: z.string().trim().min(1, 'Name every conference.').max(CONFERENCE_NAME_MAX, `Conference names: up to ${CONFERENCE_NAME_MAX} characters.`),
  image: z.string().refine(isLibraryImage, 'Choose a conference image from the library.'),
})

export const divisionIdentitySchema = z.object({
  version: z.literal(1).default(1),
  presetId: z.string().nullable(),
  divisions: z.tuple([divisionSchema, divisionSchema]),
  conferences: z.array(conferenceSchema).min(2).max(10),
}).superRefine((v, ctx) => {
  for (const issue of identityIssues(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})

export type DivisionIdentityInput = { presetId: string | null; divisions: Array<{ name: string; sideId: string; emblem: string }>; conferences: Array<{ name: string; image: string }> }
export type DivisionIdentity = z.infer<typeof divisionIdentitySchema>

/**
 * Rules that cut across fields: unique names within the tournament (divisions and
 * conferences together, case-insensitive), the team-name content filter, and the
 * conference count options. Field shape is the schema's job.
 */
export function identityIssues(v: DivisionIdentityInput): string[] {
  const issues: string[] = []
  const names = [...v.divisions.map(d => d.name), ...v.conferences.map(c => c.name)].map(n => n.trim())
  const lower = names.map(n => n.toLowerCase()).filter(Boolean)
  const dupes = [...new Set(lower.filter((n, i) => lower.indexOf(n) !== i))]
  if (dupes.length) issues.push(`Names must be different from each other: ${dupes.join(', ')}.`)
  const flagged = names.filter(n => n && containsProfanity(n))
  if (flagged.length) issues.push('One or more names did not pass the content filter.')
  if (!(CONFERENCE_COUNT_OPTIONS as readonly number[]).includes(v.conferences.length)) issues.push('Choose 2, 4, 6, 8 or 10 conferences per division.')
  if (v.divisions.length !== 2) issues.push('This format has exactly two divisions.')
  return issues
}

export function parseIdentity(input: unknown): { ok: true; identity: DivisionIdentity } | { ok: false; issues: string[] } {
  const parsed = divisionIdentitySchema.safeParse(input)
  if (parsed.success) return { ok: true, identity: parsed.data }
  return { ok: false, issues: [...new Set(parsed.error.issues.map(i => i.message))] }
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Starting identity for a preset, with the KB conference mascots. */
export function presetIdentity(presetId: string, conferenceCount = 10): DivisionIdentity {
  const preset = PRESETS.find(p => p.id === presetId) ?? PRESETS[0]!
  return {
    version: 1,
    presetId: preset.id,
    divisions: [preset.a, preset.b].map(id => ({ name: side(id).name, sideId: id, emblem: defaultEmblem(id) })) as DivisionIdentity['divisions'],
    conferences: KB_CONFERENCES.slice(0, conferenceCount).map(id => ({ name: titleCase(id), image: id })),
  }
}

/** "Clear for custom names": keep colours and images, empty every name. */
export function clearedIdentity(current: DivisionIdentityInput): DivisionIdentityInput {
  return { presetId: null, divisions: current.divisions.map(d => ({ ...d, name: '' })), conferences: current.conferences.map(c => ({ ...c, name: '' })) }
}

/** Grow or shrink the conference list, keeping what was typed. */
export function resizeConferences(current: DivisionIdentityInput, count: number): DivisionIdentityInput {
  const next = current.conferences.slice(0, count)
  const used = new Set(next.map(c => c.image))
  const spare = [...KB_CONFERENCES, ...libraryImages].filter(id => !used.has(id))
  while (next.length < count) {
    const image = spare.shift() ?? 'shieldstar'
    next.push({ name: KB_CONFERENCES.includes(image as KbConference) ? titleCase(image) : '', image })
  }
  return { ...current, conferences: next }
}

export const leagueDisplayName = (conference: string, division: string) => `${conference.trim()} ${division.trim()}`.trim()

// ── art lookup ───────────────────────────────────────────────────────────────

const slug = (s: string) => s.trim().toLowerCase()

/**
 * Art pack lookup, exactly as its README states:
 * `imageFor(conference, division)` = `crests/${conf}-${div}.svg`.
 * Returns null for any pair the pack does not cover.
 */
export function imageFor(conference: string, division: string): string | null {
  const c = slug(conference), d = slug(division)
  if (!KB_CONFERENCES.includes(c as KbConference) || !['black', 'gold'].includes(d)) return null
  return `${BLACK_GOLD_BASE}/crests/${c}-${d}.svg`
}

export function bannerFor(conference: string, division: string): string | null {
  const c = slug(conference), d = slug(division)
  if (!KB_CONFERENCES.includes(c as KbConference) || !['black', 'gold'].includes(d)) return null
  return `${BLACK_GOLD_BASE}/banners/${c}-${d}.svg`
}

export type BlackGoldMark = 'kbi' | 'black-buffalo' | 'gold-buffalo' | 'region-north' | 'region-east' | 'region-south' | 'region-west' | 'conference-finals' | 'wildcard-bubble' | 'championship'
export const markPath = (mark: BlackGoldMark) => `${BLACK_GOLD_BASE}/marks/${mark}.svg`

export type CrestArt =
  | { kind: 'pack'; src: string }
  | { kind: 'composed'; frame: string; emblem: string; ink: string; tab: string; ribbon: string }

/**
 * The crest for one league (conference × division).
 *
 * ⚠ THE PACK CRESTS HAVE THEIR NAMES BAKED IN ("BLACK DIVISION", "SMOKE"), so they
 * are used only while the names still match the art: a Black/Gold side, an
 * unrenamed division, and a KB mascot conference whose name is that mascot. Rename
 * either and the crest is composed from the blank frame plus app-rendered text, so
 * the art never contradicts the name.
 */
export function crestFor(division: { name: string; sideId: string }, conference: { name: string; image: string }): CrestArt {
  const sideName = side(division.sideId).name
  const packDivision = ['black', 'gold'].includes(division.sideId) && slug(division.name) === slug(sideName)
  const packConference = KB_CONFERENCES.includes(conference.image as KbConference) && slug(conference.name) === conference.image
  const pack = packDivision && packConference ? imageFor(conference.image, division.sideId) : null
  if (pack) return { kind: 'pack', src: pack }
  return { kind: 'composed', frame: framePath(division.sideId), emblem: libraryPath(conference.image), ink: side(division.sideId).ink, tab: division.name, ribbon: conference.name }
}

/** Text-free banner art for a league, when the Black & Gold pack has one. Names are app-rendered over it. */
export function leagueBanner(division: { sideId: string }, conference: { image: string }): string | null {
  return bannerFor(conference.image, division.sideId)
}

/** Division mark: the buffalo marks for Black/Gold, otherwise the side's medallion. */
export function divisionMark(division: { sideId: string; emblem: string }): { kind: 'mark'; src: string } | { kind: 'ring'; ring: string; emblem: string } {
  if (division.sideId === 'black' && division.emblem === defaultEmblem('black')) return { kind: 'mark', src: markPath('black-buffalo') }
  if (division.sideId === 'gold' && division.emblem === defaultEmblem('gold')) return { kind: 'mark', src: markPath('gold-buffalo') }
  return { kind: 'ring', ring: ringPath(division.sideId), emblem: libraryPath(division.emblem) }
}
