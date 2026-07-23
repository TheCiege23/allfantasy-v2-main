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
  mode: "donate" | "lab";
  amount: number;
  currency: "usd";
};

export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const APP_URL = getBaseUrl();

    const body = (await req.json()) as Body;
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

    const isLab = body.mode === "lab";
    const amountCents = Math.round(body.amount * 100);

    if (isLab && amountCents !== 999) {
      return NextResponse.json(
        { error: "Invalid Lab Pass amount" },
        { status: 400 }
      );
    }

    if (!isLab && (amountCents < 100 || amountCents > 50000)) {
      return NextResponse.json(
        { error: "Donation must be between $1 and $500" },
        { status: 400 }
      );
    }

    const productName = isLab ? "Bracket Lab Pass (Tournament)" : "Donation";
    const description = isLab
      ? "Access to simulation + strategy exploration tools for this tournament."
      : "Optional support to fund servers, data costs, and performance improvements.";

    const stripe = getStripeClient();

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      // {CHECKOUT_SESSION_ID} is substituted by Stripe — gives the success page a verifiable
      // session reference instead of an unverifiable bare mode param.
      success_url: `${APP_URL}/donate/success?mode=${body.mode}&session_id={CHECKOUT_SESSION_ID}`,
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
