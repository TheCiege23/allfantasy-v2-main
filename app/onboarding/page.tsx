import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import OnboardingForm from "./OnboardingForm"
import { isUserVerified } from "@/lib/auth-guard"

type SessionUser = { id?: string; email?: string | null }

export const dynamic = "force-dynamic"

export default async function OnboardingPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: SessionUser
  } | null
  const userId = session?.user?.id
  const email = session?.user?.email

  if (!userId || !email) {
    redirect("/login?callbackUrl=/onboarding")
  }

  const [existing, appUser] = await Promise.all([
    (prisma as any).userProfile.findUnique({ where: { userId } }).catch(() => null),
    (prisma as any).appUser
      .findUnique({
        where: { id: userId },
        select: { displayName: true, username: true, emailVerified: true, avatarUrl: true },
      })
      .catch(() => null),
  ])

  // Already fully onboarded → straight to the app (keeps this route idempotent
  // and safe for anyone who lands here after finishing).
  if (
    isUserVerified(appUser?.emailVerified, existing?.phoneVerifiedAt) &&
    existing?.ageConfirmedAt &&
    existing?.profileComplete
  ) {
    redirect("/dashboard")
  }

  const pending = await (prisma as any).pendingSignup
    .findUnique({ where: { email } })
    .catch(() => null)

  const defaultName =
    pending?.displayName || existing?.displayName || appUser?.displayName || ""
  const defaultPhone = pending?.phone || existing?.phone || ""
  const emailVerified = !!appUser?.emailVerified
  const phoneVerified = !!existing?.phoneVerifiedAt

  return (
    <div className="nocturne-auth min-h-screen" style={{ background: "var(--color-bg)" }}>
      <div
        style={{
          borderBottom: "1px solid color-mix(in srgb, var(--color-text) 7%, transparent)",
        }}
      >
        <div
          className="mx-auto flex items-center"
          style={{ height: 64, padding: "0 24px", maxWidth: 560 }}
        >
          <Link href="/" aria-label="AllFantasy home">
            <img
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy"
              style={{ height: 26, width: "auto" }}
            />
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "36px 24px 64px" }}>
        <h1 style={{ fontSize: 27, lineHeight: 1.2, margin: "0 0 6px" }}>Set up your profile</h1>
        <p style={{ fontSize: 14, color: "var(--color-neutral-500)", margin: "0 0 20px" }}>
          A few quick details so your leagues know who you are. You can change any of this later.
        </p>

        {emailVerified && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 16,
              padding: "10px 13px",
              fontSize: 13,
              borderRadius: "var(--radius-md)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)",
              background: "var(--color-accent-900)",
              color: "var(--color-accent-300)",
            }}
          >
            <CheckCircle2 size={16} style={{ flex: "none" }} />
            Email verified ({email})
          </div>
        )}

        {!emailVerified && !phoneVerified && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              fontSize: 13,
              lineHeight: 1.5,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-neutral-800)",
              background: "color-mix(in srgb, var(--color-surface) 60%, transparent)",
              color: "var(--color-neutral-400)",
            }}
          >
            Your email isn&apos;t verified yet. Check your inbox for the link, or{" "}
            <Link href="/verify">request a new one</Link> — then finish setup.
          </div>
        )}

        <OnboardingForm
          defaultName={defaultName}
          defaultUsername={appUser?.username ?? ""}
          defaultPhone={defaultPhone}
          defaultTimezone={existing?.timezone ?? null}
          defaultLanguage={existing?.preferredLanguage ?? null}
          defaultAvatarPreset={existing?.avatarPreset ?? null}
          currentAvatarUrl={appUser?.avatarUrl ?? null}
          phoneVerified={phoneVerified}
          isVerified={emailVerified || phoneVerified}
        />
      </div>
    </div>
  )
}
