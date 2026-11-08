import { NextResponse } from "next/server"
import { readCfpBowls } from "@/lib/playoffs/cfpPreviewCache"
export const dynamic = "force-dynamic"
export async function GET() {
  try { return NextResponse.json({ games: await readCfpBowls() }, { headers: { "Cache-Control": "no-store" } }) }
  catch { return NextResponse.json({ games: [] }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
