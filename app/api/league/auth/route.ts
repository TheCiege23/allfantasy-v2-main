import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { encrypt, decrypt } from '@/lib/league-auth-crypto';
import { isAllowedLeagueAuthRequestOrigin } from '@/lib/extension/allowedRequestOrigin';
import { getPublicSiteOrigin } from '@/lib/site-public-origin';

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

    if (normalizedPlatform === 'espn' && (!espnSwid || !espnS2)) {
      return NextResponse.json({ error: 'ESPN requires both SWID and ESPN_S2 cookies' }, { status: 400 });
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
    if (espnSwid) data.espnSwid = encrypt(espnSwid);
    if (espnS2) data.espnS2 = encrypt(espnS2);

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
    console.error('[League Auth Save]', error);
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
      },
    });

    const result = auths.map((a: any) => ({
      platform: a.platform,
      hasApiKey: !!a.apiKey,
      hasOauthToken: !!a.oauthToken,
      hasEspnCookies: !!(a.espnSwid && a.espnS2),
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
