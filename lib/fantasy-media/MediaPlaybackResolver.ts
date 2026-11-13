/**
 * Resolves playback URL for a fantasy media episode (HeyGen video or future podcast) (Prompt 115).
 */

import type { FantasyMediaEpisode } from '@prisma/client';

export function resolvePlaybackUrl(episode: FantasyMediaEpisode): string | null {
  if (episode.status === 'completed' && episode.playbackUrl) return episode.playbackUrl;
  return null;
}

