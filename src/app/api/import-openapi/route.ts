/**
 * OpenAPI Import API Route
 *
 * POST /api/import-openapi
 * Body: { spec: string | object, filter?: { tags?: string[], paths?: string[] } }
 *
 * Delegates to shared handler in handlers.ts
 */

import { NextResponse } from "next/server";
import { handleImportOpenAPI } from "@/server/handlers";

export async function POST(req: Request) {
  const body = await req.json();
  const result = handleImportOpenAPI(body);
  return NextResponse.json(result.body, { status: result.status });
}
