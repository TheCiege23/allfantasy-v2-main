import { prisma } from '@/lib/prisma';
import { getSleeperUser, SleeperUser } from '@/lib/sleeper-client';

export interface ResolvedLegacyUser {
  id: string;
  sleeperUsername: string;
  sleeperUserId: string;
  displayName: string | null;
  avatar: string | null;
  avatarUrl: string | null;
  isNew: boolean;
  usernameChanged: boolean;
  previousUsername?: string;
}

export async function resolveOrCreateLegacyUser(username: string): Promise<ResolvedLegacyUser | null> {
  const normalizedUsername = username.trim().toLowerCase();

  const existingByUsername = await prisma.legacyUser.findUnique({
    where: { sleeperUsername: normalizedUsername },
  });

  if (existingByUsername) {
    return {
      id: existingByUsername.id,
      sleeperUsername: existingByUsername.sleeperUsername,
      sleeperUserId: existingByUsername.sleeperUserId,
      displayName: existingByUsername.displayName,
      avatar: existingByUsername.avatar,
      avatarUrl: existingByUsername.avatarUrl,
      isNew: false,
      usernameChanged: false,
    };
  }

  const sleeperUser = await getSleeperUser(normalizedUsername);
  if (!sleeperUser) {
    return null;
  }

  const existingByUserId = await prisma.legacyUser.findUnique({
    where: { sleeperUserId: sleeperUser.user_id },
  });

  if (existingByUserId) {
    const oldUsername = existingByUserId.sleeperUsername;
    const avatarUrl = sleeperUser.avatar
      ? `https://sleepercdn.com/avatars/thumbs/${sleeperUser.avatar}`
      : existingByUserId.avatar;

    const orphanPrefs = await prisma.tradePreferences.findUnique({
      where: { sleeperUsername: normalizedUsername },
    });
    if (orphanPrefs) {
      await prisma.tradePreferences.delete({ where: { id: orphanPrefs.id } });
    }

    const updated = await prisma.legacyUser.update({
      where: { id: existingByUserId.id },
      data: {
        sleeperUsername: normalizedUsername,
        displayName: sleeperUser.display_name || sleeperUser.username,
        avatar: avatarUrl,
      },
    });

    await cascadeUsernameUpdate(oldUsername, normalizedUsername);

    console.log(
      `[LegacyUserResolver] Username change detected: "${oldUsername}" → "${normalizedUsername}" (userId: ${sleeperUser.user_id})`
    );

    return {
      id: updated.id,
      sleeperUsername: updated.sleeperUsername,
      sleeperUserId: updated.sleeperUserId,
      displayName: updated.displayName,
      avatar: updated.avatar,
      avatarUrl: updated.avatarUrl,
      isNew: false,
      usernameChanged: true,
      previousUsername: oldUsername,
    };
  }

  try {
    const newUser = await prisma.legacyUser.create({
      data: {
        sleeperUsername: normalizedUsername,
        sleeperUserId: sleeperUser.user_id,
        displayName: sleeperUser.display_name || sleeperUser.username,
        avatar: sleeperUser.avatar
          ? `https://sleepercdn.com/avatars/thumbs/${sleeperUser.avatar}`
          : null,
      },
    });

    return {
      id: newUser.id,
      sleeperUsername: newUser.sleeperUsername,
      sleeperUserId: newUser.sleeperUserId,
      displayName: newUser.displayName,
      avatar: newUser.avatar,
      avatarUrl: newUser.avatarUrl,
      isNew: true,
      usernameChanged: false,
    };
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const retryUser = await prisma.legacyUser.findUnique({
        where: { sleeperUserId: sleeperUser.user_id },
      });
      if (retryUser) {
        return {
          id: retryUser.id,
          sleeperUsername: retryUser.sleeperUsername,
          sleeperUserId: retryUser.sleeperUserId,
          displayName: retryUser.displayName,
          avatar: retryUser.avatar,
          avatarUrl: retryUser.avatarUrl,
          isNew: false,
          usernameChanged: false,
        };
      }
    }
    throw err;
  }
}

async function cascadeUsernameUpdate(oldUsername: string, newUsername: string): Promise<void> {
  const updates = await Promise.allSettled([
    prisma.tradePreferences.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.tradeFeedback.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.leagueTradeHistory.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.tradePreAnalysisCache.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.tradeAnalysisSnapshot.updateMany({
      where: { sleeperUsername: oldUsername, snapshotType: { not: 'trade_value_receipt_v1' } },
      data: { sleeperUsername: newUsername },
    }),
    prisma.shareReward.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.sleeperImportCache.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.managerDNA.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.emailPreference.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.aIUserProfile.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.aITeamStateSnapshot.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.legacyFeedback.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.aIInsight.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.aIBadge.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.simulationRun.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
    prisma.chatConversation.updateMany({
      where: { sleeperUsername: oldUsername },
      data: { sleeperUsername: newUsername },
    }),
  ]);

  const failures = updates.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(
      `[LegacyUserResolver] ${failures.length} cascade updates failed during username change "${oldUsername}" → "${newUsername}":`,
      failures.map((f) => (f as PromiseRejectedResult).reason)
    );
  }
}
