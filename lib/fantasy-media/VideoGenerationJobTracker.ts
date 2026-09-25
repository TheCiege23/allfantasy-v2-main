/**
 * Tracks HeyGen video jobs and updates FantasyMediaEpisode (Prompt 115).
 * Polls until completed/failed and persists playbackUrl or failure.
 */

import * as prismaJson from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma';
import { getHeyGenVideoStatus } from './HeyGenVideoService';

const POLL_INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistJobStatus(episodeId: string, data: {
  status: 'generating' | 'completed' | 'failed';
  playbackUrl?: string | null;
  meta?: Record<string, unknown>;
}) {
  await prisma.fantasyMediaEpisode.update({
    where: { id: episodeId },
    data: {
      status: data.status,
      playbackUrl: data.playbackUrl ?? null,
      meta: prismaJson.toPrismaNullableJsonInput(data.meta),
      updatedAt: new Date(),
    },
  });
}

export async function refreshVideoJobStatus(
  episodeId: string
): Promise<{ playbackUrl: string | null; status: 'generating' | 'completed' | 'failed' }> {
  const episode = await prisma.fantasyMediaEpisode.findUnique({ where: { id: episodeId } });
  if (!episode?.providerJobId || episode.provider !== 'heygen') {
    return {
      playbackUrl: episode?.playbackUrl ?? null,
      status: (episode?.status as 'generating' | 'completed' | 'failed') ?? 'failed',
    };
  }

  const status = await getHeyGenVideoStatus(episode.providerJobId);
  if (!status) {
    return {
      playbackUrl: episode.playbackUrl,
      status: (episode.status as 'generating' | 'completed' | 'failed') ?? 'generating',
    };
  }

  if (status.status === 'completed') {
    const playbackUrl = status.videoUrl ?? null;
    await persistJobStatus(episodeId, {
      status: 'completed',
      playbackUrl,
      meta: {
        duration: status.duration ?? null,
        thumbnailUrl: status.thumbnailUrl ?? null,
      },
    });
    return { playbackUrl, status: 'completed' };
  }

  if (status.status === 'failed') {
    await persistJobStatus(episodeId, {
      status: 'failed',
      playbackUrl: null,
      meta: {
        lastError: status.error?.message ?? status.error?.detail ?? 'HeyGen failed',
      },
    });
    return { playbackUrl: null, status: 'failed' };
  }

  await persistJobStatus(episodeId, {
    status: 'generating',
    playbackUrl: episode.playbackUrl,
    meta: episode.meta as Record<string, unknown> | undefined,
  });
  return { playbackUrl: episode.playbackUrl, status: 'generating' };
}

export async function trackVideoJob(episodeId: string): Promise<{ playbackUrl: string | null; status: string }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = await refreshVideoJobStatus(episodeId);
    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await persistJobStatus(episodeId, {
    status: 'failed',
    playbackUrl: null,
    meta: { lastError: 'HeyGen polling timeout' },
  });

  return { playbackUrl: null, status: 'failed' };
}
