'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import type { MediaType } from '@/lib/media-generation/types'
import type { MediaGenerateResponse } from '@/lib/media-generation/types'
import type { MediaWorkflowAction } from '@/lib/media-generation/types'
import MediaPreviewPlayer from './MediaPreviewPlayer'
import MediaActionBar from './MediaActionBar'
import PublishConfirmationModal from './PublishConfirmationModal'
import { toast } from 'sonner'

const MEDIA_ENDPOINTS: Record<MediaType, string> = {
  podcast: '/api/media/podcast',
  video: '/api/media/video',
  blog: '/api/media/blog',
  social: '/api/media/social',
}

interface MediaGenerationPanelProps {
  type: MediaType
  /** Optional initial payload (sport, leagueName, etc.). */
  initialPayload?: Record<string, unknown>
  /** After publish (e.g. navigate). */
  onPublished?: () => void
  className?: string
}

/**
 * Full workflow: Generate → Preview → Approve → Publish.
 * Uses MediaPreviewPlayer, MediaActionBar, PublishConfirmationModal.
 */
export default function MediaGenerationPanel({
  type,
  initialPayload = {},
  onPublished,
  className = '',
}: MediaGenerationPanelProps) {
  const [result, setResult] = useState<MediaGenerateResponse | null>(null)
  const [generating, setGenerating] = useState(false)
  const [retryLoading, setRetryLoading] = useState(false)
  const [approveLoading, setApproveLoading] = useState(false)
  const [approved, setApproved] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishStatusLabel, setPublishStatusLabel] = useState<string | null>(null)

  const runWorkflowAction = useCallback(
    async (
      action: MediaWorkflowAction,
      payload?: Record<string, unknown>,
      options?: { includeInitialPayload?: boolean }
    ) => {
      const body =
        options?.includeInitialPayload === false
          ? { action, ...(payload ?? {}) }
          : { ...initialPayload, action, ...(payload ?? {}) }

      const res = await fetch(MEDIA_ENDPOINTS[type], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as MediaGenerateResponse & { error?: string }
      if (!res.ok) {
        throw new Error(data.error ?? 'Request failed')
      }
      return data
    },
    [type, initialPayload]
  )

  const generate = useCallback(
    async (isRetry = false) => {
      const setLoad = isRetry ? setRetryLoading : setGenerating
      setLoad(true)
      setResult(null)
      setApproved(false)
      setPublishStatusLabel(null)
      try {
        const data = await runWorkflowAction('generate')
        setResult(data)
        setApproved(Boolean(data.approved))
        if (data.status === 'completed' || data.status === 'draft') {
          toast.success('Generated.')
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Request failed')
      } finally {
        setLoad(false)
      }
    },
    [runWorkflowAction]
  )

  const handleRetry = useCallback(() => {
    generate(true)
  }, [generate])

  const handleApprove = useCallback(async () => {
    if (!result?.id) {
      toast.error('Nothing to approve yet.')
      return
    }
    setApproveLoading(true)
    try {
      const data = await runWorkflowAction(
        'approve',
        { id: result.id },
        { includeInitialPayload: false }
      )
      setResult((current) => (current ? { ...current, ...data } : data))
      setApproved(Boolean(data.approved) || true)
      toast.success('Approved for publish.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setApproveLoading(false)
    }
  }, [result?.id, runWorkflowAction])

  const handleDownload = useCallback(() => {
    const url = result?.playbackUrl ?? result?.previewUrl
    if (url) {
      const a = document.createElement('a')
      a.href = url
      a.download = result?.title ?? 'media'
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    } else {
      toast.info('Download when playback is ready.')
    }
  }, [result])

  const handleShare = useCallback(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const shareUrl =
      result?.shareUrl && result.shareUrl.startsWith('http')
        ? result.shareUrl
        : result?.shareUrl
          ? `${origin}${result.shareUrl.startsWith('/') ? result.shareUrl : `/${result.shareUrl}`}`
          : type === 'video'
            ? `${origin}/fantasy-media/${result?.id}`
            : type === 'podcast'
              ? `${origin}/podcast/${result?.id}`
              : type === 'social'
                ? `${origin}/social-clips/${result?.id}`
                : result?.articleSlug
                  ? `${origin}/blog/${result.articleSlug}`
                  : ''
    if (shareUrl && typeof navigator !== 'undefined') {
      if (navigator.share) {
        navigator.share({ title: result?.title ?? 'Content', url: shareUrl }).catch(() => {
          navigator.clipboard?.writeText(shareUrl).then(() => toast.success('Link copied.'))
        })
      } else {
        navigator.clipboard?.writeText(shareUrl).then(() => toast.success('Link copied.'))
      }
    } else {
      toast.info('Share when content is ready.')
    }
  }, [type, result])

  const handlePublishClick = useCallback(() => {
    if (!approved) {
      toast.info('Approve content before publishing.')
      return
    }
    setPublishOpen(true)
  }, [approved])

  const handlePublishConfirm = useCallback(async () => {
    if (!result?.id) {
      toast.error('Nothing to publish yet.')
      return
    }
    setPublishLoading(true)
    try {
      const data = await runWorkflowAction(
        'publish',
        { id: result.id, platform: 'x', destinationType: 'x' },
        { includeInitialPayload: false }
      )
      setResult((current) => (current ? { ...current, ...data } : data))
      const label = data.publishStatus
        ? `${data.publishStatus}: ${data.publishMessage ?? 'Publish requested'}`
        : data.publishMessage ?? 'Published.'
      setPublishStatusLabel(label)
      if (data.publishStatus && data.publishStatus !== 'success') {
        toast.error(data.publishMessage ?? 'Publish failed')
      } else {
        toast.success(data.publishMessage ?? 'Published.')
      }
      setPublishOpen(false)
      onPublished?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishLoading(false)
    }
  }, [result?.id, runWorkflowAction, onPublished])

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(result?.playbackUrl ?? result?.previewUrl ?? null)
  const [status, setStatus] = useState(result?.status ?? null)

  useEffect(() => {
    setPlaybackUrl(result?.playbackUrl ?? result?.previewUrl ?? null)
    setStatus(result?.status ?? null)
    setApproved(Boolean(result?.approved))
  }, [result])

  // Poll for HeyGen media while generating.
  useEffect(() => {
    if (!result?.id || result.status !== 'generating') return
    if (type !== 'video' && type !== 'podcast') return

    const t = setInterval(async () => {
      try {
        const data = await runWorkflowAction(
          'preview',
          { id: result.id },
          { includeInitialPayload: false }
        )
        if (data.status) setStatus(data.status)
        setPlaybackUrl(data.playbackUrl ?? data.previewUrl ?? null)
        setApproved(Boolean(data.approved))
        setResult((current) => (current ? { ...current, ...data } : data))
      } catch {
        // ignore
      }
    }, 5000)
    return () => clearInterval(t)
  }, [type, result?.id, result?.status, runWorkflowAction])

  const displayPlaybackUrl = playbackUrl ?? result?.playbackUrl ?? result?.previewUrl ?? null
  const displayStatus = status ?? result?.status ?? null

  return (
    <div className={`space-y-4 ${className}`}>
      {!result && !generating && (
        <button
          type="button"
          onClick={() => generate(false)}
          data-testid="media-generate-button"
          className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20"
        >
          Generate {type}
        </button>
      )}

      {generating && (
        <div
          className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200"
          data-testid="media-generating-state"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating…
        </div>
      )}

      {result && (
        <>
          <div
            className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-white/70"
            data-testid="media-provider-status"
          >
            <p>
              Provider: <span className="font-medium text-white/90">{result.provider ?? 'internal'}</span>
            </p>
            <p className="mt-1" data-testid="media-approval-status">
              Approval: <span className="font-medium text-white/90">{approved ? 'approved' : 'pending'}</span>
            </p>
            {publishStatusLabel && (
              <p className="mt-1 text-cyan-200" data-testid="media-publish-status-label">
                {publishStatusLabel}
              </p>
            )}
          </div>
          <MediaPreviewPlayer
            type={type}
            provider={result.provider}
            playbackUrl={displayPlaybackUrl}
            title={result.title}
            copy={result.previewText ?? result.title}
            status={displayStatus ?? undefined}
          />
          <MediaActionBar
            onRetry={handleRetry}
            retryLoading={retryLoading}
            onApprove={handleApprove}
            approveLoading={approveLoading}
            approved={approved}
            onDownload={type === 'video' || type === 'podcast' ? handleDownload : undefined}
            onShare={handleShare}
            onPublish={handlePublishClick}
            publishDisabled={!approved}
          />
        </>
      )}

      <PublishConfirmationModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={handlePublishConfirm}
        loading={publishLoading}
      />
    </div>
  )
}
