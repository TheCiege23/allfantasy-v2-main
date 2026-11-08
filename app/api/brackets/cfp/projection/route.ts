import { NextResponse } from "next/server"
import { readCfpProjection } from "@/lib/playoffs/cfpPreviewCache"
export const dynamic = "force-dynamic"
export async function GET() {
  try {
    const data = await readCfpProjection()
    if (data) return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } })
  } catch { /* Fall back to the dated snapshot in the client. */ }
  return NextResponse.json({ error: "Rankings temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
}
