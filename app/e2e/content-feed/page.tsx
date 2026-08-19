import { notFound } from "next/navigation"
import { ContentFeedPage } from "@/components/content-feed"

export default async function E2EContentFeedPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E Content Feed Harness</h1>
      <ContentFeedPage />
    </main>
  )
}
