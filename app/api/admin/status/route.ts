import { NextResponse } from "next/server"
import { getAdminAccessState } from "@/lib/adminAuth"
import { maskAdminEmail } from "@/lib/admin-dashboard/format"
import { getAdminProductionReadiness } from "@/lib/admin-dashboard/AdminProductionReadinessService"
import { getDeploymentIdentity } from "@/lib/admin-dashboard/deploymentIdentity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const state = await getAdminAccessState()
  const readiness = state.status === "admin" ? await getAdminProductionReadiness() : null

  if (state.status === "unauthenticated") {
    return NextResponse.json(
      { authenticated: false, admin: false, status: state.status },
      { status: 401 }
    )
  }

  if (state.status === "forbidden") {
    return NextResponse.json(
      {
        authenticated: true,
        admin: false,
        status: state.status,
        user: state.user
          ? {
              id: state.user.id ?? null,
              username: state.user.username ?? null,
              emailMasked: maskAdminEmail(state.user.email),
            }
          : null,
      },
      { status: 403 }
    )
  }

  return NextResponse.json({
    authenticated: true,
    admin: true,
    status: state.status,
    source: state.source,
    // Admin-only. Answers "which build, environment, and database am I looking at?"
    // without exposing any credential — see lib/admin-dashboard/deploymentIdentity.ts.
    deployment: getDeploymentIdentity(),
    readiness: readiness
      ? {
          missingCriticalEnv: readiness.env.filter((row) => row.status === "missing" && row.severity === "critical").map((row) => row.label),
          missingCronJobs: readiness.crons.filter((row) => row.status !== "configured").map((row) => row.label),
        }
      : null,
    user: {
      id: state.user.id ?? null,
      username: state.user.username ?? null,
      emailMasked: maskAdminEmail(state.user.email),
    },
  })
}
