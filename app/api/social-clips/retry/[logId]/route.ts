import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { retryPublish } from '@/lib/social-clips-grok';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ logId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { logId } = await params;
  const result = await retryPublish(logId, session.user.id);
  if (!result) {
    return NextResponse.json({ error: 'Log not found or not allowed' }, { status: 404 });
  }
  return NextResponse.json(result);
}
