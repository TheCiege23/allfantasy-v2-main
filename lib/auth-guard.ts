import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface VerifiedUserProfile {
  userId: string;
  displayName: string | null;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  ageConfirmedAt: Date | null;
  profileComplete: boolean;
}

type SessionUser = {
  id?: string;
  email?: string | null;
};

type SessionResult = {
  user?: SessionUser;
} | null;

export function isUserVerified(
  emailVerified: Date | null | undefined,
  phoneVerifiedAt: Date | null | undefined
): boolean {
  return Boolean(emailVerified || phoneVerifiedAt);
}

export function isAgeConfirmed(profile: VerifiedUserProfile | null): boolean {
  return Boolean(profile?.ageConfirmedAt);
}

export function isFullyOnboarded(
  emailVerified: Date | null | undefined,
  profile: VerifiedUserProfile | null
): boolean {
  if (!profile) return false;

  return (
    isUserVerified(emailVerified, profile.phoneVerifiedAt) &&
    isAgeConfirmed(profile) &&
    profile.profileComplete
  );
}

async function getAuthenticatedSession(): Promise<SessionResult> {
  return (await getServerSession(authOptions)) as SessionResult;
}

async function getOrCreateUserProfile(
  userId: string
): Promise<VerifiedUserProfile | null> {
  try {
    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: {
        userId: true,
        displayName: true,
        phone: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        ageConfirmedAt: true,
        profileComplete: true,
      },
    });

    return profile;
  } catch (error) {
    console.error("[auth-guard] Failed to get or create user profile:", error);
    return null;
  }
}

async function getUserEmailVerification(userId: string): Promise<Date | null> {
  try {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });

    return user?.emailVerified ?? null;
  } catch (error) {
    console.error("[auth-guard] Failed to fetch app user verification:", error);
    return null;
  }
}

export async function getSessionAndProfile(): Promise<{
  userId: string | null;
  email: string | null;
  emailVerified: Date | null;
  profile: VerifiedUserProfile | null;
}> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  if (!userId) {
    return {
      userId: null,
      email: null,
      emailVerified: null,
      profile: null,
    };
  }

  const [emailVerified, profile] = await Promise.all([
    getUserEmailVerification(userId),
    getOrCreateUserProfile(userId),
  ]);

  return {
    userId,
    email,
    emailVerified,
    profile,
  };
}

/**
 * Require an authenticated session (any logged-in user). Use in API routes that must be protected.
 * Returns 401 response if not authenticated.
 */
export async function requireAuth(): Promise<
  | { ok: true; userId: string; session: SessionResult }
  | { ok: false; response: NextResponse }
> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, userId, session };
}

/**
 * Shared body of the two user guards below.
 *
 * ⚠ THE ONLY DIFFERENCE IS EMAIL/PHONE VERIFICATION. Auth, profile and AGE are
 * checked identically by both, so they cannot drift — the age gate in
 * particular is a compliance requirement for fantasy sports and must never be
 * the thing that gets dropped by accident when someone relaxes a surface.
 */
async function resolveGuardedUser(opts: { requireContactVerification: boolean }): Promise<
  | { ok: true; userId: string; profile: VerifiedUserProfile }
  | { ok: false; response: NextResponse }
> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "UNAUTHENTICATED" },
        { status: 401 }
      ),
    };
  }

  const [emailVerified, profile] = await Promise.all([
    getUserEmailVerification(userId),
    getOrCreateUserProfile(userId),
  ]);

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "INTERNAL_ERROR" },
        { status: 500 }
      ),
    };
  }

  if (!isAgeConfirmed(profile)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "AGE_REQUIRED" },
        { status: 403 }
      ),
    };
  }

  if (
    opts.requireContactVerification &&
    !isUserVerified(emailVerified, profile.phoneVerifiedAt)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "VERIFICATION_REQUIRED" },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    userId,
    profile,
  };
}

/**
 * Signed in, profiled, age-confirmed AND contact-verified.
 *
 * The strict guard. Use it for anything that writes, spends real money on the
 * user's behalf, or exposes another person's data.
 */
export async function requireVerifiedUser(): Promise<
  | { ok: true; userId: string; profile: VerifiedUserProfile }
  | { ok: false; response: NextResponse }
> {
  return resolveGuardedUser({ requireContactVerification: true });
}

/**
 * Signed in, profiled and age-confirmed — but email/phone verification NOT
 * required.
 *
 * ⚠ ADDED BECAUSE EMAIL VERIFICATION WAS LOCKING A THIRD OF SIGNUPS OUT OF
 * CHIMMY ENTIRELY. Measured on production: 17 of 48 accounts are unverified, and
 * every one of them got a 403 carrying a raw VERIFICATION_REQUIRED code instead
 * of an answer. The daily free tokens could not help them either, because this
 * gate sits ~400 lines ahead of the grant.
 *
 * ⚠ AGE IS STILL ENFORCED, DELIBERATELY. It is a compliance requirement for
 * fantasy sports, not a UX nicety, and it is the check most likely to be dropped
 * by accident when somebody relaxes a surface — which is why both guards share
 * one implementation rather than being copy-pasted.
 *
 * Reach for this ONLY on read-only surfaces whose spend is already bounded some
 * other way. Chimmy qualifies: it is answer-only, it never writes to a league,
 * and the daily token floor caps what an unverified account can consume.
 */
export async function requireAgeConfirmedUser(): Promise<
  | { ok: true; userId: string; profile: VerifiedUserProfile }
  | { ok: false; response: NextResponse }
> {
  return resolveGuardedUser({ requireContactVerification: false });
}