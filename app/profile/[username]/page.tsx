import { getServerSession } from "next-auth"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ProfilePageClient from "../ProfilePageClient"

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; name?: string | null; email?: string | null }
  } | null

  let isOwnProfile = false
  if (session?.user?.id && username) {
    const appUser = await prisma.appUser.findUnique({
      where: { id: session.user.id },
      select: { username: true },
    })
    isOwnProfile =
      appUser?.username?.trim().toLowerCase() === username.trim().toLowerCase()
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 mode-readable">
        <div className="mb-6">
          <Link
            href={isOwnProfile ? "/dashboard" : "/"}
            className="inline-flex text-xs font-medium mode-muted hover:underline"
          >
            ← Back
          </Link>
          <h1 className="text-2xl font-semibold mode-text">
            {isOwnProfile ? "Your profile" : `@${username}`}
          </h1>
          {/* No intro line (2026-11-25, the simplify pass): the heading names whose profile this is. */}
        </div>
        <ProfilePageClient
          isOwnProfile={isOwnProfile}
          publicUsername={isOwnProfile ? null : username}
        />
    </main>
  )
}
