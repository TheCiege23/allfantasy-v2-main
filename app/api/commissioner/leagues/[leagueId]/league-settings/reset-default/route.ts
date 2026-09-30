/**
 * app/api/commissioner/leagues/[leagueId]/league-settings/reset-default/route.ts
 * Reset league settings to default
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import {
  UnifiedLeagueSettingsService,
  LeagueSettingsPermissionsService,
} from '@/lib/league-settings-engine';
import type {
  ResetLeagueSettingsRequest,
  ResetLeagueSettingsResponse,
} from '@/lib/league-settings-engine/LeagueSettingsEngineTypes';

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }): Promise<NextResponse> {
  const params = await props.params;
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const leagueId = params.leagueId;
    const userId = session.user.id;
    const body: ResetLeagueSettingsRequest = await req.json();

    // Get user permissions
    const userPermissions = LeagueSettingsPermissionsService.checkUserPermissions(
      userId,
      leagueId,
      'commissionerId' /* TODO */,
      [] /* TODO */,
      false /* TODO */,
    );

    // Only commissioner can reset
    if (!userPermissions.isCommissioner) {
      return NextResponse.json(
        { error: 'Only the commissioner can reset league settings' },
        { status: 403 },
      );
    }

    const result = await UnifiedLeagueSettingsService.resetLeagueSettingsToDefault(
      leagueId,
      userId,
      userPermissions,
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const response: ResetLeagueSettingsResponse = {
      success: true,
      settings: result.settings!,
      audit: result.settings!.audit,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /league-settings/reset-default]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
