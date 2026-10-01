/**
 * app/api/commissioner/leagues/[leagueId]/league-settings/validate/route.ts
 * Validation-only endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { UnifiedLeagueSettingsService } from '@/lib/league-settings-engine';
import type {
  ValidateLeagueSettingsRequest,
  ValidateLeagueSettingsResponse,
} from '@/lib/league-settings-engine/LeagueSettingsEngineTypes';

export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }): Promise<NextResponse> {
  const params = await props.params;
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ValidateLeagueSettingsRequest = await req.json();

    const validation = await UnifiedLeagueSettingsService.validateLeagueSettings(
      params.leagueId,
      body.settings,
    );

    const response: ValidateLeagueSettingsResponse = {
      validation,
      canSave: validation.canSave,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[POST /league-settings/validate]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
