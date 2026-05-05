/**
 * /dashboard/admin/world-cup
 * Admin control panel: list all World Cup bracket challenges, trigger actions.
 */
import { redirect } from "next/navigation"
import { hasWorldCupAdminPageSession } from "@/lib/world-cup/adminPage"
import WorldCupAdminPanel from "./WorldCupAdminPanel"

export const dynamic = "force-dynamic"

export default function WorldCupAdminPage() {
  if (!hasWorldCupAdminPageSession()) {
    redirect("/admin/login?callbackUrl=/dashboard/admin/world-cup")
  }
  return <WorldCupAdminPanel />
}
