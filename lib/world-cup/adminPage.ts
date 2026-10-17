import "server-only"
import { cookies } from "next/headers"
import { isAdminEmailAllowed } from "@/lib/adminAuth"
import { verifyAdminSessionCookie } from "@/lib/adminSession"
export async function hasWorldCupAdminPageSession(): Promise<boolean> { const raw = (await cookies()).get("admin_session")?.value; if (!raw) return false; const p = verifyAdminSessionCookie(raw); if (!p?.authenticated) return false; return p.role?.toLowerCase() === "admin" || isAdminEmailAllowed(p.email) }
