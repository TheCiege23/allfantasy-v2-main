/**
 * PROMPT 128 — AI Media Generation System. Unified response shape for /api/media/*.
 * Providers: HeyGen (video/podcast), Grok (social), OpenAI (blog).
 */

export type MediaType = 'podcast' | 'video' | 'blog' | 'social'
type MediaProvider = 'heygen' | 'grok' | 'openai' | 'internal'
export type MediaWorkflowAction = 'generate' | 'preview' | 'approve' | 'publish'

export interface MediaGenerateResponse {
  id: string
  type: MediaType
  status: 'generating' | 'completed' | 'failed' | 'draft'
  provider?: MediaProvider
  approved?: boolean
  title?: string
  /** Optional preview copy for text-first tools (blog/social). */
  previewText?: string | null
  /** Preview or playback URL (video/audio). */
  previewUrl?: string | null
  /** Same as previewUrl for video/audio. */
  playbackUrl?: string | null
  /** For blog: article slug or URL path. */
  articleSlug?: string | null
  /** For share-capable outputs (podcast/video/blog/social). */
  shareUrl?: string | null
  /** Provider job id (e.g. HeyGen video_id). */
  providerJobId?: string | null
  /** Publish workflow feedback. */
  publishStatus?: 'pending' | 'success' | 'failed' | 'provider_unavailable' | null
  publishMessage?: string | null
  createdAt?: string
  error?: string | null
}
