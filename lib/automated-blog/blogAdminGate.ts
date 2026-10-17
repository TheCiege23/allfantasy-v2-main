import { getAdminAccessState, requireAdminOrBearer } from "@/lib/adminAuth"

/**
 * Who may see or change unpublished blog content.
 *
 * Writing, generating, publishing and previewing drafts are all admin actions.
 * Until these gates existed the blog API had no auth at all — any anonymous
 * request could create, edit and publish an article, and the article body was
 * rendered as raw HTML on the main origin.
 *
 * Both helpers go through the canonical admin authority (`lib/adminAuth`).
 */

/**
 * Both checks read cookies. A Next.js control-flow throw carries a `digest`
 * (DYNAMIC_SERVER_USAGE during prerender, NEXT_REDIRECT, NEXT_NOT_FOUND) and
 * MUST propagate: swallowing DYNAMIC_SERVER_USAGE makes Next treat the route as
 * static and cache one viewer's render for everyone. Only an ordinary failure
 * (DB down, no request scope) degrades to "not an admin".
 */
function rethrowNextSignal(error: unknown): void {
  if (error && typeof error === "object" && "digest" in error) throw error
}

/** For server components: is the current viewer an admin? */
export async function isBlogAdmin(): Promise<boolean> {
  try {
    return (await getAdminAccessState()).status === "admin"
  } catch (error) {
    rethrowNextSignal(error)
    return false
  }
}

/** For route handlers that only WIDEN what they return for an admin (never 401). */
export async function isBlogAdminRequest(req: Request): Promise<boolean> {
  try {
    return (await requireAdminOrBearer(req)).ok
  } catch (error) {
    rethrowNextSignal(error)
    return false
  }
}
