import { NextResponse } from "next/server";
import { decompile } from "@/lib/compiler/decompiler";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code, fileName, functionName } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing 'code' string in request body" },
        { status: 400 }
      );
    }

    const result = decompile(code, {
      fileName: fileName ?? "input.ts",
      functionName,
      audit: true,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          errors: result.errors ?? ["Decompile failed"],
          confidence: result.confidence,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      ir: result.ir,
      confidence: result.confidence,
      errors: result.errors ?? [],
      audit: result.audit ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `Decompile error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
