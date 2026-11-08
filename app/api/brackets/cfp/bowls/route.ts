import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"
import { getCfbdApiKey } from "@/lib/cfbd-env"
import { parseCfpBowlDetails } from "@/lib/playoffs/cfpBowlDetails"

export const dynamic = "force-dynamic"
const readBowls = unstable_cache(async () => {
  const key = getCfbdApiKey()
  if (!key) throw new Error("provider unavailable")
  const response = await fetch("https://api.collegefootballdata.com/playoffs/cfp?year=2026", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error("provider unavailable")
  return parseCfpBowlDetails(await response.json())
}, ["cfp-bowl-details-2026-v1"], { revalidate: 900 })

export async function GET() {
  try {
    return NextResponse.json({ games: await readBowls() }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ games: [] }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
