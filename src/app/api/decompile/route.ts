import { NextResponse } from "next/server";
import { handleDecompile } from "@/server/handlers";

export async function POST(req: Request) {
  const body = await req.json();
  const result = handleDecompile(body);
  return NextResponse.json(result.body, { status: result.status });
}
