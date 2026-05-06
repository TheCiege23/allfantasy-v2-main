import { notFound } from "next/navigation"
import FeatureTogglesHarnessClient from "./FeatureTogglesHarnessClient"

export default function E2EFeatureTogglesPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }
  return <FeatureTogglesHarnessClient />
}
