import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import SettingsApp from "./components/SettingsApp"

export const metadata = {
  title: "Settings · AllFantasy",
  robots: { index: false, follow: false },
}

/**
 * The account's creation date, for the Account tab's "Member since" line (its hub card promises
 * it). Until 2026-10-02 this page passed `null` and the line never rendered.
 *
 * A failed read degrades to `null` — the section already omits the line then — rather than taking
 * the whole Settings page down over one date.
 */
async function readAccountCreatedAt(userId: string): Promise<string | null> {
  try {
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    })
    return user?.createdAt ? user.createdAt.toISOString() : null
  } catch {
    return null
  }
}

export default async function SettingsPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user) {
    redirect("/login?callbackUrl=/settings")
  }

  if (!session.user.id) {
    redirect("/login?callbackUrl=/settings")
  }

  const accountCreatedAt = await readAccountCreatedAt(session.user.id)

  return <SettingsApp uploadLeagueId={null} accountCreatedAt={accountCreatedAt} planLabel={null} />
}
