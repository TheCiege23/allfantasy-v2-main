import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { safeInternalPathOr } from "@/lib/auth/auth-intent-resolver"
import ChooseUsernameForm from "./ChooseUsernameForm"

function resolveCallbackUrl(callbackUrl: string | undefined): string {
  const safe = safeInternalPathOr(callbackUrl, "/dashboard")
  return safe.startsWith("/choose-username") ? "/dashboard" : safe
}

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>
}

export const metadata = {
  title: "Choose your username – AllFantasy",
}

export default async function ChooseUsernamePage({ searchParams }: Props) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; username?: string | null }
  } | null

  // Unauthenticated → login
  if (!session?.user?.id) {
    redirect("/login")
  }

  // JWT already has a username → gate clears, send them on
  if (session.user.username) {
    const { callbackUrl } = await searchParams
    redirect(resolveCallbackUrl(callbackUrl))
  }

  // Read the auto-generated username from DB so we can pre-fill the input.
  // OAuth users always have a username in the DB (generated at account creation)
  // but it may not yet be in the JWT.
  const appUser = await prisma.appUser
    .findUnique({
      where: { id: session.user.id },
      select: { username: true },
    })
    .catch(() => null)

  const { callbackUrl } = await searchParams
  const safeCallbackUrl = resolveCallbackUrl(callbackUrl)

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <ChooseUsernameForm
        prefill={appUser?.username ?? ""}
        callbackUrl={safeCallbackUrl}
      />
    </main>
  )
}
