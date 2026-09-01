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

export async function requireVerifiedUser(): Promise<
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

  if (!isUserVerified(emailVerified, profile.phoneVerifiedAt)) {
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
 * Signed in and age-confirmed, but NOT required to have verified an email or phone.
 *
 * `requireVerifiedUser` above, minus its final check. Chimmy deliberately sits behind the
 * weaker gate: a brand-new account can ask a question before completing verification,
 * which is the whole point of "Chimmy no longer requires a verified email" (cb3bcddf6).
 * Age confirmation still applies, because that one is a legal gate rather than a
 * deliverability one.
 *
 * ⚠ IT WAS IMPORTED BEFORE IT EXISTED. `app/api/chat/chimmy/route.ts` has imported and
 * CALLED this since 2026-08-27 while nothing exported it, so the route carried an
 * unresolvable import for ~12 hours. Only `typescript.ignoreBuildErrors: true` in
 * next.config.js kept that out of the build log.
 *
 * Same return shape as its sibling on purpose — callers do `if (!x.ok) return x.response`.
 */
export async function requireAgeConfirmedUser(): Promise<
  | { ok: true; userId: string; profile: VerifiedUserProfile }
  | { ok: false; response: NextResponse }
> {
  const session = await getAuthenticatedSession();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
    };
  }

  const profile = await getOrCreateUserProfile(userId);

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 }),
    };
  }

  if (!isAgeConfirmed(profile)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "AGE_REQUIRED" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    userId,
    profile,
  };
}