import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server';
import { getCanonicalPlayerMapForSport } from '@/lib/canonical/getCanonicalPlayer';
import { ensureNumber } from '@/lib/engine/response-guard';

export const GET = withApiUsage({ endpoint: "/api/legacy/players", tool: "LegacyPlayers" })(async () => {
  try {
    // Phase 3 batch 2 — the enumeration shape. Was a live fetch of Sleeper's entire NFL
    // universe; now a 2-query read of canonical `Player` keyed by Sleeper id, so the response
    // shape below is unchanged. Cache-only by design: this endpoint is an informational player
    // directory, not an input to a roster decision, so up-to-6h staleness is acceptable here.
    const players = await getCanonicalPlayerMapForSport('NFL');

    const simplified: Record<string, { name: string; position: string; team: string | null }> = {};

    for (const [id, player] of players) {
      simplified[id] = {
        name: player.name || id,
        position: player.position || '',
        team: player.team || null,
      };
    }
    
    return NextResponse.json({
      players: simplified,
      total: ensureNumber(Object.keys(simplified).length),
    });
  } catch (error) {
    console.error('Failed to fetch players:', error);
    return NextResponse.json({ players: {}, total: 0 });
  }
})
