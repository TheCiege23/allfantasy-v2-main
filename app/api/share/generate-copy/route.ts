import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { prisma } from '@/lib/prisma';
import { toPrismaJsonInput } from '@/lib/prisma-json';
import { ACHIEVEMENT_SHARE_TYPES } from '@/lib/social-sharing/types';
import type { AchievementShareType, AchievementShareContext } from '@/lib/social-sharing/types';
import { generateShareCopy, getTemplateShareCopy, isGrokShareConfigured } from '@/lib/social-sharing/GrokShareCopyService';

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
  let fromGrok = false;
  let copy = grokConfigured
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
