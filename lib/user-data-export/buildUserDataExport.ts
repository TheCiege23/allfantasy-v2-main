import type { prisma as prismaClient } from "@/lib/prisma"

/**
 * "Download my data" — everything AllFantasy holds about one account, as one JSON document.
 *
 * ⚠ EVERY READ HERE NAMES ITS FIELDS. No query may omit `select`, and none may select a whole
 * relation. That is the entire secret-safety model: a column added to a table later — a token, a
 * key, an internal note — is invisible to this export until somebody deliberately lists it. The
 * test (`__tests__/user-data-export.test.ts`) fails on any query without a `select`, and on any
 * selected field in EXPORT_FORBIDDEN_FIELDS.
 *
 * Deliberately NOT exported (and why), so the next reader does not "fix" an omission:
 *   - passwords, OAuth/refresh tokens, platform API keys and cookies (LeagueAuth, AuthAccount,
 *     YahooConnection, Discord/Spotify tokens on UserProfile), web-push endpoints and keys —
 *     credentials, not data about you, and dangerous in a file that gets emailed around.
 *   - sessions, email-verify / password-reset / invite tokens — live credentials.
 *   - staff identities on admin grants (who granted it, their note) — another person's data.
 *   - the other side of a referral (which account you referred / who referred you).
 *   - fraud and identity signals, household exceptions, psychological-profile labels, reports filed
 *     against you — held back pending the owner's legal review (2026-10-03), listed in `notIncluded`.
 *   - Stripe / Apple transaction ids, idempotency keys and free-form `metadata` JSON blobs — internal
 *     plumbing whose contents are not fixed; the status, amount and dates of each payment are here.
 *
 * Large tables are capped at their newest rows; every capped section says how many rows exist, so
 * a truncated export can never read as a complete one.
 */

type Db = typeof prismaClient

/** Fields no export query may select. The test checks every `select` against this list. */
export const EXPORT_FORBIDDEN_FIELDS = [
  "passwordHash",
  "access_token",
  "refresh_token",
  "id_token",
  "session_state",
  "accessToken",
  "refreshToken",
  "discordAccessToken",
  "discordRefreshToken",
  "spotifyAccessToken",
  "spotifyRefreshToken",
  "apiKey",
  "oauthToken",
  "oauthSecret",
  "espnSwid",
  "espnS2",
  "endpoint",
  "p256dh",
  "auth",
  "idempotencyKey",
  "grantedByAdminId",
  "grantedByEmail",
  "revokedByAdminId",
  "referredUserId",
  "referrerId",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "stripeCheckoutSessionId",
  "stripePaymentIntentId",
  "stripePaymentIntent",
  "stripeSessionId",
  "stripeInvoiceId",
  "appleOriginalTransactionId",
  "appleLatestTransactionId",
  "metadata",
  "meta",
] as const

/** Newest-rows caps for the high-volume tables. */
export const EXPORT_CAPS = {
  messages: 5000,
  aiChat: 5000,
  notifications: 1000,
  tokenLedger: 5000,
  tokenReservations: 1000,
  walletLedger: 5000,
  autoCoachSwaps: 2000,
  tradeComparisons: 30,
} as const

export const EXPORT_NOT_INCLUDED = [
  "Passwords, sign-in sessions, OAuth tokens, platform API keys and cookies, and push-notification keys — these are credentials, not data about you, so they never leave our servers.",
  "The identity of other people: which account you referred or who referred you, and which staff member applied an admin grant.",
  "Payment-processor identifiers (Stripe and Apple transaction ids). Every payment's status, amount and dates are included.",
  "Fraud-prevention and account-security signals, and AI-generated profile labels. Contact support to request these.",
] as const

type Capped<T> = { total: number; truncated: boolean; rows: T[] }

async function capped<T>(count: Promise<number>, rows: Promise<T[]>, cap: number): Promise<Capped<T>> {
  const [total, list] = await Promise.all([count, rows])
  return { total, truncated: total > cap, rows: list }
}

/**
 * Each section is read independently: one table failing (a column missing on an old database, a
 * timeout) leaves that section out and NAMES it in `unavailableSections`, rather than failing the
 * whole download or silently shipping a partial file.
 */
export async function buildUserDataExport(db: Db, userId: string, now: Date = new Date()) {
  const unavailableSections: string[] = []
  const section = async <T>(name: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read()
    } catch {
      unavailableSections.push(name)
      return null
    }
  }

  const account = await section("account", () =>
    db.appUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        detectedStateCode: true,
        isStateRestricted: true,
      },
    }),
  )

  const [
    profile,
    signInMethods,
    platformIdentities,
    yahoo,
    platformConnections,
    subscriptions,
    adminGrants,
    tokenBalance,
    tokenLedger,
    tokenReservations,
    wallet,
    walletLedger,
    bracketPayments,
    leagueDues,
    sponsorCoupons,
    referralCodes,
    referralRewards,
    referralsMade,
    referredBy,
    autoCoachSettings,
    autoCoachSwaps,
    leaguesCreated,
    teamsClaimed,
    managerClaims,
    redraftMemberships,
    sleeperLeagues,
    leagueChat,
    directMessages,
    aiConversations,
    aiMessages,
    notifications,
    tradeComparisons,
    pushDevices,
    legalAcceptances,
  ] = await Promise.all([
    section("profile", () =>
      db.userProfile.findUnique({
        where: { userId },
        select: {
          displayName: true,
          phone: true,
          phoneVerifiedAt: true,
          emailVerifiedAt: true,
          ageConfirmedAt: true,
          verificationMethod: true,
          sleeperUsername: true,
          sleeperUserId: true,
          sleeperLinkedAt: true,
          profileComplete: true,
          createdAt: true,
          updatedAt: true,
          avatarPreset: true,
          preferredLanguage: true,
          timezone: true,
          themePreference: true,
          bio: true,
          preferredSports: true,
          notificationPreferences: true,
          onboardingCompletedAt: true,
          discordUsername: true,
          discordConnectedAt: true,
          spotifyDisplayName: true,
          spotifyConnectedAt: true,
          autoCoachGlobalEnabled: true,
          autoCoachPreferences: true,
          sessionIdleTimeoutMinutes: true,
          corePreferences: true,
          riskProfile: true,
          draftStyle: true,
          dynastyWindow: true,
          preferredBuild: true,
          preferredPositionsJson: true,
          fadePositionsJson: true,
          aiStrategyModeDefault: true,
          aiExplanationStyle: true,
          aiVoicePreference: true,
          chimmyTtsVoiceId: true,
          rankTier: true,
          xpTotal: true,
          xpLevel: true,
          careerWins: true,
          careerLosses: true,
          careerChampionships: true,
          careerPlayoffAppearances: true,
          careerSeasonsPlayed: true,
          careerLeaguesPlayed: true,
        },
      }),
    ),
    section("signInMethods", () =>
      db.authAccount.findMany({ where: { userId }, select: { provider: true, type: true } }),
    ),
    section("platformIdentities", () =>
      db.platformIdentity.findMany({
        where: { userId },
        select: {
          platform: true,
          platformUsername: true,
          displayName: true,
          sport: true,
          isVerified: true,
          firstImportAt: true,
          lastSyncedAt: true,
          createdAt: true,
        },
      }),
    ),
    section("yahoo", () =>
      db.yahooConnection.findFirst({
        where: { userId },
        select: { displayName: true, email: true, createdAt: true, updatedAt: true },
      }),
    ),
    section("platformConnections", () =>
      db.leagueAuth.findMany({ where: { userId }, select: { platform: true, createdAt: true, updatedAt: true } }),
    ),
    section("subscriptions", () =>
      db.userSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          source: true,
          sku: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          gracePeriodEnd: true,
          canceledAt: true,
          expiresAt: true,
          createdAt: true,
          plan: { select: { code: true, name: true } },
        },
      }),
    ),
    section("adminGrants", () =>
      db.adminSubscriptionGrant.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { tier: true, startsAt: true, expiresAt: true, revokedAt: true, createdAt: true },
      }),
    ),
    section("tokenBalance", () =>
      db.userTokenBalance.findUnique({
        where: { userId },
        select: {
          balance: true,
          reservedBalance: true,
          lifetimePurchased: true,
          lifetimeSpent: true,
          lifetimeRefunded: true,
          updatedAt: true,
        },
      }),
    ),
    section("tokenLedger", () =>
      capped(
        db.tokenLedger.count({ where: { userId } }),
        db.tokenLedger.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.tokenLedger,
          select: {
            entryType: true,
            tokenDelta: true,
            balanceAfter: true,
            tokenPackageSku: true,
            spendRuleCode: true,
            refundRuleCode: true,
            description: true,
            createdAt: true,
          },
        }),
        EXPORT_CAPS.tokenLedger,
      ),
    ),
    section("tokenReservations", () =>
      capped(
        db.tokenReservation.count({ where: { userId } }),
        db.tokenReservation.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.tokenReservations,
          select: {
            amount: true,
            status: true,
            spendRuleCode: true,
            reason: true,
            reservedAt: true,
            finalizedAt: true,
            releasedAt: true,
          },
        }),
        EXPORT_CAPS.tokenReservations,
      ),
    ),
    section("wallet", () =>
      db.platformWalletAccount.findUnique({
        where: { userId },
        select: { currency: true, balanceCents: true, pendingBalanceCents: true, createdAt: true, updatedAt: true },
      }),
    ),
    section("walletLedger", () =>
      capped(
        db.walletLedgerEntry.count({ where: { userId } }),
        db.walletLedgerEntry.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.walletLedger,
          select: {
            entryType: true,
            status: true,
            amountCents: true,
            description: true,
            refProduct: true,
            createdAt: true,
            effectiveAt: true,
          },
        }),
        EXPORT_CAPS.walletLedger,
      ),
    ),
    section("bracketPayments", () =>
      db.bracketPayment.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          leagueId: true,
          tournamentId: true,
          paymentType: true,
          status: true,
          amountCents: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ),
    section("leagueDues", () =>
      db.leagueDues.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          leagueId: true,
          season: true,
          amountDueCents: true,
          amountPaidCents: true,
          status: true,
          paymentProvider: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    ),
    section("sponsorCoupons", () =>
      db.sponsorCouponRedemption.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          displayCode: true,
          sponsorName: true,
          campaignName: true,
          discountPercent: true,
          appliesTo: true,
          productKey: true,
          status: true,
          amountSubtotalCents: true,
          discountAmountCents: true,
          amountTotalCents: true,
          currency: true,
          redeemedAt: true,
          createdAt: true,
        },
      }),
    ),
    section("referralCodes", () =>
      db.referralCode.findMany({
        where: { userId },
        select: {
          code: true,
          status: true,
          isPrimary: true,
          shareCount: true,
          successfulReferralCount: true,
          lastSharedAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      }),
    ),
    section("referralRewards", () =>
      db.referralReward.findMany({
        where: { userId },
        orderBy: { grantedAt: "desc" },
        select: { type: true, status: true, rewardKind: true, label: true, value: true, grantedAt: true, redeemedAt: true },
      }),
    ),
    section("referralsMade", () =>
      db.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
          kind: true,
          status: true,
          onboardingStep: true,
          clickedAt: true,
          signupCompletedAt: true,
          onboardingCompletedAt: true,
          rewardGrantedAt: true,
        },
      }),
    ),
    section("referredBy", () =>
      db.referral.findFirst({
        where: { referredUserId: userId },
        select: { kind: true, status: true, clickedAt: true, signupCompletedAt: true },
      }),
    ),
    section("autoCoachSettings", () =>
      db.autoCoachSetting.findMany({
        where: { userId },
        select: {
          leagueId: true,
          enabled: true,
          blockedByCommissioner: true,
          lastRunAt: true,
          lastSwapAt: true,
          totalSwapsMade: true,
          createdAt: true,
        },
      }),
    ),
    section("autoCoachSwaps", () =>
      capped(
        db.autoCoachSwapLog.count({ where: { userId } }),
        db.autoCoachSwapLog.findMany({
          where: { userId },
          orderBy: { swapMadeAt: "desc" },
          take: EXPORT_CAPS.autoCoachSwaps,
          select: {
            leagueId: true,
            slotPosition: true,
            playerOutName: true,
            playerOutStatus: true,
            playerInName: true,
            playerInPosition: true,
            swapMadeAt: true,
            gameStartsAt: true,
            decisionNotes: true,
          },
        }),
        EXPORT_CAPS.autoCoachSwaps,
      ),
    ),
    section("leaguesCreated", () =>
      db.league.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          platform: true,
          platformLeagueId: true,
          sport: true,
          season: true,
          isDynasty: true,
          createdAt: true,
        },
      }),
    ),
    section("teamsClaimed", () =>
      db.leagueTeam.findMany({
        where: { claimedByUserId: userId },
        select: {
          leagueId: true,
          teamName: true,
          ownerName: true,
          role: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
          isCommissioner: true,
          isCoCommissioner: true,
        },
      }),
    ),
    section("managerClaims", () =>
      db.leagueManagerClaim.findMany({
        where: { afUserId: userId },
        select: { leagueId: true, teamExternalId: true, claimedAt: true, isConfirmed: true },
      }),
    ),
    section("redraftMemberships", () =>
      db.redraftLeagueMember.findMany({
        where: { userId },
        select: { leagueId: true, role: true, teamNumber: true, joinedAt: true },
      }),
    ),
    section("sleeperLeagues", () =>
      db.sleeperLeague.findMany({
        where: { userId },
        select: {
          sleeperLeagueId: true,
          name: true,
          season: true,
          status: true,
          isDynasty: true,
          totalTeams: true,
          scoringType: true,
          lastSyncedAt: true,
          createdAt: true,
        },
      }),
    ),
    // Your own messages only — a message you received belongs to its sender's export.
    section("leagueChatMessages", () =>
      capped(
        db.leagueChatMessage.count({ where: { userId } }),
        db.leagueChatMessage.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.messages,
          select: { leagueId: true, message: true, type: true, imageUrl: true, isPrivate: true, createdAt: true },
        }),
        EXPORT_CAPS.messages,
      ),
    ),
    section("directMessages", () =>
      capped(
        db.platformChatMessage.count({ where: { senderUserId: userId } }),
        db.platformChatMessage.findMany({
          where: { senderUserId: userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.messages,
          select: { threadId: true, messageType: true, body: true, isPrivate: true, createdAt: true },
        }),
        EXPORT_CAPS.messages,
      ),
    ),
    section("aiConversations", () =>
      db.chatConversation.findMany({
        where: { userId },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, title: true, messageCount: true, lastMessageAt: true, createdAt: true },
      }),
    ),
    // Both sides of a conversation with Chimmy: the assistant's replies are part of your history.
    section("aiMessages", () =>
      capped(
        db.chatHistory.count({ where: { userId } }),
        db.chatHistory.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.aiChat,
          select: { conversationId: true, leagueId: true, role: true, content: true, createdAt: true },
        }),
        EXPORT_CAPS.aiChat,
      ),
    ),
    section("notifications", () =>
      capped(
        db.platformNotification.count({ where: { userId } }),
        db.platformNotification.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.notifications,
          select: {
            leagueId: true,
            productType: true,
            type: true,
            title: true,
            body: true,
            severity: true,
            createdAt: true,
            readAt: true,
          },
        }),
        EXPORT_CAPS.notifications,
      ),
    ),
    section("tradeComparisons", () =>
      capped(
        db.genericTradeComparison.count({ where: { userId } }),
        db.genericTradeComparison.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: EXPORT_CAPS.tradeComparisons,
          select: { snapshot: true, createdAt: true },
        }),
        EXPORT_CAPS.tradeComparisons,
      ),
    ),
    section("pushDevices", () =>
      db.webPushSubscription.findMany({ where: { userId }, select: { userAgent: true, createdAt: true } }),
    ),
    // What you agreed to, at which version, and when (lib/legal/recordLegalAcceptance). Recorded from
    // 2026-10-03; an account older than that agreed at sign-up but no record of it was kept.
    section("legalAcceptances", () =>
      db.legalAcceptance.findMany({
        where: { userId },
        orderBy: { acceptedAt: "asc" },
        select: { document: true, documentVersion: true, source: true, acceptedAt: true },
      }),
    ),
  ])

  return {
    exportedAt: now.toISOString(),
    version: 2,
    notIncluded: EXPORT_NOT_INCLUDED,
    unavailableSections,
    account,
    profile,
    connections: { signInMethods, platformIdentities, yahoo, platformConnections },
    billing: {
      subscriptions,
      adminGrants,
      tokenBalance,
      tokenLedger,
      tokenReservations,
      wallet,
      walletLedger,
      bracketPayments,
      leagueDues,
      sponsorCoupons,
    },
    referrals: { codes: referralCodes, rewards: referralRewards, referralsMade, referredBy },
    autoCoach: { settings: autoCoachSettings, swaps: autoCoachSwaps },
    leagues: { leaguesCreated, teamsClaimed, managerClaims, redraftMemberships, sleeperLeagues },
    messages: { leagueChat, directMessages },
    aiChat: { conversations: aiConversations, messages: aiMessages },
    notifications,
    tradeComparisons,
    pushDevices,
    legalAcceptances,
  }
}

/** JSON.stringify that survives BigInt columns (xpTotal), which plain JSON cannot represent. */
export function serializeUserDataExport(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)
}
