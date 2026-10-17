import { z } from 'zod'
import catalog from './seasonArtworkCatalog.json'

export const seasonArtCatalog = catalog
export const seasonArtSides = Object.keys(catalog.sides) as Array<keyof typeof catalog.sides>
export const seasonArtEmblems = catalog.library.map(path => path.replace('library/', '').replace('.svg', ''))
const selectedArt = z.object({
  sideId: z.string().refine(id => seasonArtSides.includes(id as keyof typeof catalog.sides), 'Choose a supplied palette.'),
  emblemId: z.string().refine(id => seasonArtEmblems.includes(id), 'Choose a supplied emblem.'),
})
export const seasonArtworkSchema = z.object({ version: z.literal(1), divisions: z.array(selectedArt).max(8), leagues: z.array(selectedArt).max(24) })
export type SeasonArt = z.infer<typeof selectedArt>
export type SeasonArtwork = z.infer<typeof seasonArtworkSchema>
export function artPalette(sideId: string) {
  return catalog.sides[sideId as keyof typeof catalog.sides] ?? catalog.sides.gold
}
export function defaultSeasonArt(sideId: string): SeasonArt {
  const side = artPalette(sideId)
  return { sideId, emblemId: side.icon.replace('library/', '').replace('.svg', '') }
}
export function identityArt(config: { sport: string; divisions: string[]; artwork?: SeasonArtwork }, leagueIndex: number): SeasonArt {
  return config.artwork?.leagues[leagueIndex] ?? config.artwork?.divisions[leagueIndex % Math.max(1, config.divisions.length)] ?? { sideId: 'gold', emblemId: config.sport === 'NBA' ? 'basketball' : 'football' }
}
export function seasonArtPath(kind: 'frames' | 'rings' | 'medallions' | 'library', id: string) {
  const valid = kind === 'library' ? seasonArtEmblems.includes(id) : seasonArtSides.includes(id as keyof typeof catalog.sides)
  return '/artwork/tournaments/identity/' + kind + '/' + (valid ? id : kind === 'library' ? 'basketball' : 'gold') + '.svg'
}
export function seasonBannerPath(art: SeasonArt) {
  return ['black', 'gold'].includes(art.sideId) && ['beast', 'goat', 'grizz', 'kings', 'rebels', 'smoke', 'stealth', 'swamp', 'thunder', 'warrior'].includes(art.emblemId)
    ? '/artwork/tournaments/black-gold/banners/' + art.emblemId + '-' + art.sideId + '.svg' : null
}

/** Public presentation only: never pass an entire native settings/contract blob to the client. */
export function seasonLeaguePresentation(settings: unknown) {
  const parsed = z.object({ seasonTournament: z.object({ key: z.string().regex(/^stage-1-league-\d+$/), contract: z.object({ sport: z.enum(['NBA', 'NFL']), divisions: z.array(z.string()), leagueNames: z.array(z.string()), artwork: seasonArtworkSchema.optional() }) }) }).safeParse(settings)
  if (!parsed.success || !parsed.data.seasonTournament.contract.artwork) return undefined
  const { contract, key } = parsed.data.seasonTournament
  const index = Number(key.split('-').at(-1)) - 1
  if (index < 0 || index >= 24) return undefined
  return { art: identityArt(contract, index), division: contract.divisions[index % Math.max(1, contract.divisions.length)] ?? '', name: contract.leagueNames[index] ?? 'Opening League ' + String(index + 1).padStart(2, '0') }
}
