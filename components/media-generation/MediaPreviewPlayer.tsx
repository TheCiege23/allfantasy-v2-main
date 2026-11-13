'use client'

import React from 'react'
import type { MediaType } from '@/lib/media-generation/types'

interface MediaPreviewPlayerProps {
  type: MediaType
  provider?: string
  /** Video or audio URL for playback. */
  playbackUrl?: string | null
  /** For blog: title or excerpt to show. */
  title?: string | null
  /** For social: copy or headline. */
  copy?: string | null
  /** Status to show when no URL yet (e.g. generating). */
  status?: string
  className?: string
}

/**
 * Preview player — video/audio element or text preview for blog/social.
 * Mandatory UI: preview player for Generate → Preview → Approve → Publish.
 */
export default function MediaPreviewPlayer({
  type,
  provider,
  playbackUrl,
  title,
  copy,
  status,
  className = '',
}: MediaPreviewPlayerProps) {
  const renderPodcastAsVideo = type === 'podcast' && provider === 'heygen'
  const canPlayVideo = (type === 'video' || renderPodcastAsVideo) && playbackUrl
  const canPlayAudio = type === 'podcast' && !renderPodcastAsVideo && playbackUrl

  return (
    <div
      className={`rounded-xl border border-white/10 bg-black/30 overflow-hidden ${className}`}
      data-media-type={type}
      data-testid="media-preview-player"
    >
      {(canPlayVideo || canPlayAudio) && (
        <>
          {canPlayVideo && (
            <video
              src={playbackUrl}
              controls
              playsInline
              className="w-full aspect-video"
              preload="metadata"
              data-testid="media-preview-video"
            >
              Your browser does not support video playback.
            </video>
          )}
          {canPlayAudio && (
            <audio src={playbackUrl} controls className="w-full" preload="metadata" data-testid="media-preview-audio">
              Your browser does not support audio playback.
            </audio>
          )}
        </>
      )}

      {!canPlayVideo && !canPlayAudio && status && (
        <div className="p-4 text-center text-sm text-white/60">
          {status === 'generating' && 'Generating…'}
          {status === 'failed' && 'Generation failed.'}
          {status === 'draft' && (type === 'blog' ? 'Draft saved. Preview in blog editor.' : 'Ready to approve.')}
        </div>
      )}

      {(type === 'blog' || type === 'social') && (title || copy) && (
        <div className="p-4 border-t border-white/10">
          {title && <p className="font-medium text-white/90">{title}</p>}
          {copy && <p className="mt-1 text-sm text-white/60 line-clamp-3">{copy}</p>}
        </div>
      )}
    </div>
  )
}
