import { createEpisode } from '@/lib/fantasy-media/FantasyMediaQueryService'
import { createHeyGenVideo, isHeyGenConfigured } from '@/lib/fantasy-media/HeyGenVideoService'
import { trackVideoJob } from '@/lib/fantasy-media/VideoGenerationJobTracker'
import type { MediaType } from '@/lib/fantasy-media/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

interface QueueLeagueEventVideoInput {
  userId: string
  leagueId: string
  leagueName?: string | null
  sport?: string | null
  title: string
  script: string
  contentType?: MediaType
  eventType: string
  eventPayload?: Record<string, unknown>
}

interface QueueLeagueEventVideoResult {
  ok: boolean
  reason?: 'not_configured' | 'invalid_input' | 'create_failed' | 'exception'
  episodeId?: string
  providerJobId?: string
}

function trimToLength(value: string, max: number): string {
  const input = value.trim()
  if (input.length <= max) return input
  return input.slice(0, max)
}

export async function queueLeagueEventVideo(
  input: QueueLeagueEventVideoInput
): Promise<QueueLeagueEventVideoResult> {
  if (!isHeyGenConfigured()) {
    return { ok: false, reason: 'not_configured' }
  }

  const title = trimToLength(input.title || '', 200)
  const script = (input.script || '').trim()
  if (!title || !script || !input.userId || !input.leagueId) {
    return { ok: false, reason: 'invalid_input' }
  }

  try {
    const sport = normalizeToSupportedSport(input.sport)
    const contentType: MediaType = input.contentType ?? 'league_recap'
    const created = await createHeyGenVideo({
      title,
      sport,
      contentType,
      script,
      language: 'en',
    })

    if (!created) {
      return { ok: false, reason: 'create_failed' }
    }

    const episode = await createEpisode({
      userId: input.userId,
      sport,
      leagueId: input.leagueId,
      mediaType: contentType,
      title,
      script,
      status: 'generating',
      provider: 'heygen',
      providerJobId: created.videoId,
      meta: {
        automated: true,
        eventType: input.eventType,
        leagueName: input.leagueName ?? null,
        eventPayload: input.eventPayload ?? null,
        heygen: created.payloadMetadata,
      },
    })

    void trackVideoJob(episode.id).catch((err) => {
      console.error('[event-video] trackVideoJob failed', episode.id, err)
    })

    return {
      ok: true,
      episodeId: episode.id,
      providerJobId: created.videoId,
    }
  } catch (error) {
    console.error('[event-video] queueLeagueEventVideo failed', {
      eventType: input.eventType,
      leagueId: input.leagueId,
      error,
    })
    return { ok: false, reason: 'exception' }
  }
}
