import { notFound } from "next/navigation"
import { ProfileAvatarClickAuditHarnessClient } from "./ProfileAvatarClickAuditHarnessClient"

export default function ProfileAvatarClickAuditPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <ProfileAvatarClickAuditHarnessClient />
}
