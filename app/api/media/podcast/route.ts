/**
 * POST /api/media/podcast — Fantasy Podcast Generator.
 * Generate → Preview → Approve → Publish. Provider: HeyGen (primary), internal audio fallback.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServedOrigin } from '@/lib/http/served-origin'
import { generateFantasyPodcastScript } from '@/lib/podcast-engine/FantasyPodcastGenerator'
import { synthesizeScriptToAudio } from '@/lib/podcast-engine/VoiceSynthesisService'
import {
  createEpisode,
  getEpisode as getPodcastEpisode,
  getPlaybackUrl,
  getShareUrl,
} from '@/lib/podcast-engine/PodcastDistributionService'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { createHeyGenVideo, isHeyGenConfigured } from '@/lib/fantasy-media/HeyGenVideoService'
import { createEpisode as createMediaEpisode, getEpisode as getMediaEpisode } from '@/lib/fantasy-media/FantasyMediaQueryService'
import { trackVideoJob, refreshVideoJobStatus } from '@/lib/fantasy-media/VideoGenerationJobTracker'
import { resolvePlaybackUrl } from '@/lib/fantasy-media/MediaPlaybackResolver'
import { publishFantasyMediaEpisode } from '@/lib/fantasy-media/FantasyMediaPublishService'
import { MEDIA_TYPES, type MediaType as MediaContentType } from '@/lib/fantasy-media/types'
import { prisma } from '@/lib/prisma'
import type { MediaWorkflowAction } from '@/lib/media-generation/types'

export const dynamic = 'force-dynamic'

function getWorkflowAction(raw: unknown): MediaWorkflowAction {
  const value = typeof raw === 'string' ? raw.toLowerCase().trim() : 'generate'
  if (value === 'preview') return 'preview'
  if (value === 'approve') return 'approve'
  if (value === 'publish') return 'publish'
  return 'generate'
}

function asMetaObject(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  return meta as Record<string, unknown>
}

function isApproved(meta: unknown): boolean {
  const m = asMetaObject(meta)
  const workflow = asMetaObject(m.workflow)
  return typeof workflow.approvedAt === 'string' && workflow.approvedAt.length > 0
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const action = getWorkflowAction(body.action)

  if (action === 'preview') {
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) return NextResponse.json({ error: 'Episode id is required' }, { status: 400 })

    const mediaEpisode = await getMediaEpisode(id, session.user.id)
    if (mediaEpisode) {
      if (mediaEpisode.status === 'generating' && mediaEpisode.providerJobId) {
        await refreshVideoJobStatus(mediaEpisode.id).catch(() => null)
      }
      const refreshed = (await getMediaEpisode(id, session.user.id)) ?? mediaEpisode
      return NextResponse.json({
        id: refreshed.id,
        type: 'podcast' as const,
        provider: 'heygen' as const,
        status: refreshed.status,
        title: refreshed.title,
        approved: isApproved(refreshed.meta),
        playbackUrl: resolvePlaybackUrl(refreshed),
        previewUrl: resolvePlaybackUrl(refreshed),
        shareUrl: `/fantasy-media/${refreshed.id}`,
        createdAt: refreshed.createdAt?.toISOString?.() ?? new Date().toISOString(),
      })
    }

    const podcastEpisode = await getPodcastEpisode(id, session.user.id)
    if (!podcastEpisode) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const baseUrl = process.env.NEXTAUTH_URL ?? getServedOrigin(req)

    return NextResponse.json({
      id: podcastEpisode.id,
      type: 'podcast' as const,
      provider: 'internal' as const,
      status: 'completed' as const,
      approved: true,
      title: podcastEpisode.title,
      playbackUrl: getPlaybackUrl(podcastEpisode),
      previewUrl: getPlaybackUrl(podcastEpisode),
      shareUrl: getShareUrl(podcastEpisode.id, baseUrl || 'https://allfantasy.ai'),
      createdAt: podcastEpisode.createdAt?.toISOString?.() ?? new Date().toISOString(),
    })
  }

  if (action === 'approve') {
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) return NextResponse.json({ error: 'Episode id is required' }, { status: 400 })

    const mediaEpisode = await getMediaEpisode(id, session.user.id)
    if (mediaEpisode) {
      const currentMeta = asMetaObject(mediaEpisode.meta)
      const workflowMeta = asMetaObject(currentMeta.workflow)
      const updated = await prisma.fantasyMediaEpisode.update({
        where: { id: mediaEpisode.id },
        data: {
          meta: {
            ...currentMeta,
            workflow: {
              ...workflowMeta,
              approvedAt: new Date().toISOString(),
              approvedBy: session.user.id,
            },
          },
        },
      })
      return NextResponse.json({
        id: updated.id,
        type: 'podcast' as const,
        provider: 'heygen' as const,
        status: updated.status,
        approved: true,
        title: updated.title,
        playbackUrl: resolvePlaybackUrl(updated),
        previewUrl: resolvePlaybackUrl(updated),
        shareUrl: `/fantasy-media/${updated.id}`,
        createdAt: updated.createdAt.toISOString(),
      })
    }

    const podcastEpisode = await getPodcastEpisode(id, session.user.id)
    if (!podcastEpisode) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const baseUrl = process.env.NEXTAUTH_URL ?? getServedOrigin(req)
    return NextResponse.json({
      id: podcastEpisode.id,
      type: 'podcast' as const,
      provider: 'internal' as const,
      status: 'completed' as const,
      approved: true,
      title: podcastEpisode.title,
      playbackUrl: getPlaybackUrl(podcastEpisode),
      previewUrl: getPlaybackUrl(podcastEpisode),
      shareUrl: getShareUrl(podcastEpisode.id, baseUrl || 'https://allfantasy.ai'),
      createdAt: podcastEpisode.createdAt?.toISOString?.() ?? new Date().toISOString(),
    })
  }

  if (action === 'publish') {
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) return NextResponse.json({ error: 'Episode id is required' }, { status: 400 })

    const destinationType =
      typeof body.destinationType === 'string' && body.destinationType.trim().length > 0
        ? body.destinationType.trim().toLowerCase()
        : 'x'

    const mediaEpisode = await getMediaEpisode(id, session.user.id)
    if (mediaEpisode) {
      if (!isApproved(mediaEpisode.meta)) {
        return NextResponse.json({ error: 'Approve the media before publishing' }, { status: 400 })
      }
      const published = await publishFantasyMediaEpisode(id, destinationType, session.user.id)
      return NextResponse.json(
        {
          id,
          type: 'podcast' as const,
          provider: 'heygen' as const,
          status: mediaEpisode.status,
          approved: isApproved(mediaEpisode.meta),
          title: mediaEpisode.title,
          playbackUrl: resolvePlaybackUrl(mediaEpisode),
          previewUrl: resolvePlaybackUrl(mediaEpisode),
          shareUrl: `/fantasy-media/${mediaEpisode.id}`,
          publishStatus: published.status,
          publishMessage: published.message ?? null,
        },
        { status: published.publishId ? 200 : 404 }
      )
    }

    const podcastEpisode = await getPodcastEpisode(id, session.user.id)
    if (!podcastEpisode) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const baseUrl = process.env.NEXTAUTH_URL ?? getServedOrigin(req)

    return NextResponse.json({
      id: podcastEpisode.id,
      type: 'podcast' as const,
      provider: 'internal' as const,
      status: 'completed' as const,
      approved: true,
      title: podcastEpisode.title,
      playbackUrl: getPlaybackUrl(podcastEpisode),
      previewUrl: getPlaybackUrl(podcastEpisode),
      shareUrl: getShareUrl(podcastEpisode.id, baseUrl || 'https://allfantasy.ai'),
      publishStatus: 'success' as const,
      publishMessage: 'Published to podcast library.',
      createdAt: podcastEpisode.createdAt?.toISOString?.() ?? new Date().toISOString(),
    })
  }

  const options = {
    leagueName: body.leagueName,
    sport: body.sport ? normalizeToSupportedSport(body.sport) : undefined,
    weekLabel: body.weekLabel,
  }

  try {
    const { title, script } = generateFantasyPodcastScript(options)

    const sport = normalizeToSupportedSport(body.sport)
    const contentType = MEDIA_TYPES.includes(body.contentType as MediaContentType)
      ? (body.contentType as MediaContentType)
      : 'weekly_recap'

    if (isHeyGenConfigured()) {
      const createResult = await createHeyGenVideo({
        title,
        script,
        sport,
        contentType,
        language: body.language,
        durationTargetSeconds: body.durationTargetSeconds,
        toneStyle: body.toneStyle,
        brandingInstructions: body.brandingInstructions,
      })

      if (createResult) {
        const mediaEpisode = await createMediaEpisode({
          userId: session.user.id,
          sport,
          leagueId: body.leagueId ?? null,
          mediaType: contentType,
          title,
          script,
          status: 'generating',
          provider: 'heygen',
          providerJobId: createResult.videoId,
          meta: {
            workflow: { tool: 'podcast' },
            heygen: createResult.payloadMetadata,
          },
        })

        void trackVideoJob(mediaEpisode.id).catch((err) => {
          console.error('[media/podcast] trackVideoJob failed', mediaEpisode.id, err)
        })

        return NextResponse.json({
          id: mediaEpisode.id,
          type: 'podcast' as const,
          provider: 'heygen' as const,
          status: 'generating' as const,
          approved: false,
          title: mediaEpisode.title,
          shareUrl: `/fantasy-media/${mediaEpisode.id}`,
          providerJobId: createResult.videoId,
          createdAt: mediaEpisode.createdAt?.toISOString?.() ?? new Date().toISOString(),
        })
      }
    }

    const synthesis = await synthesizeScriptToAudio(script)

    const episode = await createEpisode({
      userId: session.user.id,
      title,
      script,
      audioUrl: synthesis.audioUrl,
      durationSeconds: synthesis.durationSeconds ?? null,
    })

    if (!episode) {
      return NextResponse.json(
        { id: '', type: 'podcast', status: 'failed', error: 'Failed to create episode' },
        { status: 500 }
      )
    }

    const playbackUrl = getPlaybackUrl(episode)
    const baseUrl = process.env.NEXTAUTH_URL ?? getServedOrigin(req)

    const response = {
      id: episode.id,
      type: 'podcast' as const,
      provider: 'internal' as const,
      status: 'completed' as const,
      approved: true,
      title: episode.title,
      previewUrl: playbackUrl ?? null,
      playbackUrl: playbackUrl ?? null,
      shareUrl: getShareUrl(episode.id, baseUrl || 'https://allfantasy.ai'),
      createdAt: episode.createdAt?.toISOString?.() ?? new Date().toISOString(),
    }
    return NextResponse.json(response)
  } catch (e) {
    console.error('[media/podcast]', e)
    return NextResponse.json(
      {
        id: '',
        type: 'podcast',
        status: 'failed',
        error: e instanceof Error ? e.message : 'Podcast generation failed',
      },
      { status: 500 }
    )
  }
}
