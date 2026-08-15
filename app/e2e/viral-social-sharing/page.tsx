import { notFound } from "next/navigation"
import ViralSocialSharingHarnessClient from "./ViralSocialSharingHarnessClient"

export default function E2EViralSocialSharingPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <ViralSocialSharingHarnessClient />
}
