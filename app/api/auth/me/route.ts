import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAdminSessionCookie } from "@/lib/adminSession"
import { isAdminSessionPayloadUsable } from "@/lib/adminAuth"

export const GET = withApiUsage({ endpoint: "/api/auth/me", tool: "AuthMe" })(async () => {
  const cookieStore = await cookies()
  const adminSession = cookieStore.get('admin_session')

  if (!adminSession?.value) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const sessionData = verifyAdminSessionCookie(adminSession.value)
  if (!sessionData?.authenticated || !isAdminSessionPayloadUsable(sessionData)) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({
    user: {
      id: sessionData.id || 'admin',
      email: sessionData.email ?? null,
      name: sessionData.name || sessionData.email || 'Admin',
      role: sessionData.role || 'admin',
    }
  })
})
