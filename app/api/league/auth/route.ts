import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { encrypt } from '@/lib/league-auth-crypto';
import { isAllowedLeagueAuthRequestOrigin } from '@/lib/extension/allowedRequestOrigin';
import { getPublicSiteOrigin } from '@/lib/site-public-origin';
import { validateEspnCookieInput } from '@/lib/league-import/espn/espnFantasyClient';
import { ESPN_NEEDS_RECONNECT, espnHealthResetFields } from '@/lib/league-import/espn/espnConnectionHealth';

const SUPPORTED_PLATFORMS = ['mfl', 'yahoo', 'espn', 'fantrax'];

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Defense-in-depth for the ESPN one-click browser extension (see
    // lib/extension/allowedRequestOrigin.ts): only ADDS a rejection for a cross-origin
    // request that isn't this app or the configured extension — the manual paste form (no
    // Origin header, or same-origin) is unaffected.
    if (
      !isAllowedLeagueAuthRequestOrigin({
        originHeader: req.headers.get('origin'),
        appOrigin: getPublicSiteOrigin(),
        extensionId: process.env.ESPN_EXTENSION_ID,
      })
    ) {
      return NextResponse.json({ error: 'Request origin not allowed' }, { status: 403 });
    }

    const body = await req.json();
    const { platform, apiKey, oauthToken, oauthSecret, espnSwid, espnS2 } = body;

    if (!platform || !SUPPORTED_PLATFORMS.includes(platform.toLowerCase())) {
      return NextResponse.json(
        { error: `Unsupported platform. Use: ${SUPPORTED_PLATFORMS.join(', ')}` },
        { status: 400 }
      );
    }

    const normalizedPlatform = platform.toLowerCase();

    let espnCookies: { swid: string; espnS2: string } | null = null;
    if (normalizedPlatform === 'espn') {
      if (!espnSwid || !espnS2) {
        return NextResponse.json({ error: 'ESPN requires both SWID and ESPN_S2 cookies' }, { status: 400 });
      }
      /*
       * Format-checked before anything is stored: a mis-copied value used to overwrite a working
       * connection and only fail later, as "ESPN rejected me". The extension sends real cookies and
       * passes this unchanged; the manual paste gets told exactly which box is wrong.
       */
      const check = validateEspnCookieInput({ swid: String(espnSwid), espnS2: String(espnS2) });
      if (!check.ok) {
        return NextResponse.json({ error: check.message, field: check.field, code: 'INVALID_COOKIES' }, { status: 400 });
      }
      espnCookies = { swid: check.swid, espnS2: check.espnS2 };
    }

    if (normalizedPlatform === 'mfl' && !apiKey) {
      return NextResponse.json({ error: 'MFL requires an API key' }, { status: 400 });
    }

    if (normalizedPlatform === 'yahoo' && !oauthToken) {
      return NextResponse.json({ error: 'Yahoo requires an OAuth token' }, { status: 400 });
    }

    const data: any = {};
    if (apiKey) data.apiKey = encrypt(apiKey);
    if (oauthToken) data.oauthToken = encrypt(oauthToken);
    if (oauthSecret) data.oauthSecret = encrypt(oauthSecret);
    if (espnCookies) {
      data.espnSwid = encrypt(espnCookies.swid);
      data.espnS2 = encrypt(espnCookies.espnS2);
      Object.assign(data, espnHealthResetFields());
    }

    await (prisma as any).leagueAuth.upsert({
      where: {
        userId_platform: { userId, platform: normalizedPlatform },
      },
      update: { ...data, updatedAt: new Date() },
      create: { userId, platform: normalizedPlatform, ...data },
    });

    return NextResponse.json({
      success: true,
      platform: normalizedPlatform,
      message: `${normalizedPlatform.toUpperCase()} credentials saved securely`,
    });
  } catch (error: any) {
    console.error('[League Auth Save]', error instanceof Error ? error.name : 'error');
    return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const auths = await (prisma as any).leagueAuth.findMany({
      where: { userId },
      select: {
        platform: true,
        createdAt: true,
        updatedAt: true,
        apiKey: true,
        oauthToken: true,
        espnSwid: true,
        espnS2: true,
        connectionStatus: true,
        lastFailureAt: true,
      },
    });

    const result = auths.map((a: any) => ({
      platform: a.platform,
      hasApiKey: !!a.apiKey,
      hasOauthToken: !!a.oauthToken,
      hasEspnCookies: !!(a.espnSwid && a.espnS2),
      /* ESPN refused the saved cookies on a recent read; the panel asks for fresh ones. */
      needsReconnect: a.platform === 'espn' && a.connectionStatus === ESPN_NEEDS_RECONNECT,
      lastFailureAt: a.platform === 'espn' ? a.lastFailureAt ?? null : null,
      connectedAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));

    return NextResponse.json({ auths: result });
  } catch (error: any) {
    console.error('[League Auth List]', error);
    return NextResponse.json({ error: 'Failed to fetch credentials' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { platform } = await req.json();
    if (!platform) {
      return NextResponse.json({ error: 'Missing platform' }, { status: 400 });
    }

    await (prisma as any).leagueAuth.deleteMany({
      where: { userId, platform: platform.toLowerCase() },
    });

    return NextResponse.json({
      success: true,
      message: `${platform.toUpperCase()} credentials removed`,
    });
  } catch (error: any) {
    console.error('[League Auth Delete]', error);
    return NextResponse.json({ error: 'Failed to remove credentials' }, { status: 500 });
  }
}
