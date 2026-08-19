/**
 * Publishes shareable moments to connected social platforms (Prompt 121).
 * Uses provider adapters from the social-clips-grok stack.
 */

import { prisma } from '@/lib/prisma';
import { toPrismaJsonInput } from '@/lib/prisma-json';
import { getConnectedTargets } from '@/lib/social-clips-grok/ConnectedSocialAccountResolver';
import { getSocialProviderForPlatform } from '@/lib/social-clips-grok/publish-providers/registry';
import type { SocialPublishStatus } from '@/lib/social-clips-grok/publish-providers/types';
import type { SocialPlatform } from '@/lib/social-clips-grok/types';
import { SUPPORTED_PLATFORMS } from '@/lib/social-clips-grok/types';

const DUPLICATE_PENDING_WINDOW_MS = 60_000;
const DUPLICATE_SUCCESS_WINDOW_MS = 120_000;
const MAX_PUBLISH_TEXT_LENGTH = 280;
const REQUIRE_APPROVAL = process.env.SHARE_PUBLISH_REQUIRE_APPROVAL !== '0';

export type SharePublishStatus = SocialPublishStatus;

export interface SharePublishResult {
  platform: string;
  status: SharePublishStatus;
  logId: string;
  message?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').slice(0, max);
}

function buildPublishText(
  share: { title: string; summary: string; metadata: unknown },
  platform: SocialPlatform
): string {
  const metadata = asRecord(share.metadata);
  const grokCopy = asRecord(metadata.grokCopy);
  const platformVariants = asRecord(grokCopy.platformVariants);
  const platformVariant = asRecord(platformVariants[platform]);

  const variantCaption =
    typeof platformVariant.caption === 'string' && platformVariant.caption.trim().length > 0
      ? platformVariant.caption.trim()
      : null;

  const variantHashtags = readStringArray(platformVariant.hashtags);
  const defaultHashtags = readStringArray(grokCopy.hashtags);
  const hashtags = (variantHashtags.length > 0 ? variantHashtags : defaultHashtags).map((tag) =>
    tag.startsWith('#') ? tag : `#${tag}`
  );
  const baseCaption =
    variantCaption ??
    (typeof grokCopy.caption === 'string' && grokCopy.caption.trim().length > 0
      ? grokCopy.caption.trim()
      : share.summary.trim().length > 0
        ? share.summary
        : share.title);

  const text = [baseCaption, hashtags.join(' ')].filter(Boolean).join('\n').trim();
  return text.slice(0, MAX_PUBLISH_TEXT_LENGTH);
}

async function createPublishLog(input: {
  shareId: string;
  platform: string;
  status: SharePublishStatus;
  responseMetadata: Record<string, unknown>;
}): Promise<string> {
  const log = await prisma.sharePublishLog.create({
    data: {
      shareId: input.shareId,
      platform: input.platform,
      status: input.status,
      responseMetadata: toPrismaJsonInput(input.responseMetadata),
    },
  });
  return log.id;
}

async function getDuplicatePublishLog(
  shareId: string,
  platform: string
): Promise<{ id: string; status: SharePublishStatus } | null> {
  const latest = await prisma.sharePublishLog.findFirst({
    where: { shareId, platform },
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

export async function publishShareToPlatform(
  shareId: string,
  platform: string,
  userId: string,
  mode: 'manual' | 'auto' = 'manual'
): Promise<SharePublishResult> {
  const normalizedPlatform = platform.toLowerCase();

  const share = await prisma.shareableMoment.findFirst({
    where: { id: shareId, userId },
  });
  if (!share) {
    return { platform: normalizedPlatform, status: 'failed', logId: '', message: 'Share not found' };
  }

  if (!SUPPORTED_PLATFORMS.includes(normalizedPlatform as SocialPlatform)) {
    const logId = await createPublishLog({
      shareId,
      platform: normalizedPlatform,
      status: 'failed',
      responseMetadata: { reason: 'unsupported_platform', mode },
    });
    return { platform: normalizedPlatform, status: 'failed', logId, message: 'Unsupported platform' };
  }

  const duplicateLog = await getDuplicatePublishLog(shareId, normalizedPlatform);
  if (duplicateLog) {
    return {
      platform: normalizedPlatform,
      status: duplicateLog.status,
      logId: duplicateLog.id,
      message: duplicateLog.status === 'pending' ? 'Publish already in progress' : 'Already published recently',
    };
  }

  if (REQUIRE_APPROVAL) {
    const metadata = asRecord(share.metadata);
    if (!metadata.approvedForPublish) {
      const logId = await createPublishLog({
        shareId,
        platform: normalizedPlatform,
        status: 'failed',
        responseMetadata: { reason: 'not_approved_for_publish', mode },
      });
      return {
        platform: normalizedPlatform,
        status: 'failed',
        logId,
        message: 'Approve this share before publishing',
      };
    }
  }

  const targets = await getConnectedTargets(userId);
  const target = targets.find((entry) => entry.platform === normalizedPlatform);
  if (!target?.connected) {
    const logId = await createPublishLog({
      shareId,
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
      shareId,
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
      shareId,
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

  const publishText = buildPublishText(share, platformKey);
  const providerResult = await provider.publish({
    assetId: share.id,
    userId,
    platform: platformKey,
    mode,
    publishText,
    assetTitle: share.title,
    assetMetadata: asRecord(share.metadata),
    target,
  });

  const logId = await createPublishLog({
    shareId: share.id,
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

export async function autoPublishApprovedShare(
  shareId: string,
  userId: string
): Promise<SharePublishResult[]> {
  const targets = await getConnectedTargets(userId);
  const eligibleTargets = targets.filter((target) => target.connected && target.autoPostingEnabled);
  if (eligibleTargets.length === 0) return [];

  const results: SharePublishResult[] = [];
  for (const target of eligibleTargets) {
    const result = await publishShareToPlatform(shareId, target.platform, userId, 'auto');
    results.push(result);
  }
  return results;
}

export async function retrySharePublish(logId: string, userId: string): Promise<SharePublishResult | null> {
  const log = await prisma.sharePublishLog.findFirst({
    where: { id: logId },
    include: { share: true },
  });
  if (!log || log.share.userId !== userId) return null;
  return publishShareToPlatform(log.shareId, log.platform, userId, 'manual');
}

export async function getSharePublishLogs(shareId: string, userId: string) {
  const share = await prisma.shareableMoment.findFirst({
    where: { id: shareId, userId },
    include: { publishLogs: { orderBy: { createdAt: 'desc' }, take: 40 } },
  });
  return share?.publishLogs ?? [];
}
