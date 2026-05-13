import type { Metadata } from "next"
import WorldCupBracketCreateModal from "@/components/brackets/world-cup/WorldCupBracketCreateModal"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Create a FIFA World Cup Bracket Pool | AllFantasy",
  description:
    "Start your own FIFA World Cup bracket pool on AllFantasy. Invite friends, configure scoring, and track every result.",
  openGraph: {
    title: "Create a FIFA World Cup Bracket Pool | AllFantasy",
    type: "website",
  },
}

export default function CreateWorldCupBracketPage() {
  return <WorldCupBracketCreateModal />
}
