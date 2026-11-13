/**
 * Query and create fantasy media episodes (Prompt 115).
 */

import { prisma } from '@/lib/prisma';
import type { MediaType } from './types';

interface ListEpisodesInput {
  userId: string;
  mediaType?: MediaType | string;
  sport?: string;
  leagueId?: string | null;
  limit?: number;
}

export async function listEpisodes(input: ListEpisodesInput) {
  const where: { userId: string; mediaType?: string; sport?: string; leagueId?: string | null } = {
    userId: input.userId,
  };
  if (input.mediaType) where.mediaType = input.mediaType;
  if (input.sport) where.sport = input.sport;
  if (input.leagueId !== undefined) where.leagueId = input.leagueId;

  return prisma.fantasyMediaEpisode.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 50,
  });
}

export async function getEpisode(episodeId: string, userId?: string) {
  const where: { id: string; userId?: string } = { id: episodeId };
  if (userId) where.userId = userId;
  return prisma.fantasyMediaEpisode.findFirst({ where });
}

interface CreateEpisodeInput {
  userId: string;
  sport: string;
  leagueId?: string | null;
  mediaType: string;
  title: string;
  script: string;
  status?: string;
  provider?: string | null;
  providerJobId?: string | null;
  meta?: object;
}

export async function createEpisode(input: CreateEpisodeInput) {
  return prisma.fantasyMediaEpisode.create({
    data: {
      userId: input.userId,
      sport: input.sport,
      leagueId: input.leagueId ?? null,
      mediaType: input.mediaType,
      title: input.title,
      script: input.script,
      status: input.status ?? 'draft',
      provider: input.provider ?? null,
      providerJobId: input.providerJobId ?? null,
      meta: input.meta,
    },
  });
}

