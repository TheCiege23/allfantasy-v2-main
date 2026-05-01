import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getSocialPublishHealthStatus } from "@/lib/social-clips-grok/SocialPublishHealthResolver"

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.res

  const status = await getSocialPublishHealthStatus()
  return NextResponse.json(status)
}
