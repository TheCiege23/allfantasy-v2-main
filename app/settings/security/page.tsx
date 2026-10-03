import { redirect } from "next/navigation"

/**
 * /settings/security → the Security tab of /settings.
 *
 * This was a standalone page wrapping SecuritySettingsSection that nothing linked to (checked
 * 2026-10-02: no href, router.push or redirect anywhere targets it). Outside the `.nocturne-settings`
 * subtree it drew the section's `var(--text)` on a hardcoded #07071a ground — dark-on-dark in the
 * light theme — and showed none of the hook's inline error states. A redirect keeps any old bookmark
 * working and leaves one Security screen to maintain.
 */
export default function SecuritySettingsPage(): never {
  redirect("/settings?tab=security")
}
