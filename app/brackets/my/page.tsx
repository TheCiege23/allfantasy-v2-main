import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { listMyBrackets, type MyBracketLeague } from "@/lib/playoffs/myBrackets"
import { resolveServerRenderPreferences } from "@/lib/preferences/ServerRenderPreferenceResolver"
import MyBracketsList from "@/components/brackets/MyBracketsList"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "My Brackets | AllFantasy", robots: { index: false, follow: false } }

export default async function MyBracketsPage() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) redirect("/login?callbackUrl=%2Fbrackets%2Fmy")
  const { language } = await resolveServerRenderPreferences()
  let leagues: MyBracketLeague[] = []
  let failed = false
  try { leagues = await listMyBrackets(userId) }
  catch { failed = true }
  return <MyBracketsList leagues={leagues} language={language} failed={failed} />
}
