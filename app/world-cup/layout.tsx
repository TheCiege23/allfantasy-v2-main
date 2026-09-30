import type { Metadata } from "next"

const OG_IMAGE = "/images/brackets/world-cup/af-world-cup-hero-poster.jpg"

export const metadata: Metadata = {
  title: "Create Your 2026 World Cup Pool | AllFantasy.AI",
  description:
    "Create a free 2026 World Cup pool in 60 seconds. Invite friends, build brackets, track live standings, and get AI-powered predictions from Chimmy. Free to start. No gambling. Just bragging rights.",
  keywords: [
    "World Cup 2026 pool",
    "FIFA World Cup bracket",
    "free soccer pool",
    "World Cup predictions",
    "AllFantasy AI",
    "World Cup fantasy",
  ],
  openGraph: {
    title: "Create Your 2026 World Cup Pool — Free on AllFantasy.AI",
    description:
      "Set up a World Cup pool in 60 seconds. Invite friends, build brackets, track standings, and use Chimmy to predict the tournament. Free to start. No gambling.",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "2026 FIFA World Cup Pool & Bracket Challenge — AllFantasy.AI",
      },
    ],
    type: "website",
    siteName: "AllFantasy.AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "Create Your 2026 World Cup Pool | AllFantasy.AI",
    description:
      "Free World Cup pools, private groups, brackets, live standings, and AI-powered predictions. No gambling. Takes 60 seconds.",
    images: [OG_IMAGE],
    creator: "@AllFantasyAI",
  },
}

export default function WorldCupFunnelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
