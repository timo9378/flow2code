/**
 * AI Generate FlowIR API
 *
 * POST /api/generate
 * Body: { prompt: string }
 *
 * Delegates to shared handler in handlers.ts
 */

import { NextResponse } from "next/server";
import { handleGenerate } from "@/server/handlers";

export async function POST(req: Request) {
  if (process.env.READONLY === "true") {
    return NextResponse.json(
      { error: "AI generation is disabled on this public instance" },
      { status: 403 },
    );
  }
  const body = await req.json();
  const result = await handleGenerate(body);
  return NextResponse.json(result.body, { status: result.status });
}
