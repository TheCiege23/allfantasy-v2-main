import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe-client";
import { getBaseUrl } from "@/lib/get-base-url";
import { getActiveTournament } from "@/lib/tournament";
import {
  assertNoLeagueSettlementIntent,
  isMonetizationComplianceError,
} from "@/lib/monetization/compliance-guardrails";

type Body = {
  mode: "donate";
  amount: number;
  currency: "usd";
};

/*
 * 🛑 THE "BRACKET LAB PASS" ($9.99, `mode: "lab"`) IS NO LONGER SOLD. It promised
 * "simulation + strategy exploration tools for this tournament", and nothing ever
 * delivered them: no page renders the Lab dashboard (components/lab/LabDashboardShell),
 * the /api/lab routes it calls do not exist, and the webhook files a lab purchase under
 * LEGACY_PURCHASE_TYPES and grants nothing. Anyone who paid would have had a fair refund
 * or chargeback claim. Checked 2026-09-25 against live Stripe: no lab session was ever
 * created, so no one is owed anything. Donations are unchanged.
 */
const RETIRED_MODES = new Set(["lab"]);

export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const APP_URL = getBaseUrl();

    const body = (await req.json()) as Body;
    if (RETIRED_MODES.has(String(body?.mode ?? ""))) {
      return NextResponse.json(
        { error: "The Bracket Lab Pass is no longer sold." },
        { status: 410 }
      );
    }
    if (body?.mode !== "donate") {
      return NextResponse.json({ error: "Invalid checkout mode" }, { status: 400 });
    }
    assertNoLeagueSettlementIntent(body?.mode ?? "", {
      route: "/api/stripe/create-checkout-session",
      purchase_type: body?.mode ?? "",
    });

    if (!body || !body.amount || body.amount <= 0) {
      return NextResponse.json(
        { error: "Invalid amount" },
        { status: 400 }
      );
    }

    const tournament = await getActiveTournament();
    if (!tournament) {
      return NextResponse.json(
        { error: "No active tournament" },
        { status: 400 }
      );
    }

    const amountCents = Math.round(body.amount * 100);

    if (amountCents < 100 || amountCents > 50000) {
      return NextResponse.json(
        { error: "Donation must be between $1 and $500" },
        { status: 400 }
      );
    }

    const productName = "Donation";
    const description = "Optional support to fund servers, data costs, and performance improvements.";

    const stripe = getStripeClient();

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${APP_URL}/donate/success?mode=${body.mode}`,
      cancel_url: `${APP_URL}/donate?mode=${body.mode}`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: productName,
              description,
            },
            unit_amount: amountCents,
          },
        },
      ],
      metadata: {
        purchase_type: body.mode,
        userId: session.user.id,
        tournamentId: tournament.id,
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (e: any) {
    if (isMonetizationComplianceError(e)) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.statusCode }
      );
    }
    console.error("Stripe checkout error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
