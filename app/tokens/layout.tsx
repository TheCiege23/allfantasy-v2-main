import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { buildSeoMeta } from "@/lib/seo";

/*
 * ⚠ TWO THINGS WERE WRONG HERE AND METADATA IS THE WORST PLACE FOR THAT, because
 * nobody sees it rot. It said "Subscribers may get discounted token pricing on
 * eligible actions" — that discount was removed with the subscription token
 * grants, so it described a benefit nobody can receive. And it used the word "AI"
 * four times in customer-facing copy, which the catalog's own naming rule forbids
 * ("Chimmy" or "Intelligence" instead) — in the page TITLE, of all places.
 *
 * Nothing here names a token quantity or a price on purpose: a number in metadata
 * would drift silently while the visible page stayed correct.
 */
export const metadata: Metadata = buildSeoMeta({
  title: "Tokens — AllFantasy.ai | Pay only for what you use",
  description:
    "Buy token packs through Stripe and see what every action costs before you run it. Tokens are the pay-per-use path — no subscription required, and what you buy does not reset monthly.",
  canonicalPath: "/tokens",
  openGraphTitle: "AllFantasy Tokens",
  openGraphDescription:
    "Pay only for what you use. Every action shows its cost up front. Checkout powered by Stripe.",
  keywords: ["AllFantasy tokens", "Chimmy tokens", "fantasy pay per use", "fantasy credits"],
});

export default async function TokensLayout({ children }: { children: React.ReactNode }) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/tokens");
  }

  return children;
}
