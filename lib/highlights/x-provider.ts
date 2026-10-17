import 'server-only'
import { z } from 'zod'
import { X_ACCOUNTS, type XPost } from './x-types'

const responseSchema = z.object({
  data: z.array(z.object({
    id: z.string(), text: z.string(), author_id: z.string(), created_at: z.string(),
    attachments: z.object({ media_keys: z.array(z.string()).optional() }).optional(),
    withheld: z.unknown().optional(),
  })).optional(),
  includes: z.object({
    users: z.array(z.object({ id: z.string(), username: z.string(), protected: z.boolean().optional() })).optional(),
    media: z.array(z.object({ media_key: z.string(), type: z.string() })).optional(),
  }).optional(),
  errors: z.array(z.unknown()).optional(),
})
export function xReadToken() {
  return process.env.X_HIGHLIGHTS_BEARER_TOKEN?.trim() || process.env.X_BEARER_TOKEN?.trim()
}
export function xHighlightsEnabled() {
  return process.env.X_HIGHLIGHTS_ENABLED === 'true' && Boolean(xReadToken())
}
export function classifyXPost(text: string): XPost['kind'] {
  if (/interview|reporter:|postgame|post-game|press conference|speaks|said after/i.test(text)) return 'interview'
  if (/brady|analysis|breaks down|impressed|discuss|explains|reaction/i.test(text)) return 'commentary'
  return 'play'
}
export function normalizeXResponse(raw: unknown): XPost[] {
  const result = responseSchema.parse(raw)
  if (result.errors?.length) throw new Error('Incomplete X response')
  const users = new Map(result.includes?.users?.filter(u => !u.protected).map(u => [u.id, u.username]))
  const videos = new Set(result.includes?.media?.filter(m => m.type === 'video' || m.type === 'animated_gif').map(m => m.media_key))
  return (result.data ?? []).flatMap(post => {
    const account = users.get(post.author_id)
    if (!account || post.withheld || !X_ACCOUNTS.some(a => a.toLowerCase() === account.toLowerCase()) ||
      !post.attachments?.media_keys?.some(key => videos.has(key)) || !/^\d{10,25}$/.test(post.id) ||
      !Number.isFinite(Date.parse(post.created_at))) return []
    return [{ id: post.id, account, text: post.text, publishedAt: new Date(post.created_at).toISOString(), kind: classifyXPost(post.text) }]
  })
}
export async function fetchRecentXPosts(now: Date): Promise<XPost[]> {
  const token = xReadToken()
  if (!token) throw new Error('X read credential missing')
  // One public source query, shared by every user. No player, league, or roster data leaves AllFantasy.
  const url = new URL('https://api.x.com/2/tweets/search/recent')
  url.searchParams.set('query', '(' + X_ACCOUNTS.map(a => 'from:' + a).join(' OR ') + ') has:videos -is:retweet -is:reply')
  url.searchParams.set('max_results', '10')
  url.searchParams.set('start_time', new Date(now.getTime() - 24 * 60 * 60_000).toISOString())
  url.searchParams.set('tweet.fields', 'author_id,created_at,attachments,withheld')
  url.searchParams.set('expansions', 'author_id,attachments.media_keys')
  url.searchParams.set('user.fields', 'username,protected')
  url.searchParams.set('media.fields', 'type')
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('X request failed')
  return normalizeXResponse(await response.json())
}

