import { prisma } from '@/lib/prisma';

export interface ADPEntry {
  name: string;
  position: string;
  team: string | null;
  adp: number;
  adpFormatted: string | null;
  adpTrend: number | null;
  age: number | null;
  value: number | null;
  source: 'analytics' | 'devy' | 'ffc' | 'ktc' | 'rookie-db';
  ffcPlayerId: number | null;
  timesDrafted: number | null;
  adpHigh: number | null;
  adpLow: number | null;
  adpStdev: number | null;
  bye: number | null;
}

export interface FFCMeta {
  type: string;
  teams: number;
  rounds: number;
  totalDrafts: number;
  startDate: string;
  endDate: string;
}

export type FFCScoringFormat = 'standard' | 'ppr' | 'half-ppr' | '2qb' | 'dynasty' | 'rookie';

const FFC_FORMAT_MAP: Record<string, FFCScoringFormat> = {
  dynasty: 'dynasty',
  redraft: 'standard',
};

let adpCache: { data: ADPEntry[]; ts: number; type: string } | null = null;

/**
 * Force-invalidate both the in-memory and DB-cached ADP entries so the next
 * `getLiveADP` call re-fetches FFC + analytics fresh. Used by the commissioner
 * "Refresh ADP" action when the pool's ADP column is empty/stale.
 */
export async function invalidateAdpCache(): Promise<{ deleted: number }> {
  adpCache = null;
  try {
    const [multi, ffc] = await Promise.all([
      prisma.sportsDataCache.deleteMany({ where: { cacheKey: { startsWith: 'adp-multi-' } } }),
      prisma.sportsDataCache.deleteMany({ where: { cacheKey: { startsWith: 'ffc-adp-' } } }),
    ]);
    return { deleted: multi.count + ffc.count };
  } catch {
    return { deleted: 0 };
  }
}
const CACHE_TTL = 5 * 60 * 1000;
const DB_CACHE_TTL = 1000 * 60 * 60 * 24;

export async function fetchFFCADP(
  format: FFCScoringFormat = 'standard',
  teams: number = 12,
  year?: number
): Promise<{ players: ADPEntry[]; meta: FFCMeta | null }> {
  const ffcYear = year || new Date().getFullYear();
  const cacheKey = `ffc-adp-${format}-${teams}-${ffcYear}`;

  try {
    const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } });
    if (cached && new Date(cached.expiresAt) > new Date()) {
      const parsed = cached.data as any;
      return { players: parsed.players || [], meta: parsed.meta || null };
    }
  } catch {}

  try {
    const res = await fetch(
      `https://fantasyfootballcalculator.com/api/v1/adp/${format}?teams=${teams}&year=${ffcYear}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      console.log(`[ffc] API returned ${res.status} for format=${format}`);
      return { players: [], meta: null };
    }

    const raw = await res.json();
    const rawPlayers = Array.isArray(raw) ? raw : (raw?.players || []);
    const rawMeta = raw?.meta || {};

    const meta: FFCMeta = {
      type: rawMeta.type || format,
      teams: rawMeta.teams || teams,
      rounds: rawMeta.rounds || 15,
      totalDrafts: rawMeta.total_drafts || 0,
      startDate: rawMeta.start_date || '',
      endDate: rawMeta.end_date || '',
    };

    const players: ADPEntry[] = [];
    for (const p of rawPlayers) {
      if (!p.name || !p.position) continue;
      players.push({
        name: p.name,
        position: p.position,
        team: p.team || null,
        adp: p.adp ?? 999,
        adpFormatted: p.adp_formatted || null,
        adpTrend: null,
        age: null,
        value: null,
        source: 'ffc',
        ffcPlayerId: p.player_id || null,
        timesDrafted: p.times_drafted ?? null,
        adpHigh: p.high ?? null,
        adpLow: p.low ?? null,
        adpStdev: p.stdev ?? null,
        bye: p.bye ?? null,
      });
    }

    try {
      await prisma.sportsDataCache.upsert({
        where: { cacheKey },
        update: { data: { players, meta } as any, expiresAt: new Date(Date.now() + DB_CACHE_TTL) },
        create: { cacheKey, data: { players, meta } as any, expiresAt: new Date(Date.now() + DB_CACHE_TTL) },
      });
    } catch {}

    return { players, meta };
  } catch (err) {
    console.log(`[ffc] API fetch failed for format=${format}:`, err instanceof Error ? err.message : err);
    return { players: [], meta: null };
  }
}

export async function fetchAllFFCFormats(teams: number = 12): Promise<Record<FFCScoringFormat, { players: ADPEntry[]; meta: FFCMeta | null }>> {
  const formats: FFCScoringFormat[] = ['standard', 'ppr', 'half-ppr', '2qb', 'dynasty', 'rookie'];
  const results = await Promise.allSettled(
    formats.map(f => fetchFFCADP(f, teams))
  );

  const out: Record<string, { players: ADPEntry[]; meta: FFCMeta | null }> = {};
  formats.forEach((f, i) => {
    const r = results[i];
    out[f] = r.status === 'fulfilled' ? r.value : { players: [], meta: null };
  });
  return out as Record<FFCScoringFormat, { players: ADPEntry[]; meta: FFCMeta | null }>;
}

export async function getLiveADP(
  type: 'dynasty' | 'redraft' | 'devy' = 'dynasty',
  limit = 150
): Promise<ADPEntry[]> {
  if (type === 'devy') {
    return getDevyADP(limit);
  }

  if (adpCache && adpCache.type === type && Date.now() - adpCache.ts < CACHE_TTL) {
    return adpCache.data.slice(0, limit);
  }

  const dbCacheKey = `adp-multi-${type}-${new Date().toISOString().slice(0, 10)}`;
  try {
    const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey: dbCacheKey } });
    if (cached && new Date(cached.expiresAt) > new Date()) {
      const data = cached.data as unknown as ADPEntry[];
      adpCache = { data, ts: Date.now(), type };
      return data.slice(0, limit);
    }
  } catch {}

  const entries: ADPEntry[] = [];

  const analyticsPlayers = await (prisma as any).playerAnalyticsSnapshot.findMany({
    where: {
      currentAdp: { not: null },
      position: { in: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST'] },
    },
    select: {
      name: true,
      position: true,
      currentTeam: true,
      currentAdp: true,
      currentAdpTrend: true,
      lifetimeValue: true,
      rawData: true,
    },
    orderBy: { currentAdp: 'asc' },
    take: 650,
  });

  for (const p of analyticsPlayers) {
    let age: number | null = null;
    if (p.rawData && typeof p.rawData === 'object') {
      age = (p.rawData as any).age || (p.rawData as any).Age || null;
    }

    entries.push({
      name: p.name,
      position: p.position,
      team: p.currentTeam || null,
      adp: p.currentAdp,
      adpFormatted: null,
      adpTrend: p.currentAdpTrend || null,
      age,
      value: p.lifetimeValue || null,
      source: 'analytics',
      ffcPlayerId: null,
      timesDrafted: null,
      adpHigh: null,
      adpLow: null,
      adpStdev: null,
      bye: null,
    });
  }

  const ffcFormat: FFCScoringFormat = FFC_FORMAT_MAP[type] || 'standard';
  try {
    let { players: ffcPlayers } = await fetchFFCADP(ffcFormat);
    // Off-season fallback: FFC publishes the new year's redraft ADP in summer.
    // If the current year is empty, retry with last year so the pool still
    // has ADP values to render.
    if (ffcPlayers.length === 0) {
      const lastYear = new Date().getFullYear() - 1;
      console.log(`[adp] FFC ${new Date().getFullYear()} empty, falling back to ${lastYear}`);
      const fallback = await fetchFFCADP(ffcFormat, 12, lastYear);
      ffcPlayers = fallback.players;
    }
    if (ffcPlayers.length > 0) {
      const existingNames = new Set(entries.map(e => e.name.toLowerCase()));
      for (const p of ffcPlayers) {
        if (!existingNames.has(p.name.toLowerCase())) {
          entries.push(p);
          existingNames.add(p.name.toLowerCase());
        } else {
          const existing = entries.find(e => e.name.toLowerCase() === p.name.toLowerCase());
          if (existing) {
            existing.ffcPlayerId = existing.ffcPlayerId ?? p.ffcPlayerId;
            existing.adpFormatted = existing.adpFormatted ?? p.adpFormatted;
            existing.timesDrafted = existing.timesDrafted ?? p.timesDrafted;
            existing.adpHigh = existing.adpHigh ?? p.adpHigh;
            existing.adpLow = existing.adpLow ?? p.adpLow;
            existing.adpStdev = existing.adpStdev ?? p.adpStdev;
            existing.bye = existing.bye ?? p.bye;
          }
        }
      }
    }
  } catch {
    console.log('[adp] FFC API fetch failed, continuing with other sources');
  }

  try {
    const ktcCache = await prisma.sportsDataCache.findUnique({ where: { cacheKey: 'ktc-dynasty-rankings' } });
    if (ktcCache?.data && Array.isArray(ktcCache.data)) {
      const existingNames = new Set(entries.map(e => e.name.toLowerCase()));
      for (const p of ktcCache.data as any[]) {
        if (p.name && !existingNames.has(p.name.toLowerCase())) {
          entries.push({
            name: p.name,
            position: p.position || 'UNK',
            team: p.team || null,
            adp: p.rank || 999,
            adpFormatted: null,
            adpTrend: null,
            age: null,
            value: p.value || null,
            source: 'ktc',
            ffcPlayerId: null,
            timesDrafted: null,
            adpHigh: null,
            adpLow: null,
            adpStdev: null,
            bye: null,
          });
          existingNames.add(p.name.toLowerCase());
        } else if (p.name && p.value) {
          const existing = entries.find(e => e.name.toLowerCase() === p.name.toLowerCase());
          if (existing && existing.value == null) {
            existing.value = p.value;
          }
        }
      }
    }
  } catch {
    console.log('[adp] KTC cache read failed');
  }

  if (type === 'dynasty') {
    try {
      const currentYear = new Date().getFullYear();
      const rookies = await (prisma as any).rookieRanking.findMany({
        // NFL dynasty ADP only: rankings for other sports live in the same table.
        where: { sport: 'NFL', year: { in: [currentYear, currentYear + 1] } },
        orderBy: { rank: 'asc' },
      });
      if (rookies && rookies.length > 0) {
        const existingNames = new Set(entries.map((e: ADPEntry) => e.name.toLowerCase()));
        for (const r of rookies) {
          if (!existingNames.has(r.name.toLowerCase())) {
            entries.push({
              name: r.name,
              position: r.position,
              team: r.team || 'Rookie',
              adp: r.rank,
              adpFormatted: null,
              adpTrend: null,
              age: null,
              value: r.dynastyValue || null,
              source: 'rookie-db',
              ffcPlayerId: null,
              timesDrafted: null,
              adpHigh: null,
              adpLow: null,
              adpStdev: null,
              bye: null,
            });
            existingNames.add(r.name.toLowerCase());
          }
        }
      }
    } catch {
      console.log('[adp] Rookie rankings fetch failed');
    }
  }

  entries.sort((a, b) => a.adp - b.adp);

  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: dbCacheKey },
      update: { data: entries as any, expiresAt: new Date(Date.now() + DB_CACHE_TTL) },
      create: { cacheKey: dbCacheKey, data: entries as any, expiresAt: new Date(Date.now() + DB_CACHE_TTL) },
    });
  } catch {}

  adpCache = { data: entries, ts: Date.now(), type };
  return entries.slice(0, limit);
}

async function getDevyADP(limit: number): Promise<ADPEntry[]> {
  const devyPlayers = await (prisma as any).devyPlayer.findMany({
    where: { devyEligible: true, graduatedToNFL: false },
    include: {
      devyAdpHistory: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
    take: limit * 2,
  });

  const entries: ADPEntry[] = [];
  for (const p of devyPlayers) {
    const latestAdpRecord = p.devyAdpHistory?.[0];
    const adpValue = latestAdpRecord?.adp ?? p.devyAdp;
    if (adpValue == null) continue;

    let trend: number | null = null;
    if (latestAdpRecord && p.devyAdp != null) {
      trend = latestAdpRecord.adp - p.devyAdp;
    }

    entries.push({
      name: p.name,
      position: p.position,
      team: p.school || p.nflTeam || null,
      adp: adpValue,
      adpFormatted: null,
      adpTrend: trend,
      age: null,
      value: null,
      source: 'devy',
      ffcPlayerId: null,
      timesDrafted: null,
      adpHigh: null,
      adpLow: null,
      adpStdev: null,
      bye: null,
    });
  }

  entries.sort((a, b) => a.adp - b.adp);
  return entries.slice(0, limit);
}

export async function getPlayerADP(playerName: string): Promise<ADPEntry | null> {
  const normalizedSearch = playerName.toLowerCase().trim();

  const player = await (prisma as any).playerAnalyticsSnapshot.findFirst({
    where: {
      currentAdp: { not: null },
      normalizedName: {
        contains: normalizedSearch,
      },
    },
    select: {
      name: true,
      position: true,
      currentTeam: true,
      currentAdp: true,
      currentAdpTrend: true,
      lifetimeValue: true,
      rawData: true,
    },
    orderBy: { currentAdp: 'asc' },
  });

  if (!player) return null;

  let age: number | null = null;
  if (player.rawData && typeof player.rawData === 'object') {
    age = (player.rawData as any).age || (player.rawData as any).Age || null;
  }

  return {
    name: player.name,
    position: player.position,
    team: player.currentTeam || null,
    adp: player.currentAdp,
    adpFormatted: null,
    adpTrend: player.currentAdpTrend || null,
    age,
    value: player.lifetimeValue || null,
    source: 'analytics',
    ffcPlayerId: null,
    timesDrafted: null,
    adpHigh: null,
    adpLow: null,
    adpStdev: null,
    bye: null,
  };
}

export function formatADPForPrompt(entries: ADPEntry[], maxEntries = 100): string {
  if (entries.length === 0) return 'No ADP data available.';

  const lines = entries.slice(0, maxEntries).map(p => {
    const team = p.team || 'FA';
    const adp = p.adp != null ? p.adp.toFixed(1) : 'N/A';
    const value = p.value != null ? p.value.toFixed(0) : 'N/A';
    let line = `${p.name} (${p.position}, ${team}) - ADP: ${adp}`;
    if (p.adpFormatted) line += ` [${p.adpFormatted}]`;
    line += ` • Value: ${value}`;
    if (p.age != null) line += ` • Age: ${p.age}`;
    if (p.bye != null) line += ` • BYE: ${p.bye}`;
    if (p.adpTrend != null && p.adpTrend !== 0) {
      line += ` • ${p.adpTrend < 0 ? 'RISING' : 'FALLING'}`;
    }
    if (p.timesDrafted != null) line += ` • Drafted: ${p.timesDrafted}x`;
    if (p.adpHigh != null && p.adpLow != null) {
      line += ` • Range: ${p.adpHigh}-${p.adpLow}`;
    }
    if (p.adpStdev != null) line += ` • StDev: ${p.adpStdev}`;
    return line;
  });

  return lines.join('\n');
}
