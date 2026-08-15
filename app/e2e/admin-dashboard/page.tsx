import { notFound } from "next/navigation"
import { AdminDashboardHarnessClient } from "./AdminDashboardHarnessClient"

export default function E2EAdminDashboardPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }
  return <AdminDashboardHarnessClient />
}
