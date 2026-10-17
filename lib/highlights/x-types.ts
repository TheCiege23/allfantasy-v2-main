import { z } from 'zod'

export const X_ACCOUNTS = ['NFL', 'BleacherReport', 'MySportsUpdate', 'FOXSports', 'NFLMemes', 'nflnetwork'] as const
export const xPostSchema = z.object({
  id: z.string().regex(/^\d{10,25}$/),
  account: z.string().refine(v => X_ACCOUNTS.some(a => a.toLowerCase() === v.toLowerCase())),
  text: z.string().min(1).max(5000),
  publishedAt: z.string().datetime(),
  kind: z.enum(['play', 'interview', 'commentary']),
})
export type XPost = z.infer<typeof xPostSchema>
export type ClipPlayer = { id: string; name: string }
export type MatchedXClip = XPost & {
  players: ClipPlayer[]
  leagues: Array<{ id: string; name: string }>
}
export type XClipsResult = {
  status: 'ready' | 'disabled' | 'unavailable'
  clips: MatchedXClip[]
  checkedAt: string | null
}
export const xCatalogSchema = z.object({
  posts: z.array(xPostSchema).max(200),
  checkedAt: z.string().datetime(),
})
export type XCatalog = z.infer<typeof xCatalogSchema>

