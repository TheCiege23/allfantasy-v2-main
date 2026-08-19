import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toPrismaJsonInput } from '@/lib/prisma-json';
import {
  autoPublishApprovedShare,
  getSharePublishLogs,
} from '@/lib/social-sharing/SocialPublishService';

export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ shareId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { shareId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const approved = body.approved !== false;

  const share = await prisma.shareableMoment.findFirst({
    where: { id: shareId, userId: session.user.id },
  });
  if (!share) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const currentMeta = asRecord(share.metadata);
  const nextMeta: Record<string, unknown> = {
    ...currentMeta,
    approvedForPublish: approved,
    approvedAt: approved ? new Date().toISOString() : null,
  };

  await prisma.shareableMoment.update({
    where: { id: shareId },
    data: { metadata: toPrismaJsonInput(nextMeta) },
  });

  const autoPublishResults = approved
    ? await autoPublishApprovedShare(shareId, session.user.id)
    : [];
  const logs = await getSharePublishLogs(shareId, session.user.id);

  return NextResponse.json({
    shareId,
    approved,
    autoPublishResults,
    logs,
  });
}
