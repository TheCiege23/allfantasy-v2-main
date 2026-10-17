import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const assetSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(200),
  type: z.enum(['player', 'pick']),
});

/*
 * 🛑 A share stores THE grade (2026-09-29, components/dynasty-trade/sharedTrade.ts) — and nothing of
 * the dual-brain engine's verdict. `winner` / `valueDelta` / `confidence` / `dynastyVerdict` /
 * `vetoRisk` are no longer accepted, so a stale client that still sends them stores none of them
 * (zod drops an unknown key). /trade/[id] never reads them from an old share either.
 */
const leagueGradeSchema = z.object({
  grade: z.string().max(4).nullable(),
  partnerGrade: z.string().max(4).nullable(),
  gradeLabel: z.string().max(200).nullable(),
  gradeWithheld: z.string().max(500).nullable(),
  giveValue: z.number().finite().nullable(),
  getValue: z.number().finite().nullable(),
});

const shareSchema = z.object({
  sideA: z.array(assetSchema).max(20),
  sideB: z.array(assetSchema).max(20),
  analysis: z.object({
    leagueGrade: leagueGradeSchema.nullable().optional(),
    factors: z.array(z.string()),
    agingConcerns: z.array(z.string()).optional(),
    recommendations: z.array(z.string()).optional(),
    teamAName: z.string().optional(),
    teamBName: z.string().optional(),
    leagueContext: z.string().optional(),
  }),
});

const SHARE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid trade data' }, { status: 400 });
  }

  try {
    const share = await (prisma as any).tradeShare.create({
      data: {
        userId: session.user.id,
        sideA: parsed.data.sideA,
        sideB: parsed.data.sideB,
        analysis: parsed.data.analysis,
        expiresAt: new Date(Date.now() + SHARE_TTL_MS),
      },
    });

    return NextResponse.json({ shareId: share.id });
  } catch (err) {
    console.error('[trade/share] Error:', err);
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
  }
}
