import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import ProfilePageClient from "./ProfilePageClient"

export default async function ProfilePage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null; name?: string | null }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/profile")
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 mode-readable">
      <div className="mb-6">
        <Link href="/core" className="inline-flex text-xs font-medium mode-muted hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-semibold mode-text">Profile</h1>
        <p className="mt-2 text-sm mode-muted">
          Your identity, preferences, and quick links. Edit below or open Settings for more options.
        </p>
      </div>
      <ProfilePageClient isOwnProfile={true} />
    </main>
  )
}
