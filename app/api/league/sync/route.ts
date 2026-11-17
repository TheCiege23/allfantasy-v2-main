import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { syncLeague, getDecryptedAuth } from '@/lib/league-sync-core';
import { getResendClient } from '@/lib/resend-client';
import { OUTSIDER_RESYNC_ERROR, resolveLeagueCopyTarget } from '@/lib/league-import/existingLeagueCopy';

export async function POST(req: NextRequest) {
  let userId: string | undefined;
  let userEmail: string | undefined;
  let normalizedPlatform = '';
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string; email?: string | null } } | null;
    userId = session?.user?.id;
    userEmail = session?.user?.email ?? undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = getClientIp(req) || 'unknown';
    const rl = rateLimit(`league-sync:${ip}`, 5, 60_000);
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { platform, platformLeagueId } = await req.json();

    if (!platform || !platformLeagueId) {
      return NextResponse.json({ error: 'Missing required fields: platform and platformLeagueId' }, { status: 400 });
    }

    normalizedPlatform = platform.toLowerCase();

    if (!['sleeper', 'mfl', 'espn', 'yahoo', 'fantrax'].includes(normalizedPlatform)) {
      return NextResponse.json({ error: `Unsupported platform: ${platform}` }, { status: 400 });
    }

    /*
     * 🛑 `syncLeague` upserts the CALLER's row, so a member of a league someone else imported got
     * their own owned copy here — and an owner reads as the commissioner everywhere. The import
     * refuses that; so does this (lib/league-import/existingLeagueCopy.ts). Before any provider
     * call or credential decrypt, because the answer does not depend on them.
     */
    const copy = await resolveLeagueCopyTarget({ userId, platform: normalizedPlatform, platformLeagueId: String(platformLeagueId) });
    if (copy.kind === 'member') {
      return NextResponse.json(
        {
          error: "You're already in this league on AllFantasy. Open it from your leagues to see the latest.",
          leagueId: copy.leagueId,
          alreadyInLeague: true,
        },
        { status: 409 }
      );
    }
    if (copy.kind === 'outsider') {
      return NextResponse.json({ error: OUTSIDER_RESYNC_ERROR }, { status: 409 });
    }

    if (normalizedPlatform !== 'sleeper') {
      const auth = await getDecryptedAuth(userId, normalizedPlatform);
      const missing =
        (normalizedPlatform === 'mfl' && !auth?.apiKey) ||
        (normalizedPlatform === 'espn' && (!auth?.espnSwid || !auth?.espnS2)) ||
        (normalizedPlatform === 'yahoo' && !auth?.oauthToken);

      if (missing) {
        return NextResponse.json(
          {
            error: `${normalizedPlatform.toUpperCase()} credentials required. Save them in League Settings first.`,
            authRequired: true,
            platform: normalizedPlatform,
          },
          { status: 403 }
        );
      }
    }

    const result = await syncLeague(userId, normalizedPlatform, platformLeagueId);

    if (result.success && process.env.NODE_ENV === 'production') {
      try {
        if (userEmail) {
          const { client, fromEmail } = await getResendClient();
          const leagueName = (result as any).name || (result as any).leagueName || normalizedPlatform.toUpperCase();
          await client.emails.send({
            from: fromEmail || 'AllFantasy.ai <noreply@allfantasy.ai>',
            to: userEmail,
            subject: `League Sync Complete: ${leagueName}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 32px; border-radius: 16px;">
                <h2 style="background: linear-gradient(90deg, #22d3ee, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-align: center;">AllFantasy.ai</h2>
                <h3 style="color: #4ade80;">League Sync Successful</h3>
                <p>Your ${normalizedPlatform.toUpperCase()} league <strong>"${leagueName}"</strong> was synced at ${new Date().toLocaleString()}.</p>
                <ul style="color: #94a3b8;">
                  <li>League size: ${(result as any).leagueSize || (result as any).totalTeams || '?'} teams</li>
                  <li>Format: ${(result as any).isDynasty ? 'Dynasty' : 'Redraft'}</li>
                  <li>Scoring: ${((result as any).scoring || (result as any).scoringType || 'STD').toUpperCase()}</li>
                </ul>
                <p>Your AI tools (Waiver AI, Trade Analyzer, Roster Report) will now use the latest data.</p>
                <p style="color: #64748b; font-size: 0.85em; margin-top: 24px;">
                  Sync ID: ${(result as any).leagueId || (result as any).id || 'N/A'}<br>
                  If this wasn't you, contact support.
                </p>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error('[League Sync] Email notification failed:', emailErr);
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[League Sync]', error);

    try {
      if (userId) {
        await (prisma as any).league.updateMany({
          where: { userId, syncStatus: 'pending' },
          data: {
            syncStatus: 'error',
            syncError: (error.message || 'Unknown error').slice(0, 500),
          },
        });
      }
    } catch {}

    if (process.env.NODE_ENV === 'production' && userEmail && normalizedPlatform) {
      try {
        const { client, fromEmail } = await getResendClient();
        await client.emails.send({
          from: fromEmail || 'AllFantasy.ai <noreply@allfantasy.ai>',
          to: userEmail,
          subject: `League Sync Failed: ${normalizedPlatform.toUpperCase()}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 32px; border-radius: 16px;">
              <h2 style="background: linear-gradient(90deg, #22d3ee, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-align: center;">AllFantasy.ai</h2>
              <h3 style="color: #ef4444;">League Sync Failed</h3>
              <p>We tried to sync your ${normalizedPlatform.toUpperCase()} league but ran into an issue:</p>
              <p style="color: #ef4444; background: rgba(239,68,68,0.1); padding: 12px; border-radius: 8px;">${error.message || 'Unknown error'}</p>
              <p>Please check your league ID and credentials, then try again from the dashboard.</p>
              <p style="color: #64748b; font-size: 0.85em; margin-top: 24px;">If this keeps happening, contact support.</p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('[League Sync] Failure email notification failed:', emailErr);
      }
    }

    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}
