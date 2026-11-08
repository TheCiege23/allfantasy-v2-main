import type { Metadata } from "next"
import CfpProjectionPreview from "@/components/brackets/playoffs/CfpProjectionPreview"

export const metadata: Metadata = {
  title: "2026 CFP projected bracket | AllFantasy",
  description: "A look at the projected 2026 College Football Playoff bracket, based on the latest available CFP rankings. Subject to change.",
}

export default function CfpPreviewPage() {
  return <main style={{ minHeight: "100vh", padding: "clamp(16px, 5vw, 64px)", background: "#041113" }}><div style={{ maxWidth: 1120, margin: "0 auto" }}><CfpProjectionPreview standalone /></div></main>
}
