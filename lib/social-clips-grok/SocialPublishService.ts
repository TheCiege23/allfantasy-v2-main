/**
 * Publishes social content to platforms (Prompt 116).
 * Supports manual publish + optional auto-post mode with adapter routing.
 */

import { prisma } from '@/lib/prisma';
import { toPrismaJsonInput } from '@/lib/prisma-json';
import { getConnectedTargets } from './ConnectedSocialAccountResolver';
import type { SocialPlatform } from './types';
import { SUPPORTED_PLATFORMS } from './types';
import { getSocialProviderForPlatform } from './publish-providers/registry';
import type { SocialPublishStatus } from './publish-providers/types';

const DUPLICATE_PENDING_WINDOW_MS = 60_000;
const DUPLICATE_SUCCESS_WINDOW_MS = 120_000;
const MAX_PUBLISH_TEXT_LENGTH = 280;

export type PublishStatus = SocialPublishStatus;

export interface PublishResult {
  platform: string;
  status: PublishStatus;
  logId: string;
  message?: string;
}

function asMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function buildPublishText(asset: {
  title: string;
  metadata: unknown;
}, platform: SocialPlatform): string {
  const metadata = asMetadataObject(asset.metadata);
  const platformVariants = asMetadataObject(metadata.platformVariants);
  const platformVariant = asMetadataObject(platformVariants[platform]);
  const variantCaption =
    typeof platformVariant.caption === 'string' && platformVariant.caption.trim()
      ? platformVariant.caption.trim()
      : null;
  const variantHashtags = Array.isArray(platformVariant.hashtags)
    ? platformVariant.hashtags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8)
    : [];
  const shortCaption =
    typeof metadata.shortCaption === 'string' && metadata.shortCaption.trim()
      ? metadata.shortCaption.trim()
      : asset.title;
  const hashtags = Array.isArray(metadata.hashtags)
    ? metadata.hashtags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8)
    : [];
  const combinedTags = (variantHashtags.length > 0 ? variantHashtags : hashtags).join(' ');
  const base = variantCaption ?? shortCaption;
  const combined = [base, combinedTags].filter(Boolean).join('\n').trim();
  return combined.slice(0, MAX_PUBLISH_TEXT_LENGTH);
}

async function createPublishLog(input: {
  assetId: string;
  platform: string;
  status: PublishStatus;
  responseMetadata: Record<string, unknown>;
}): Promise<string> {
  const log = await prisma.socialPublishLog.create({
    data: {
      assetId: input.assetId,
      platform: input.platform,
      status: input.status,
      responseMetadata: toPrismaJsonInput(input.responseMetadata),
    },
  });
  return log.id;
}

async function getDuplicatePublishLog(
  assetId: string,
  platform: string
): Promise<{ id: string; status: PublishStatus } | null> {
  const latest = await prisma.socialPublishLog.findFirst({
    where: { assetId, platform },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) return null;
  const ageMs = Date.now() - latest.createdAt.getTime();
  if (latest.status === 'pending' && ageMs <= DUPLICATE_PENDING_WINDOW_MS) {
    return { id: latest.id, status: 'pending' };
  }
  if (latest.status === 'success' && ageMs <= DUPLICATE_SUCCESS_WINDOW_MS) {
    return { id: latest.id, status: 'success' };
  }
  return null;
}

export async function publishAssetToPlatform(
  assetId: string,
  platform: string,
  userId: string,
  mode: 'manual' | 'auto' = 'manual'
): Promise<PublishResult> {
  const normalizedPlatform = platform.toLowerCase();
  if (!SUPPORTED_PLATFORMS.includes(normalizedPlatform as SocialPlatform)) {
    const logId = await createPublishLog({
      assetId,
      platform: normalizedPlatform,
      status: 'failed',
      responseMetadata: { reason: 'unsupported_platform', mode },
    });
    return { platform: normalizedPlatform, status: 'failed', logId, message: 'Unsupported platform' };
  }

  const duplicateLog = await getDuplicatePublishLog(assetId, normalizedPlatform);
  if (duplicateLog) {
    return {
      platform: normalizedPlatform,
      status: duplicateLog.status,
      logId: duplicateLog.id,
      message: duplicateLog.status === 'pending' ? 'Publish already in progress' : 'Already published recently',
    };
  }

  const asset = await prisma.socialContentAsset.findFirst({
    where: { id: assetId, userId },
  });
  if (!asset) {
    return { platform: normalizedPlatform, status: 'failed', logId: '', message: 'Asset not found' };
  }

  const targets = await getConnectedTargets(userId);
  const target = targets.find((t) => t.platform === normalizedPlatform);
  if (!target?.connected) {
    const logId = await createPublishLog({
      assetId,
      platform: normalizedPlatform,
      status: 'failed',
      responseMetadata: { reason: 'account_not_connected', mode },
    });
    return {
      platform: normalizedPlatform,
      status: 'failed',
      logId,
      message: 'Connect your account first',
    };
  }

  const platformKey = normalizedPlatform as SocialPlatform;
  const provider = getSocialProviderForPlatform(platformKey);
  if (!provider) {
    const logId = await createPublishLog({
      assetId,
      platform: normalizedPlatform,
      status: 'provider_unavailable',
      responseMetadata: { reason: 'provider_not_found', mode },
    });
    return {
      platform: normalizedPlatform,
      status: 'provider_unavailable',
      logId,
      message: 'No provider adapter available for this platform',
    };
  }

  if (!provider.isConfigured(platformKey)) {
    const logId = await createPublishLog({
      assetId,
      platform: normalizedPlatform,
      status: 'provider_unavailable',
      responseMetadata: { reason: 'provider_not_configured', providerId: provider.id, mode },
    });
    return {
      platform: normalizedPlatform,
      status: 'provider_unavailable',
      logId,
      message: 'Posting not configured for this platform yet',
    };
  }

  const publishText = buildPublishText(asset, platformKey);
  const providerResult = await provider.publish({
    assetId,
    userId,
    platform: platformKey,
    mode,
    publishText,
    assetTitle: asset.title,
    assetMetadata: asMetadataObject(asset.metadata),
    target,
  });

  const logId = await createPublishLog({
    assetId,
    platform: normalizedPlatform,
    status: providerResult.status,
    responseMetadata: {
      providerId: provider.id,
      mode,
      ...(providerResult.responseMetadata ?? {}),
    },
  });
  return {
    platform: normalizedPlatform,
    status: providerResult.status,
    logId,
    message: providerResult.message,
  };
}

export async function autoPublishApprovedAsset(
  assetId: string,
  userId: string
): Promise<PublishResult[]> {
  const targets = await getConnectedTargets(userId);
  const eligible = targets.filter((target) => target.connected && target.autoPostingEnabled);
  if (eligible.length === 0) return [];

  const results: PublishResult[] = [];
  for (const target of eligible) {
    const result = await publishAssetToPlatform(assetId, target.platform, userId, 'auto');
    results.push(result);
  }
  return results;
}

export async function retryPublish(logId: string, userId: string): Promise<PublishResult | null> {
  const log = await prisma.socialPublishLog.findFirst({
    where: { id: logId },
    include: { asset: true },
  });
  if (!log || log.asset.userId !== userId) return null;
  return publishAssetToPlatform(log.assetId, log.platform, userId);
}
