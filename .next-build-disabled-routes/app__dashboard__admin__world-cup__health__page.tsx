/**
 * /dashboard/admin/world-cup/health
 * World Cup system health page for ops/admin.
 */
import { redirect } from "next/navigation"
import { hasWorldCupAdminPageSession } from "@/lib/world-cup/adminPage"
import WorldCupHealthDashboard from "./WorldCupHealthDashboard"

export const dynamic = "force-dynamic"

export default function WorldCupHealthPage() {
  if (!hasWorldCupAdminPageSession()) {
    redirect("/admin/login?callbackUrl=/dashboard/admin/world-cup/health")
  }
  return <WorldCupHealthDashboard />
}
