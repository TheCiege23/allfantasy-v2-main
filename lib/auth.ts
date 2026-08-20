import type { NextAuthOptions, Profile } from "next-auth";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import SpotifyProvider from "next-auth/providers/spotify";
import { SPOTIFY_SCOPES } from "@/lib/spotify/scopes";
import FacebookProvider from "next-auth/providers/facebook";
import DiscordProvider from "next-auth/providers/discord";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { notifyOwnerOfNewSignup } from "@/lib/notifications/notifyOwnerOfNewSignup";
import { resolveUnifiedAuthIdentity } from "@/lib/auth/AuthIdentityResolver";
import { linkSocialAccountToAppUser } from "@/lib/auth/SocialAccountLinkingService";
import { ensureSharedAccountProfile } from "@/lib/auth/SharedAccountBootstrapService";
import { GUEST_SESSION_COOKIE_NAME } from "@/lib/guest-mode/guestSessionToken";
import { claimGuestTrialForUser } from "@/lib/legacy/claimGuestTrialForUser";
import { isInviteOnlyEnabled } from "@/lib/beta-invite/betaAdmissionService";
import { lookupSleeperUser } from "@/lib/sleeper/user-lookup";
import { getTierFromXP, getXPRemainingToNextTier } from "@/lib/xp-progression/TierResolver";
import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret";
import { isPostOAuthRedirectPreservedPath } from "@/lib/auth/postOAuthRedirectPolicy";
import { canonicalizeProductRoute } from "@/lib/routing/canonicalizeProductRoute";

/** Only used while `next build` evaluates API routes; never used at runtime on Vercel if env is set. */
const BUILD_TIME_AUTH_SECRET_PLACEHOLDER =
  "build-only-placeholder-nextauth-secret-min-32-chars!!";

function getAuthSecret(): string {
  const secret = resolveAuthSecret();

  if (secret) {
    return secret;
  }

  // During `next build`, Next imports route modules to collect page data; CI may not inject secrets.
  // Production/preview runtime must still set NEXTAUTH_SECRET or AUTH_SECRET in the Vercel project.
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
    return BUILD_TIME_AUTH_SECRET_PLACEHOLDER;
  }

  throw new Error(
    "NEXTAUTH_SECRET (or AUTH_SECRET) is not set. Add it to your local environment and Vercel project settings."
  );
}

function buildSleeperAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  return `https://sleepercdn.com/avatars/${avatar}`;
}

function isDevAuthBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS_ENABLED?.trim() === "true";
}

/** NextAuth sometimes omits `user.email` in the signIn callback; OAuth `profile` still has it. */
function resolveOAuthEmailFromCallback(
  user: { email?: string | null },
  profile?: Profile | null
): string | undefined {
  const fromUser =
    typeof user.email === "string" && user.email.includes("@") ? user.email.trim() : undefined;
  const fromProfile =
    profile &&
    typeof profile.email === "string" &&
    profile.email.includes("@")
      ? profile.email.trim()
      : undefined;
  return fromUser ?? fromProfile;
}

/**
 * Whether the OAuth provider itself asserts this email is verified. This gates
 * whether an OAuth sign-in is allowed to link to an EXISTING AppUser by email
 * match — an unverified claim must never take over another account.
 *
 * Provider signal shapes differ:
 * - Google: raw userinfo includes boolean `email_verified`.
 * - Apple: the decoded id_token claim `email_verified` is often the STRING
 *   "true"/"false" rather than a boolean.
 * - Discord: raw `/users/@me` response includes boolean `verified`.
 * - Spotify: the Web API exposes no verification flag at all. Spotify itself
 *   requires a verified email before its own signup completes, so a returned
 *   email is treated as verified-by-platform-design (this mirrors the
 *   provider's existing explicit `allowDangerousEmailAccountLinking: true`).
 * - Facebook: the Graph API only returns `email` once Facebook considers it
 *   confirmed — presence of the field already implies verification.
 */
function resolveOAuthEmailVerifiedFromCallback(
  provider: "google" | "apple" | "spotify" | "facebook" | "discord",
  profile?: Profile | null
): boolean {
  const raw = profile as Record<string, unknown> | null | undefined;
  switch (provider) {
    case "google":
      return raw?.email_verified === true;
    case "apple":
      return raw?.email_verified === true || raw?.email_verified === "true";
    case "discord":
      return raw?.verified === true;
    case "spotify":
    case "facebook":
      return true;
    default:
      return false;
  }
}

function getDevAuthProfile() {
  return {
    id: process.env.DEV_AUTH_BYPASS_USER_ID?.trim() || "local-dev-user",
    email: process.env.DEV_AUTH_BYPASS_EMAIL?.trim() || "local-dev@allfantasy.local",
    username: process.env.DEV_AUTH_BYPASS_USERNAME?.trim() || "local_dev_user",
    displayName: process.env.DEV_AUTH_BYPASS_NAME?.trim() || "Local Dev User",
  };
}

async function ensureDevAuthUser() {
  const profile = getDevAuthProfile();
  let user = await prisma.appUser.findFirst({
    where: {
      OR: [
        { id: profile.id },
        { email: { equals: profile.email, mode: "insensitive" } },
        { username: profile.username },
      ],
    },
  });

  if (!user) {
    user = await prisma.appUser.create({
      data: {
        id: profile.id,
        email: profile.email,
        username: profile.username,
        displayName: profile.displayName,
        emailVerified: new Date(),
      },
    });
  } else {
    user = await prisma.appUser.update({
      where: { id: user.id },
      data: {
        email: profile.email,
        username: profile.username,
        displayName: profile.displayName,
        emailVerified: user.emailVerified ?? new Date(),
      },
    });
  }

  await ensureSharedAccountProfile({
    userId: user.id,
    displayName: profile.displayName,
  });

  await prisma.managerXPProfile.upsert({
    where: { managerId: user.id },
    create: {
      managerId: user.id,
      totalXP: 0,
      currentTier: getTierFromXP(0),
      xpToNextTier: getXPRemainingToNextTier(0),
    },
    update: {},
  });

  return user;
}

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    id: "credentials",
    name: "Password",
    credentials: {
      login: { label: "Email, username, or phone", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      try {
        const rawLogin = credentials?.login;
        const rawPassword = credentials?.password;

        if (!rawLogin || !rawPassword) {
          return null;
        }

        const login = rawLogin.trim();
        const password = rawPassword;

        const user = await resolveUnifiedAuthIdentity(login);

        if (!user) {
          return null;
        }

        if (!user.passwordHash) {
          const isSleeperOnlyAccount =
            typeof user.email === "string" &&
            user.email.endsWith("@sleeper.allfantasy.ai");

          if (isSleeperOnlyAccount) {
            throw new Error("SLEEPER_ONLY_ACCOUNT");
          }

          throw new Error("PASSWORD_NOT_SET");
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);

        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.displayName || user.username || user.email,
          username: user.username,
          image: user.avatarUrl,
        };
      } catch (err: unknown) {
        throw err;
      }
    },
  }),
  CredentialsProvider({
    id: "sleeper",
    name: "Sleeper",
    credentials: {
      sleeperUsername: { label: "Sleeper Username", type: "text" },
    },
    async authorize(credentials) {
      const rawUsername = credentials?.sleeperUsername;

      if (!rawUsername) {
        return null;
      }

      const sleeperUsername = rawUsername.trim();

      if (!sleeperUsername) {
        return null;
      }

      const sleeperLookup = await lookupSleeperUser(sleeperUsername);

      if (sleeperLookup.status === "unavailable") {
        throw new Error("SLEEPER_LOOKUP_UNAVAILABLE");
      }

      if (sleeperLookup.status !== "found") {
        return null;
      }

      const sleeperUser = sleeperLookup.user;
      const sleeperUserId = sleeperUser.user_id;
      const displayName = sleeperUser.display_name?.trim() || sleeperUsername;
      const avatarUrl = buildSleeperAvatarUrl(sleeperUser.avatar);

      let user = await prisma.appUser.findFirst({
        where: {
          username: `sleeper_${sleeperUserId}`,
        },
      });

      if (!user) {
        // ── P0-1 BETA-GATE (Sleeper-username new-account path) ───────────────────────
        // A Sleeper-username account has only a SYNTHETIC email, and P0-1 invites are
        // strictly EMAIL-BOUND (no token-only admission — an invite is not a transferable
        // access code). There is therefore no way to admit a NEW Sleeper account under the
        // closed beta, so it is blocked: the user must sign up with a real email or a social
        // account (both email-matched) first. Existing Sleeper accounts hit the `else`
        // branch above and sign in normally without ever needing an invite.
        if (isInviteOnlyEnabled()) {
          throw new Error("BETA_INVITE_REQUIRED");
        }

        user = await prisma.appUser.create({
          data: {
            email: `${sleeperUserId}@sleeper.allfantasy.ai`,
            username: `sleeper_${sleeperUserId}`,
            displayName,
            avatarUrl,
          },
        });
        // New Sleeper-auth account (create branch only; the `else` below is an
        // update of an existing account, which must stay silent). The email is a
        // synthetic non-inbox address — included but clearly labeled by method.
        // Fire-and-forget.
        void notifyOwnerOfNewSignup({
          email: user.email,
          method: "sleeper",
          userId: user.id,
          username: user.username,
        });
      } else {
        const needsUpdate =
          user.displayName !== displayName || user.avatarUrl !== avatarUrl;

        if (needsUpdate) {
          user = await prisma.appUser.update({
            where: { id: user.id },
            data: {
              displayName,
              avatarUrl,
            },
          });
        }
      }

      await ensureSharedAccountProfile({
        userId: user.id,
        displayName: user.displayName ?? displayName ?? user.username ?? null,
      });

      return {
        id: user.id,
        email: user.email,
        name: user.displayName || user.username || user.email,
        image: user.avatarUrl,
      };
    },
  }),
];

if (isDevAuthBypassEnabled()) {
  providers.unshift(
    CredentialsProvider({
      id: "dev-bypass",
      name: "Local Dev Access",
      credentials: {},
      async authorize() {
        const user = await ensureDevAuthUser();
        return {
          id: user.id,
          email: user.email,
          name: user.displayName || user.username || user.email,
          // Must be returned for the jwt callback to stamp `token.username` (it reads
          // `user.username` off this object). Without it the username gate in middleware.ts
          // sees a null username and redirects every dev-bypass session to /choose-username,
          // making the bypass unable to reach any gated page. Mirrors the `credentials`
          // provider, which has always returned this field.
          username: user.username,
          image: user.avatarUrl,
        };
      },
    })
  );
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const appleClientId = process.env.APPLE_CLIENT_ID;
const appleClientSecret = process.env.APPLE_CLIENT_SECRET;

if (googleClientId && googleClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      // Callback URL is always `${NEXTAUTH_URL}/api/auth/callback/google` — must match
      // "Authorized redirect URIs" in Google Cloud Console (same origin as NEXTAUTH_URL).
    })
  );
}

if (appleClientId && appleClientSecret) {
  providers.push(
    AppleProvider({
      clientId: appleClientId,
      clientSecret: appleClientSecret,
    })
  );
}

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

if (spotifyClientId && spotifyClientSecret) {
  providers.push(
    SpotifyProvider({
      clientId: spotifyClientId,
      clientSecret: spotifyClientSecret,
      allowDangerousEmailAccountLinking: true,
      // next-auth's default is `scope=user-read-email` alone, which is NOT enough for its
      // own userinfo step: that calls GET /v1/me, which requires `user-read-private` and
      // answers 403 without it — the token exchange succeeds and the callback then fails
      // with OAuthCallbackError. Requesting the shared list fixes sign-in and, because the
      // access token is persisted on AuthAccount, hands /api/spotify/token a token that
      // already carries playback scope — so signing in with Spotify connects the music
      // widget in the same step instead of requiring a second authorization.
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: { scope: SPOTIFY_SCOPES },
      },
    })
  );
}

const facebookClientId = process.env.FACEBOOK_CLIENT_ID;
const facebookClientSecret = process.env.FACEBOOK_CLIENT_SECRET;

if (facebookClientId && facebookClientSecret) {
  providers.push(
    FacebookProvider({
      clientId: facebookClientId,
      clientSecret: facebookClientSecret,
      // Callback URL: https://www.allfantasy.ai/api/auth/callback/facebook
      // Must be registered as a Valid OAuth Redirect URI in the Meta app dashboard.
      authorization: {
        url: "https://www.facebook.com/v17.0/dialog/oauth",
        params: {
          scope: "email,public_profile",
          // NOTE: auth_type=rerequest was removed. It triggered Facebook's GDPR
          // delegated-consent flow (flow=gdp, source=gdp_delegated) which issues an
          // authorization code WITHOUT the email scope even when the user has a
          // verified email and grants the permission on the consent screen. The
          // standard OAuth dialog (no auth_type override) correctly includes the
          // email scope in the returned access token.
        },
      },
      // openid-client's client.userinfo() does NOT forward `params` as URL query
      // parameters to the Facebook Graph API — Graph falls back to id,name only.
      // Use a direct fetch so ?fields= is explicitly included in the request.
      userinfo: {
        url: "https://graph.facebook.com/me",
        params: { fields: "id,name,email,picture" },
        async request({ tokens }: { tokens: { access_token?: string } }) {
          // Do NOT use URLSearchParams — it encodes commas as %2C.
          // Facebook Graph API treats "id%2Cname%2Cemail%2Cpicture" as a
          // single unknown field name and returns only the default {id, name};
          // email is never present in the response regardless of token scope.
          const graphUrl =
            `https://graph.facebook.com/me?fields=id,name,email,picture` +
            `&access_token=${encodeURIComponent(tokens.access_token ?? "")}`;
          const res = await fetch(graphUrl);
          const data = (await res.json()) as Record<string, unknown>;
          // Facebook Graph API can return HTTP 200 with an error body
          // (e.g. OAuthException code 190/466 — token was invalidated).
          // A plain `!res.ok` check misses this; inspect the body too.
          const fbError = (data as {
            error?: { message?: string; code?: number; error_subcode?: number }
          }).error;
          if (!res.ok || fbError) {
            const msg = fbError
              ? `Facebook Graph API OAuthException ${fbError.code ?? "?"}/${fbError.error_subcode ?? "?"}`
              : `Facebook Graph API HTTP ${res.status}`;
            console.error("[facebook-userinfo] error:", msg);
            throw new Error(msg);
          }
          console.log("[facebook-userinfo]", {
            hasId: !!data.id,
            hasEmail: !!data.email,
            hasPicture: !!data.picture,
            // responseKeys lets us see exactly which fields Facebook returned
            // so we can distinguish "email absent" vs "email present but falsy"
            responseKeys: Object.keys(data),
          });
          return data;
        },
      },
      // Safe profile mapper — picture is absent if user denied the permission.
      profile(profile: {
        id: string;
        name?: string;
        email?: string;
        picture?: { data?: { url?: string } };
      }) {
        return {
          id: profile.id,
          name: profile.name ?? null,
          email: profile.email ?? null,
          image: profile.picture?.data?.url ?? null,
        };
      },
    })
  );
}

// This app already has a separate Discord OAuth flow for account/bot integration
// (lib/discord/constants.ts, /api/auth/discord/callback, /api/discord/bot-callback)
// with its own registered redirect URIs. Deliberately NOT reusing that client id
// here — NextAuth login needs its own explicit DISCORD_CLIENT_ID/SECRET, and
// https://www.allfantasy.ai/api/auth/callback/discord (+ the localhost equivalent)
// must be added as an ADDITIONAL redirect URI on whichever Discord app is used for
// login, so the two flows never collide.
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;

if (discordClientId && discordClientSecret) {
  providers.push(
    DiscordProvider({
      clientId: discordClientId,
      clientSecret: discordClientSecret,
      // Default authorization scope is already "identify+email".
    })
  );
}

/** NextAuth reads `NEXTAUTH_URL` from the environment for OAuth redirects (set in Vercel to your canonical origin). */
export const authOptions: NextAuthOptions = {
  secret: getAuthSecret(),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
  logger: {
    error(code, metadata) {
      const inner = (metadata as { error?: Error } | null | undefined)?.error
      console.error(
        `[nextauth-error] ${code}`,
        inner ? `${inner.name}: ${inner.message}` : JSON.stringify(metadata)
      )
    },
    warn(code) {
      console.warn(`[nextauth-warn] ${code}`)
    },
    debug() {/* suppress in prod */},
  },
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account) {
        return true;
      }

      if (account.provider === "google" || account.provider === "apple" || account.provider === "spotify" || account.provider === "facebook" || account.provider === "discord") {
        const runSocialLink = async (): Promise<true> => {
          const oauthEmail = resolveOAuthEmailFromCallback(user, profile);
          if (oauthEmail) {
            user.email = oauthEmail;
          }

          // Facebook may not return an email if the user hasn't granted permission
          // or has no confirmed email on their account. Fail early with a clear error.
          if (account.provider === "facebook" && !oauthEmail) {
            throw new Error("FACEBOOK_EMAIL_MISSING");
          }

          // Discord accounts normally carry a verified email, but guard the same way
          // in case a user somehow reaches this callback without one.
          if (account.provider === "discord" && !oauthEmail) {
            throw new Error("DISCORD_EMAIL_MISSING");
          }

          const provider: "google" | "apple" | "spotify" | "facebook" | "discord" =
            account.provider === "google"
              ? "google"
              : account.provider === "apple"
                ? "apple"
                : account.provider === "facebook"
                  ? "facebook"
                  : account.provider === "discord"
                    ? "discord"
                    : "spotify";
          const linkedUser = await linkSocialAccountToAppUser({
            provider,
            providerAccountId: account.providerAccountId,
            type: account.type,
            email: oauthEmail ?? user.email,
            emailVerified: resolveOAuthEmailVerifiedFromCallback(provider, profile),
            name: user.name,
            image: user.image,
            refreshToken: account.refresh_token,
            accessToken: account.access_token,
            expiresAt: account.expires_at,
            tokenType: account.token_type,
            scope: account.scope,
            idToken: account.id_token,
            sessionState:
              typeof account.session_state === "string" ? account.session_state : null,
          });

          (user as { id?: string }).id = linkedUser.id;
          user.email = linkedUser.email;
          user.name = linkedUser.displayName || linkedUser.username || linkedUser.email;
          user.image = linkedUser.avatarUrl;
          // Propagate DB username so the JWT callback can stamp token.username
          // (without this, token.username is always null for OAuth users)
          ;(user as { username?: string | null }).username = linkedUser.username ?? null

          return true;
        };

        if (account.provider === "google") {
          console.log("[google-signin] profile email:", profile?.email);
          try {
            return await runSocialLink();
          } catch (err) {
            console.error("[google-signin] FATAL:", err);
            const errMsg = err instanceof Error ? err.message : "";
            // P0-1 BETA-GATE: a new OAuth account was refused for lack of valid closed-beta
            // admission. Send the user back to signup with an honest reason (no token here).
            if (errMsg.startsWith("BETA_INVITE_")) {
              return `/signup?beta=1&betaError=${encodeURIComponent(errMsg.slice("BETA_INVITE_".length))}`;
            }
            if (errMsg === "SOCIAL_EMAIL_UNVERIFIED") {
              return "/auth/error?error=SOCIAL_EMAIL_UNVERIFIED";
            }
            console.error(
              `[social-link] SOCIAL_ACCOUNT_LINK_FAILED provider=google message=${errMsg || String(err)}`
            );
            return "/auth/error?error=SOCIAL_ACCOUNT_LINK_FAILED";
          }
        }

        if (account.provider === "facebook") {
          const _fbp = profile as Record<string, unknown> | null | undefined;
          console.log("[facebook-signin]", {
            provider: "facebook",
            hasId: !!_fbp?.id,
            hasEmail: !!_fbp?.email,
            hasPicture: !!_fbp?.picture,
            // grantedScope is what Facebook placed in the token response;
            // if email scope is absent here the token cannot access the email field
            grantedScope: account.scope ?? null,
          });
          try {
            return await runSocialLink();
          } catch (err) {
            console.error("[facebook-signin] FATAL:", err);
            const errMsg = err instanceof Error ? err.message : "";
            if (errMsg === "FACEBOOK_EMAIL_MISSING") {
              return "/auth/error?error=FACEBOOK_EMAIL_MISSING";
            }
            if (errMsg === "SOCIAL_EMAIL_UNVERIFIED") {
              return "/auth/error?error=SOCIAL_EMAIL_UNVERIFIED";
            }
            console.error(
              `[social-link] SOCIAL_ACCOUNT_LINK_FAILED provider=facebook message=${errMsg || String(err)}`
            );
            return "/auth/error?error=SOCIAL_ACCOUNT_LINK_FAILED";
          }
        }

        if (account.provider === "discord") {
          try {
            return await runSocialLink();
          } catch (err) {
            console.error("[discord-signin] FATAL:", err);
            const errMsg = err instanceof Error ? err.message : "";
            if (errMsg === "DISCORD_EMAIL_MISSING") {
              return "/auth/error?error=DISCORD_EMAIL_MISSING";
            }
            if (errMsg === "SOCIAL_EMAIL_UNVERIFIED") {
              return "/auth/error?error=SOCIAL_EMAIL_UNVERIFIED";
            }
            console.error(
              `[social-link] SOCIAL_ACCOUNT_LINK_FAILED provider=discord message=${errMsg || String(err)}`
            );
            return "/auth/error?error=SOCIAL_ACCOUNT_LINK_FAILED";
          }
        }

        try {
          return await runSocialLink();
        } catch (error) {
          console.error(`[auth] social account linking error provider=${account.provider}:`, error);
          // linkSocialAccountToAppUser() already refuses to create a NEW AppUser
          // without an email (SOCIAL_PROVIDER_EMAIL_MISSING) — this only maps that
          // to a clearer message. It does NOT add a new early guard: Apple only
          // returns email on a user's FIRST authorization, so a blanket "no email
          // -> reject" check here (before the existing-account lookup) would break
          // legitimate repeat Apple sign-ins for already-linked accounts.
          const errMsg = error instanceof Error ? error.message : "";
          // P0-1 BETA-GATE (Apple/Spotify/other): new-account admission refused.
          if (errMsg.startsWith("BETA_INVITE_")) {
            return `/signup?beta=1&betaError=${encodeURIComponent(errMsg.slice("BETA_INVITE_".length))}`;
          }
          if (errMsg === "SOCIAL_PROVIDER_EMAIL_MISSING") {
            return "/auth/error?error=SOCIAL_PROVIDER_EMAIL_MISSING";
          }
          if (errMsg === "SOCIAL_EMAIL_UNVERIFIED") {
            return "/auth/error?error=SOCIAL_EMAIL_UNVERIFIED";
          }
          console.error(
            `[social-link] SOCIAL_ACCOUNT_LINK_FAILED provider=${account.provider} message=${errMsg || String(error)}`
          );
          return "/auth/error?error=SOCIAL_ACCOUNT_LINK_FAILED";
        }
      }

      return true;
    },
    async jwt({ token, user, trigger, session: updatePayload }) {
      try {
        // Handle useSession().update({ username }) from the choose-username flow.
        // This re-stamps the cookie so the middleware gate sees the new username
        // immediately — no sign-out/sign-in cycle required.
        if (trigger === "update") {
          const payload = updatePayload as Record<string, unknown> | null | undefined
          if (typeof payload?.username === "string") {
            token.username = payload.username || null
          } else if (token.id) {
            // Fallback: re-read from DB for stale tokens that had no username at login
            const fresh = await prisma.appUser
              .findUnique({
                where: { id: token.id as string },
                select: { username: true },
              })
              .catch(() => null)
            if (fresh?.username) token.username = fresh.username
          }
          return token
        }

        if (user) {
          token.id = user.id;
          token.email = user.email;
          token.name = user.name;
          token.username = (user as { username?: string | null }).username ?? null;
          token.picture = user.image;
        }

        return token;
      } catch (err) {
        // Never let an exception here propagate — NextAuth catches any jwt callback
        // throw and re-raises it as OAuthCallbackError, breaking OAuth sign-in.
        console.error("[auth] jwt callback error:", err)
        return token
      }
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = typeof token.email === "string" ? token.email : session.user.email;
        session.user.name =
          typeof token.name === "string" ? token.name : session.user.name;
        session.user.username =
          typeof token.username === "string" ? token.username : null;
        session.user.image =
          typeof token.picture === "string" ? token.picture : session.user.image;

        const userId = typeof token.id === "string" ? token.id : undefined;
        if (userId) {
          session.user.id = userId;
        }

        let spotifyLinked = false;
        if (userId && process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
          try {
            const spotify = await prisma.authAccount.findFirst({
              where: { userId, provider: "spotify" },
              select: { id: true },
            });
            spotifyLinked = Boolean(spotify?.id);
            if (!spotifyLinked) {
              const profileSpotify = await prisma.userProfile.findUnique({
                where: { userId },
                select: { spotifyConnectedAt: true },
              });
              spotifyLinked = Boolean(profileSpotify?.spotifyConnectedAt);
            }
          } catch {
            spotifyLinked = false;
          }
        }
        session.user.spotifyAccount = spotifyLinked;
      }

      return session;
    },
    /**
     * After OAuth (e.g. Google), always land on the app dashboard so users are not
     * dropped back on `/login` when `url` resolves incorrectly for the deployment.
     * (NEXTAUTH_URL must match the site origin for OAuth callbacks.)
     */
    async redirect({ url, baseUrl }) {
      const base = baseUrl.replace(/\/$/, "");
      if (!url) {
        return `${base}/dashboard`;
      }

      // Extract pathname + query from full URLs (handles www vs non-www mismatches).
      let pathAndQuery = "/";
      try {
        const parsed = new URL(url, base);
        pathAndQuery = parsed.pathname + parsed.search;
      } catch {
        pathAndQuery = url.startsWith("/") ? url : `/${url}`;
      }

      pathAndQuery = canonicalizeProductRoute(pathAndQuery);

      // After OAuth, NextAuth may resolve `callbackUrl` to `/login` or `/`; send users into the app.
      const pathname = pathAndQuery.split("?")[0] || "/";
      if (isPostOAuthRedirectPreservedPath(pathname)) {
        return `${base}${pathAndQuery}`;
      }
      if (pathname === "/login" || pathname === "/") {
        return `${base}/dashboard`;
      }

      return `${base}${pathAndQuery}`;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user?.id) return;

      try {
        await ensureSharedAccountProfile({
          userId: user.id,
          displayName: user.name ?? null,
        });
      } catch (error) {
        console.error("[auth] signIn event error:", error);
      }

      // AF_GATE0 §3.5 — universal guest→account trial migration. Runs on EVERY
      // sign-in path (OAuth/social AND credentials), so a visitor who did the
      // no-login Sleeper import and then signs up with Google (not just email +
      // password) keeps 100% of their imported leagues/history. Idempotent and
      // best-effort — an absent guest cookie is the common no-op; never blocks login.
      // `next/headers` is imported dynamically so this module never pulls it into
      // any non-request server context that might import `authOptions`.
      try {
        const { cookies } = await import("next/headers");
        const guestToken = (await cookies()).get(GUEST_SESSION_COOKIE_NAME)?.value;
        if (guestToken) {
          await claimGuestTrialForUser(user.id, guestToken);
        }
      } catch (claimErr) {
        console.warn("[auth] guest trial claim (signIn event) failed (non-blocking):", claimErr);
      }

      // Capture a "login" IdentitySignal. Two consumers:
      //  1. DuplicateManagerRiskService — correlating shared IP/device across accounts.
      //  2. The admin Command Center login metrics, which previously counted
      //     AuthSession.createdAt — a column that does not exist, so every login
      //     card silently rendered 0. IdentitySignal is the real event source.
      // Only "league_join" was ever recorded before this, so no login was captured
      // anywhere in the real auth flow.
      // Deliberately its OWN try/catch: sharing the block above would mean a guest
      // -claim throw silently skips login capture entirely. IP/UA are HMAC-hashed by
      // the recorder — raw values are never stored. Best-effort; never blocks sign-in.
      try {
        const { headers } = await import("next/headers");
        const h = await headers();
        const { recordIdentitySignal } = await import("@/lib/identity/IdentitySignalRecorder");
        await recordIdentitySignal({
          userId: user.id,
          ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          userAgent: h.get("user-agent"),
          context: "login",
        });
      } catch (signalErr) {
        console.warn("[auth] identity signal capture (signIn event) failed (non-blocking):", signalErr);
      }

      // Join the anonymous pre-auth campaign journey to this account. The attribution
      // cookies are set server-side in middleware and are SameSite=Lax specifically so
      // they survive the OAuth provider's cross-site redirect back to us — this is the
      // one moment where the anonymous journey and the real user id are both in hand.
      // Its own try/catch, matching the blocks above: a failure here must not skip
      // anything else, and must never block sign-in.
      try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const { linkAttributionToUser } = await import("@/lib/analytics/linkAttributionToUser");
        await linkAttributionToUser({
          userId: user.id,
          getCookie: (name) => cookieStore.get(name)?.value,
        });
      } catch (attributionErr) {
        console.warn("[auth] attribution link (signIn event) failed (non-blocking):", attributionErr);
      }
    },
  },
};