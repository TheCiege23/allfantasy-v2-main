import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { openaiChatJson } from '@/lib/openai-client';
import { getPlayerADP } from '@/lib/adp-data';
import { z } from 'zod';
import { buildNameIndex, normalizeMatchName, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch';
import { authoritativeRowsBySleeperId } from '@/lib/player-match/authoritativePlayerRow';

const requestSchema = z.object({
  playerName: z.string().min(1),
  position: z.string().optional(),
  leagueContext: z.string().optional(),
});

/*
 * DynastyTradeForm posts the asset LABEL, "Josh Allen (QB)", not a bare name — so the position the
 * form knows arrives inside `playerName`. Split it off; an explicit `position` field still wins.
 */
function splitNameAndPosition(raw: string, position?: string | null): { name: string; position: string | null } {
  const m = raw.trim().match(/^(.*\S)\s*\(([A-Za-z/]{1,6})\)$/);
  const name = m ? m[1]! : raw.trim();
  const pos = position?.trim() || (m ? m[2]!.toUpperCase() : null);
  return { name, position: pos };
}

/** DB pre-filter only: the asked name minus a trailing suffix, so "X Jr." still reaches "X Jr". */
function namePrefix(name: string): string {
  return name.trim().replace(/\s+(jr|sr|ii|iii|iv|v)\.?\s*$/i, '');
}

/*
 * 🛑 BOUND BY NAME, VERIFIED, NEVER `contains` + `findFirst` (2026-10-12). This read
 * `sport: 'nfl'` — 0 of 24,148 NFL rows match, all are stored 'NFL' — so GET always answered
 * not_found and POST never added DB context. Uppercasing alone would have shipped the worse bug
 * underneath: `contains` + an unordered findFirst picks whichever row Postgres returns first, and
 * "Michael Carter" matches four rows across RB 7607 (TEN) and CB 7835 (PHI, also "Michael Carter II").
 *
 * So: read every NFL row whose name could normalize to the asked one, collapse each Sleeper id to its
 * authoritative row (one athlete, many ingest sources — see `authoritativePlayerRow`), and bind with
 * `resolveVerifiedMatch` on the position the form sent. A shared name with no position is REFUSED.
 */
async function lookupPlayerContext(playerName: string, position: string | null) {
  try {
    const key = normalizeMatchName(playerName);
    if (!key) return null;
    const rows: Array<{
      source: string;
      sleeperId: string | null;
      name: string;
      position: string | null;
      team: string | null;
      age: number | null;
      status: string | null;
      fetchedAt: Date | null;
    }> = await (prisma as any).sportsPlayer.findMany({
      // `startsWith` reaches suffixed spellings ("Michael Carter II"); normalizeMatchName decides.
      where: { sport: 'NFL', name: { startsWith: namePrefix(playerName), mode: 'insensitive' }, sleeperId: { not: null } },
      select: { source: true, sleeperId: true, name: true, position: true, team: true, age: true, status: true, fetchedAt: true },
      take: 200,
    });
    const sameName = rows.filter((r) => normalizeMatchName(r.name) === key);
    const byId = authoritativeRowsBySleeperId(sameName);
    const { match } = resolveVerifiedMatch(buildNameIndex([...byId.values()]), { name: playerName, position });
    if (!match) return null;
    return { name: match.name, position: match.position, team: match.team, age: match.age, status: match.status };
  } catch {
    return null;
  }
}

/*
 * Same rule for the insight table: `contains` matched "Josh Allen" against any row whose name merely
 * held it. One row per (name, position) — newest season — then the same verified bind.
 */
async function lookupTradeInsight(playerName: string, position: string | null) {
  try {
    const key = normalizeMatchName(playerName);
    if (!key) return null;
    const rows: Array<{
      playerName: string | null;
      position: string | null;
      avgValueGiven: number | null;
      avgValueReceived: number | null;
      winRate: number | null;
      marketTrend: string | null;
      sampleSize: number;
    }> = await (prisma as any).tradeLearningInsight.findMany({
      where: { playerName: { startsWith: namePrefix(playerName), mode: 'insensitive' } },
      orderBy: { season: 'desc' },
      select: { playerName: true, position: true, avgValueGiven: true, avgValueReceived: true, winRate: true, marketTrend: true, sampleSize: true },
      take: 50,
    });
    const seen = new Set<string>();
    const candidates: Array<(typeof rows)[number] & { name: string }> = [];
    for (const r of rows) {
      if (normalizeMatchName(r.playerName) !== key) continue;
      const dedupe = String(r.position ?? '').toUpperCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      candidates.push({ ...r, name: r.playerName ?? '' });
    }
    // A PARTIAL list (21 named rows on 2026-10-12): a lone RB "Michael Carter" row is not the CB's.
    const { match } = resolveVerifiedMatch(
      buildNameIndex(candidates),
      { name: playerName, position },
      { refuseContradictedSingle: true },
    );
    if (!match) return null;
    const { avgValueGiven, avgValueReceived, winRate, marketTrend, sampleSize } = match;
    return { avgValueGiven, avgValueReceived, winRate, marketTrend, sampleSize };
  } catch {
    return null;
  }
}

/** The insight is keyed on position too: use the form's, else the position of the player we bound. */
async function lookupBoth(rawName: string, rawPosition?: string | null) {
  const { name, position } = splitNameAndPosition(rawName, rawPosition);
  const playerContext = await lookupPlayerContext(name, position);
  const tradeInsight = await lookupTradeInsight(name, position ?? playerContext?.position ?? null);
  return { playerContext, tradeInsight };
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const playerName = searchParams?.get('name');

  if (!playerName) {
    return NextResponse.json({ error: 'name parameter required' }, { status: 400 });
  }

  const { playerContext, tradeInsight } = await lookupBoth(playerName, searchParams?.get('position'));

  if (playerContext) {
    return NextResponse.json({
      name: playerContext.name,
      position: playerContext.position,
      team: playerContext.team,
      age: playerContext.age,
      status: playerContext.status,
      tradeInsight: tradeInsight || null,
      source: 'database',
    });
  }

  return NextResponse.json({ value: null, source: 'not_found' });
}

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

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Player name is required' }, { status: 400 });
  }

  const { playerName, position, leagueContext } = parsed.data;

  try {
    const { playerContext, tradeInsight } = await lookupBoth(playerName, position);

    let groundingContext = '';
    if (playerContext) {
      groundingContext += `\nDB Context: ${playerContext.name}, ${playerContext.position || 'unknown pos'}, ${playerContext.team || 'FA'}, age ${playerContext.age || 'unknown'}, status: ${playerContext.status || 'active'}`;
    }
    if (tradeInsight && tradeInsight.sampleSize > 0) {
      groundingContext += `\nTrade History: ${tradeInsight.sampleSize} trades observed, avg value given: ${tradeInsight.avgValueGiven?.toFixed(0) || '?'}, avg value received: ${tradeInsight.avgValueReceived?.toFixed(0) || '?'}, market trend: ${tradeInsight.marketTrend || 'unknown'}`;
    }

    let adpContext = '';
    try {
      const adpEntry = await getPlayerADP(playerName);
      if (adpEntry) {
        adpContext = `\nADP Data: ${adpEntry.name} (${adpEntry.position}) | ADP: ${adpEntry.adp.toFixed(1)}`;
        if (adpEntry.team) adpContext += ` | Team: ${adpEntry.team}`;
        if (adpEntry.value != null) adpContext += ` | Value: ${adpEntry.value.toFixed(0)}`;
        if (adpEntry.age != null) adpContext += ` | Age: ${adpEntry.age}`;
        if (adpEntry.adpTrend != null) {
          const dir = adpEntry.adpTrend > 0 ? 'falling' : adpEntry.adpTrend < 0 ? 'rising' : 'stable';
          adpContext += ` | Trend: ${dir}`;
        }
      }
    } catch {
      // ADP lookup is non-critical
    }

    const result = await openaiChatJson({
      messages: [
        {
          role: 'system',
          content: `You are a dynasty fantasy football trade value expert. Provide a quick dynasty trade value assessment for players. Use only provided data and your training data — never invent stats. Be concise and honest. When ADP data is provided, use it as primary valuation reference. Return ONLY valid JSON.`,
        },
        {
          role: 'user',
          content: `Quick dynasty value check for: ${playerName}${position ? ` (${position})` : ''}
${leagueContext ? `League: ${leagueContext}` : '12-team SF PPR dynasty'}${groundingContext}${adpContext}

Return JSON:
{
  "value": number from 1-100 (100 = elite like Mahomes in SF),
  "tier": "Elite" | "Star" | "Starter" | "Depth" | "Roster Clogger",
  "trend": "Rising" | "Stable" | "Declining",
  "summary": "1 sentence value summary",
  "comparables": ["1-2 similar-value players"]
}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 300,
    });

    if (!result.ok) {
      console.error('[player-value] AI error:', result.details);
      return NextResponse.json({ error: 'AI analysis failed' }, { status: 500 });
    }

    return NextResponse.json(result.json);
  } catch (err) {
    console.error('[player-value] Error:', err);
    return NextResponse.json({ error: 'Failed to get player value' }, { status: 500 });
  }
}

