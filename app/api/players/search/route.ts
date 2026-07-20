import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit';

const querySchema = z.object({
  q: z.string().min(2),
  // Bounded deliberately: an unbounded `limit` lets a single request drain the
  // ~95k-row catalog, which would make any request-count limit below meaningless.
  // Real callers ask for 8; 50 leaves headroom.
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sport: z.string().trim().optional(),
});

export async function GET(req: Request) {
  // Unauthenticated catalog search over ~95k rows, driven by 250ms-debounced
  // autocomplete. `includeIpInKey` is load-bearing: without it the key collapses to
  // `players:search:user:anonymous` — a single window shared by the whole
  // deployment, which reads as a per-IP limit but self-DoSes every user at once.
  const rl = consumeRateLimit({
    scope: 'players',
    action: 'search',
    ip: getClientIp(req),
    includeIpInKey: true,
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.success) {
    return NextResponse.json(
      buildRateLimit429({ message: 'Search cooldown active. Please slow down.', rl }),
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  }

  const { q, limit, sport } = parsed.data;
  const sportUpper = sport?.toUpperCase();

  const players = await (prisma as any).sportsPlayer.findMany({
    where: {
      ...(sportUpper ? { sport: sportUpper } : {}),
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { position: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, position: true, team: true, imageUrl: true, sleeperId: true, age: true, number: true, college: true },
    take: limit,
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(players);
}
