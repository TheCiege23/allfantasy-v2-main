import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { prisma } from '@/lib/prisma';
import { toPrismaJsonInput } from '@/lib/prisma-json';
import { ACHIEVEMENT_SHARE_TYPES } from '@/lib/social-sharing/types';
import type { AchievementShareType, AchievementShareContext } from '@/lib/social-sharing/types';
import { generateShareCopy, getTemplateShareCopy, isGrokShareConfigured } from '@/lib/social-sharing/GrokShareCopyService';
import { evaluateAiCostGate } from '@/lib/ai-protection/costGate';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const shareId = typeof body.shareId === 'string' ? body.shareId : null;
  const shareType = ACHIEVEMENT_SHARE_TYPES.includes(body.shareType as AchievementShareType)
    ? body.shareType
    : 'winning_matchup';
  const sport = normalizeToSupportedSport(body.sport);
  const context: AchievementShareContext = {
    leagueName: body.leagueName,
    leagueId: body.leagueId,
    score: body.score,
    opponentName: body.opponentName,
    week: body.week,
    teamName: body.teamName,
    bracketName: body.bracketName,
    rivalryName: body.rivalryName,
    playerName: body.playerName,
    rank: body.rank,
    tier: body.tier,
    sport,
  };

  const grokConfigured = isGrokShareConfigured();
  // Grok costs money per caption and nothing capped it. Over the cap the caption still
  // comes back — from the template, which is what an unconfigured Grok already returns —
  // so sharing, which brings people in, never fails on a limit.
  const aiAllowed = grokConfigured
    ? (await evaluateAiCostGate(req, 'share_copy', session.user.id)).ok
    : false;
  let fromGrok = false;
  let copy = aiAllowed
    ? await generateShareCopy(shareType as AchievementShareType, context, sport)
    : null;
  if (copy) fromGrok = true;
  if (!copy) copy = getTemplateShareCopy(shareType as AchievementShareType, context);

  if (shareId) {
    const existing = await prisma.shareableMoment.findFirst({
      where: { id: shareId, userId: session.user.id },
    });
    if (existing) {
      const metadata =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      await prisma.shareableMoment.update({
        where: { id: existing.id },
        data: {
          title: copy.headline,
          summary: copy.caption,
          metadata: toPrismaJsonInput({
            ...metadata,
            context,
            sport,
            grokCopy: copy,
          }),
        },
      });
    }
  }

  return NextResponse.json({
    caption: copy.caption,
    headline: copy.headline,
    cta: copy.cta,
    hashtags: copy.hashtags,
    platformVariants: copy.platformVariants,
    fromGrok,
  });
}
