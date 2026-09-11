/**
 * app/api/commissioner/leagues/[leagueId]/league-settings/route.ts
 * Global league settings endpoint (GET/PUT)
 * Returns complete settings profile for display/edit
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { resolveLeagueMembership } from '@/lib/league-access';
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver';
import { isActiveOrGraceStatus } from '@/lib/subscription/feature-access';
import {
  UnifiedLeagueSettingsService,
  LeagueSettingsPermissionsService,
} from '@/lib/league-settings-engine';
import type {
  GetLeagueSettingsResponse,
  UpdateLeagueSettingsRequest,
  UpdateLeagueSettingsResponse,
} from '@/lib/league-settings-engine/LeagueSettingsEngineTypes';

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { leagueId: string } }): Promise<NextResponse> {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string; email?: string | null }
    } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const leagueId = params.leagueId;
    const userId = session.user.id;
    /*
     * 🛑 MEMBER GATE. This GET returned the league to ANY signed-in user. It
     * computed the commissioner flag and handed it back as a FIELD for the UI to
     * branch on, and never refused on it — so naming any leagueId returned that
     * league's settings and team list, owner names included.
     *
     * ⚠ MEMBER-LEVEL, NOT COMMISSIONER-LEVEL, AND THAT IS LOAD-BEARING.
     * `LeagueDuesTrackerPanel` and `RosterSettingsEditor` fetch this, read
     * `isCommissioner` off the response, and render READ-ONLY for ordinary
     * members. Gating at commissioner level would close the hole and break every
     * non-commissioner in the league. The write handlers keep their own stricter
     * check; this one only has to exclude non-members.
     *
     * ⚠ BEFORE THE READ, not after. `resolveLeagueMembership` is the four-path
     * canonical predicate (owner, RedraftLeagueMember, roster-backed, claimed
     * team) and returns 401/404/403 itself, so a missing league and a league that
     * is not yours stay indistinguishable to the caller.
     */
    const membership = await resolveLeagueMembership(leagueId, session.user.id)
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
        { status: membership.status },
      )
    }


    const [league, coOwnerTeams] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
      prisma.leagueTeam.findMany({
        where: { leagueId, isCoCommissioner: true },
        select: { claimedByUserId: true },
      }),
    ])

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const coOwnerIds = coOwnerTeams
      .map((t) => t.claimedByUserId)
      .filter((id): id is string => id !== null)

    const entitlementSnapshot = await new EntitlementResolver().resolveSnapshot(userId, session.user.email)
    const isPremiumSubscriber = isActiveOrGraceStatus(entitlementSnapshot.status)

    const userPermissions = LeagueSettingsPermissionsService.checkUserPermissions(
      userId,
      leagueId,
      league.userId,
      coOwnerIds,
      isPremiumSubscriber,
    );

    const settings = await UnifiedLeagueSettingsService.getLeagueSettings(leagueId);

    const response: GetLeagueSettingsResponse = {
      leagueId,
      settings,
      canEdit: userPermissions.isCommissioner,
      userRole: userPermissions.role,
      userPermissions,
      validationWarnings: [],
      subscriptionStatus: {
        isPremium: isPremiumSubscriber,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /league-settings]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { leagueId: string } }): Promise<NextResponse> {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string; email?: string | null }
    } | null

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const leagueId = params.leagueId;
    const userId = session.user.id;
    const body: UpdateLeagueSettingsRequest = await req.json();

    const [league, coOwnerTeams] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
      prisma.leagueTeam.findMany({
        where: { leagueId, isCoCommissioner: true },
        select: { claimedByUserId: true },
      }),
    ])

    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }

    const coOwnerIds = coOwnerTeams
      .map((t) => t.claimedByUserId)
      .filter((id): id is string => id !== null)

    const entitlementSnapshot = await new EntitlementResolver().resolveSnapshot(userId, session.user.email)
    const isPremiumSubscriber = isActiveOrGraceStatus(entitlementSnapshot.status)

    const userPermissions = LeagueSettingsPermissionsService.checkUserPermissions(
      userId,
      leagueId,
      league.userId,
      coOwnerIds,
      isPremiumSubscriber,
    );

    const result = await UnifiedLeagueSettingsService.updateLeagueSettings(
      leagueId,
      body.page,
      body.data,
      userId,
      userPermissions,
      { validateOnly: body.validateOnly },
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          validation: result.validation,
          message: result.error,
        },
        { status: 400 },
      );
    }

    const response: UpdateLeagueSettingsResponse = {
      success: true,
      settings: result.settings,
      validation: result.validation,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[PUT /league-settings]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
