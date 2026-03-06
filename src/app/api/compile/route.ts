import { NextResponse } from "next/server";
import { handleCompile } from "@/server/handlers";

export async function POST(req: Request) {
  const body = await req.json();
  // Support legacy format (direct IR without wrapper)
  const normalized = body.ir ? body : { ir: body };
  const result = await handleCompile({ ...normalized, write: false }, process.cwd());
  return NextResponse.json(result.body, { status: result.status });
}
