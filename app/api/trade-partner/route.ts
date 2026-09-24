import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import {
  TradePartnerRequestSchema,
  TradePartnerResponseSchema,
  TRADE_PARTNER_SYSTEM_PROMPT,
  buildTradePartnerUserPrompt,
} from '@/lib/trade-partner-prompt';
import { getClientIp, rateLimit } from '@/lib/rate-limit';

const openai = getOpenAIRouteClient();

export const POST = withApiUsage({ endpoint: "/api/trade-partner", tool: "TradePartner" })(async (request: NextRequest) => {
  try {
    const ip = getClientIp(request);
    const rateLimitResult = rateLimit(ip, 10, 60000);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parseResult = TradePartnerRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request format', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const partnerRequest = parseResult.data;
    const userPrompt = buildTradePartnerUserPrompt(partnerRequest);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: TRADE_PARTNER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content;

    if (!responseText) {
      return NextResponse.json(
        { error: 'No response from AI' },
        { status: 500 }
      );
    }

    const aiResponse = JSON.parse(responseText);
    const validatedResponse = TradePartnerResponseSchema.safeParse(aiResponse);

    if (!validatedResponse.success) {
      console.error('AI response validation failed:', validatedResponse.error);
      return NextResponse.json({
        success: true,
        data: aiResponse,
        validated: false,
      });
    }

    return NextResponse.json({
      success: true,
      data: validatedResponse.data,
      validated: true,
    });
  } catch (error) {
    console.error('Trade Partner AI error:', error);
    return NextResponse.json(
      { error: 'Failed to find trade partners', details: String(error) },
      { status: 500 }
    );
  }
})
