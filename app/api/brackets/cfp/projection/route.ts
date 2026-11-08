import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"
import { getCfbdApiKey } from "@/lib/cfbd-env"
import { projectCfpRankings } from "@/lib/playoffs/cfpRankingsProjection"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Cache successful provider responses, not failures, across page visits for 15 minutes.
const readProjection = unstable_cache(async () => {
  const key = getCfbdApiKey()
  if (!key) throw new Error("provider unavailable")
  const response = await fetch("https://api.collegefootballdata.com/rankings?year=2026&seasonType=regular", {
    headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error("provider unavailable")
  const projection = projectCfpRankings(await response.json())
  if (!projection) throw new Error("rankings incomplete")
  return projection
}, ["cfp-projected-rankings-2026-v1"], { revalidate: 900 })

export async function GET() {
  try {
    return NextResponse.json(await readProjection(), { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Rankings temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
