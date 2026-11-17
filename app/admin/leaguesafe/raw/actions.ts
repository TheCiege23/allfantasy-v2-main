"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { getAdminAccessState } from "@/lib/adminAuth"
import { getLeagueSafeInboundConfig } from "@/lib/leaguesafe/inbound-security"
import { processLeagueSafeNotification } from "@/lib/leaguesafe/process-notification"

/** Next server actions enforce same-origin POSTs. No bearer bypass or raw-content input. */
export async function parseStoredNotification(form: FormData): Promise<void> {
  const access = await getAdminAccessState()
  if (access.status !== "admin") redirect("/admin")
  const id = form.get("id")
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(id)) redirect("/admin/leaguesafe/raw?parse=invalid")
  const config = getLeagueSafeInboundConfig()
  let result: string = "unavailable"
  if (config) {
    try { result = await processLeagueSafeNotification(id, config.domains) }
    catch { console.error("[leaguesafe] manual_parse_failed") }
  }
  revalidatePath("/admin/leaguesafe/raw")
  redirect("/admin/leaguesafe/raw?" + new URLSearchParams({ id, parse: result }).toString())
}
