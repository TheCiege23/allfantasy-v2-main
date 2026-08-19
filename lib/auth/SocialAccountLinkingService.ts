import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { notifyOwnerOfNewSignup } from "@/lib/notifications/notifyOwnerOfNewSignup";
import { ensureSharedAccountProfile } from "@/lib/auth/SharedAccountBootstrapService";
import { hasProfanityInUsername } from "@/lib/signup/UsernameProfanityGuard";
import { getTierFromXP, getXPRemainingToNextTier } from "@/lib/xp-progression/TierResolver";
import {
  consumeAdmission,
  isInviteOnlyEnabled,
  validateAdmission,
  type AdmissionErrorCode,
} from "@/lib/beta-invite/betaAdmissionService";
import { BETA_ADMISSION_COOKIE } from "@/lib/beta-invite/betaAdmissionCookie";
import { SIGNUP_CONSENT_COOKIE, isConsentCookieValue } from "@/lib/auth/signupConsentCookie";

const OAUTH_PLACEHOLDER_BCRYPT_ROUNDS = 10;

/**
 * Thrown from the OAuth create branch when closed-beta admission is missing or invalid for
 * a genuinely NEW account. lib/auth.ts maps `code` onto an honest OAuth error redirect.
 * Message is prefixed so the NextAuth error string is recognizable and never contains a token.
 */
export class BetaOAuthAdmissionError extends Error {
  constructor(public readonly code: AdmissionErrorCode) {
    super(`BETA_INVITE_${code}`);
    this.name = "BetaOAuthAdmissionError";
  }
}

/** Read the httpOnly admission cookie during the OAuth callback request. */
async function readOAuthAdmissionToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(BETA_ADMISSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The signup consent tick, carried across the provider redirect (see signupConsentCookie).
 * Absent for a sign-in that did not originate at /signup, which is correct: nothing was
 * ticked, so nothing is recorded. Never throws — a failed read must not block sign-in.
 */
async function readSignupConsentCookie(): Promise<boolean> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return isConsentCookieValue(store.get(SIGNUP_CONSENT_COOKIE)?.value);
  } catch {
    return false;
  }
}

/** Unusable for credentials login; satisfies any code paths that expect a set password hash. */
async function hashOAuthOnlyPlaceholder(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("hex"), OAUTH_PLACEHOLDER_BCRYPT_ROUNDS);
}

export type SocialAccountProvider = "google" | "apple" | "spotify" | "facebook" | "discord";

type LinkedSocialAuthUser = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: Date | null;
};

type LinkSocialAccountInput = {
  provider: SocialAccountProvider;
  providerAccountId: string;
  type?: string | null;
  email?: string | null;
  /** True only when the provider itself asserts this email is verified. Never trust a bare email claim for account linking. */
  emailVerified?: boolean;
  name?: string | null;
  image?: string | null;
  refreshToken?: string | null;
  accessToken?: string | null;
  expiresAt?: number | null;
  tokenType?: string | null;
  scope?: string | null;
  idToken?: string | null;
  sessionState?: string | null;
};

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraintError(
  error: unknown
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function sanitizeUsernameFragment(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildUsernameBase(name?: string | null): string {
  const preferred = sanitizeUsernameFragment(name);
  // Never derive from email — use the OAuth display name if valid, else a generic base.
  const candidate = preferred.length >= 3 ? preferred : "user";
  const truncated = candidate.slice(0, 24);

  if (hasProfanityInUsername(truncated)) {
    return "user";
  }

  return truncated;
}

async function reserveUniqueUsername(base: string): Promise<string> {
  const normalizedBase = sanitizeUsernameFragment(base) || "user";
  const initial = normalizedBase.slice(0, 30);

  if (initial.length >= 3 && !hasProfanityInUsername(initial)) {
    const existing = await prisma.appUser.findFirst({
      where: { username: { equals: initial, mode: "insensitive" } },
      select: { id: true },
    });
    if (!existing) {
      return initial;
    }
  }

  for (let attempt = 1; attempt <= 500; attempt += 1) {
    const suffix = `_${attempt}`;
    const stem = normalizedBase.slice(0, Math.max(3, 30 - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (candidate.length < 3 || hasProfanityInUsername(candidate)) {
      continue;
    }
    const existing = await prisma.appUser.findFirst({
      where: { username: { equals: candidate, mode: "insensitive" } },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  return `user_${Date.now().toString().slice(-6)}`;
}

async function ensureXpProfile(userId: string): Promise<void> {
  await prisma.managerXPProfile.upsert({
    where: { managerId: userId },
    create: {
      managerId: userId,
      totalXP: 0,
      currentTier: getTierFromXP(0),
      xpToNextTier: getXPRemainingToNextTier(0),
    },
    update: {},
  });
}

export async function linkSocialAccountToAppUser(
  input: LinkSocialAccountInput
): Promise<LinkedSocialAuthUser> {
  const providerAccountId = input.providerAccountId.trim();
  if (!providerAccountId) {
    throw new Error("SOCIAL_PROVIDER_ACCOUNT_MISSING");
  }

  const normalizedEmail =
    typeof input.email === "string" && input.email.trim().includes("@")
      ? normalizeEmailAddress(input.email)
      : null;
  const providerVerifiedEmail = input.emailVerified === true;

  const existingAccount = await prisma.authAccount.findFirst({
    where: {
      provider: input.provider,
      providerAccountId,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  let user =
    existingAccount?.userId
      ? await prisma.appUser.findUnique({
          where: { id: existingAccount.userId },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            emailVerified: true,
          },
        })
      : null;

  // Only link to an EXISTING AppUser by email match when the provider itself
  // asserts the email is verified. An unverified email claim must never be
  // trusted to take over someone else's account.
  if (!user && normalizedEmail && providerVerifiedEmail) {
    user = await prisma.appUser.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        emailVerified: true,
      },
    });
  }

  if (!user && !normalizedEmail) {
    throw new Error("SOCIAL_PROVIDER_EMAIL_MISSING");
  }

  if (!user && normalizedEmail) {
    // ── P0-1 BETA-GATE (OAuth new-account path) ──────────────────────────────────────
    // Reached ONLY for a genuinely new AppUser — the existing-account link paths return
    // above, so a returning Google/Discord/Spotify sign-in never hits this and never needs
    // an invite. The admission token rides the httpOnly cookie set at /api/auth/beta/claim,
    // which survives the provider's cross-site redirect (SameSite=Lax). The OAuth email must
    // match the invited email. Pre-check fails fast; consumption is atomic with the create.
    const betaGateActive = isInviteOnlyEnabled();
    const admissionToken = betaGateActive ? await readOAuthAdmissionToken() : null;
    if (betaGateActive) {
      let precheck;
      try {
        precheck = await validateAdmission({ rawToken: admissionToken, email: normalizedEmail });
      } catch {
        throw new BetaOAuthAdmissionError("GATE_UNAVAILABLE"); // fail closed
      }
      if (!precheck.ok) {
        throw new BetaOAuthAdmissionError(precheck.code);
      }
    }

    const displayNameBase = input.name?.trim() || "";
    const select = {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      emailVerified: true,
    } as const;

    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts && !user; attempt += 1) {
      const username = await reserveUniqueUsername(
        attempt === 1
          ? buildUsernameBase(input.name)
          : `${buildUsernameBase(input.name)}_${attempt}`
      );
      const passwordHash = await hashOAuthOnlyPlaceholder();

      try {
        // Create the account and consume the invite in ONE transaction: a consume race
        // rolls the account back and leaves the invite redeemable (a failed signup never
        // burns an invite). When the gate is inactive this is a plain create.
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.appUser.create({
            data: {
              email: normalizedEmail,
              username,
              displayName: displayNameBase || username,
              avatarUrl: input.image?.trim() || null,
              emailVerified: providerVerifiedEmail ? new Date() : null,
              passwordHash,
            },
            select,
          });
          if (betaGateActive) {
            const consumed = await consumeAdmission({
              rawToken: admissionToken,
              email: normalizedEmail,
              userId: created.id,
              db: tx,
            });
            if (!consumed.ok) {
              throw new BetaOAuthAdmissionError(consumed.code);
            }
          }
          return created;
        });
        // New OAuth account created (this is the create branch; the link-to-existing
        // path above returns before reaching here, so login stays silent).
        // Fire-and-forget.
        void notifyOwnerOfNewSignup({
          email: user.email,
          method: `oauth:${input.provider}`,
          userId: user.id,
          username: user.username,
        });

        // Campaign funnel truth for OAuth signups. Emitted from this create branch
        // specifically — the link-to-existing path returns before here — so a returning
        // Google/Discord/Spotify login is never counted as a new signup. Without this,
        // campaign conversion would only ever see email/password accounts.
        // `next/headers` is imported dynamically to match this module's existing
        // constraint of never pulling it into a non-request server context.
        // Fire-and-forget; a failure must not break sign-in.
        void (async () => {
          try {
            const { cookies } = await import("next/headers");
            const cookieStore = await cookies();
            const { recordFunnelEvent } = await import("@/lib/analytics/recordFunnelEvent");
            const { ACQUISITION } = await import("@/lib/analytics/eventNames");
            await recordFunnelEvent({
              event: ACQUISITION.SIGNUP_COMPLETED,
              userId: user.id,
              getCookie: (name) => cookieStore.get(name)?.value,
              meta: { auth_method: `oauth:${input.provider}` },
            });
          } catch (funnelErr) {
            console.warn("[social-link] signup funnel event failed (non-blocking):", funnelErr);
          }
        })();
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        // The email is already taken by another AppUser. If the provider
        // didn't verify this email, we cannot safely assume the OAuth user
        // and the existing account owner are the same person — refuse
        // rather than silently linking to a stranger's account.
        if (!providerVerifiedEmail) {
          throw new Error("SOCIAL_EMAIL_UNVERIFIED");
        }

        user = await prisma.appUser.findFirst({
          where: {
            email: { equals: normalizedEmail, mode: "insensitive" },
          },
          select,
        });

        if (!user) {
          // Likely a rare username race: retry with a different reserved username.
          continue;
        }
      }
    }
  }

  const userUpdates: {
    email?: string;
    displayName?: string;
    avatarUrl?: string | null;
    emailVerified?: Date;
  } = {};

  if (user && normalizedEmail && providerVerifiedEmail && user.email.toLowerCase() !== normalizedEmail) {
    const conflictingEmailOwner = await prisma.appUser.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
        NOT: { id: user.id },
      },
      select: { id: true },
    });

    if (!conflictingEmailOwner) {
      userUpdates.email = normalizedEmail;
    }
  }

  if (user && !user.emailVerified && normalizedEmail && providerVerifiedEmail) {
    userUpdates.emailVerified = new Date();
  }

  if (user && !user.displayName && input.name?.trim()) {
    userUpdates.displayName = input.name.trim();
  }

  if (user && !user.avatarUrl && input.image?.trim()) {
    userUpdates.avatarUrl = input.image.trim();
  }

  if (user && Object.keys(userUpdates).length > 0) {
    user = await prisma.appUser.update({
      where: { id: user.id },
      data: userUpdates,
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        emailVerified: true,
      },
    });
  }

  if (!user) {
    throw new Error("SOCIAL_ACCOUNT_LINK_FAILED");
  }

  const accountPayload = {
    userId: user.id,
    type: input.type?.trim() || "oauth",
    provider: input.provider,
    providerAccountId,
    refresh_token: input.refreshToken?.trim() || null,
    access_token: input.accessToken?.trim() || null,
    expires_at: typeof input.expiresAt === "number" ? input.expiresAt : null,
    token_type: input.tokenType?.trim() || null,
    scope: input.scope?.trim() || null,
    id_token: input.idToken?.trim() || null,
    session_state: input.sessionState?.trim() || null,
  };

  if (existingAccount?.id) {
    await prisma.authAccount.update({
      where: { id: existingAccount.id },
      data: accountPayload,
    });
  } else {
    try {
      await prisma.authAccount.create({
        data: accountPayload,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const concurrentAccount = await prisma.authAccount.findFirst({
        where: {
          provider: input.provider,
          providerAccountId,
        },
        select: { id: true },
      });

      if (!concurrentAccount) {
        throw error;
      }

      await prisma.authAccount.update({
        where: { id: concurrentAccount.id },
        data: accountPayload,
      });
    }
  }

  // The account link above already succeeded — these are best-effort bootstrap
  // steps that can be retried/created lazily later. A failure here must never
  // mask a successful link as SOCIAL_ACCOUNT_LINK_FAILED.
  try {
    await ensureSharedAccountProfile({
      userId: user.id,
      displayName: user.displayName,
      // The 18+/terms tick from /signup, carried across the provider redirect. Without
      // this an OAuth account was created with ageConfirmedAt null even when the user had
      // checked the box, and every later gate then reported they never confirmed.
      ageConfirmed: await readSignupConsentCookie(),
    });
  } catch (error) {
    console.error(
      `[social-link] ensureSharedAccountProfile failed (provider=${input.provider}, userId=${user.id}):`,
      error
    );
  }

  try {
    await ensureXpProfile(user.id);
  } catch (error) {
    console.error(
      `[social-link] ensureXpProfile failed (provider=${input.provider}, userId=${user.id}):`,
      error
    );
  }

  return user;
}
