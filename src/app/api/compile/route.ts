import { NextResponse } from "next/server";
import { compile } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 支援新格式 { ir, write } 和舊格式（直接傳 IR）
    const ir: FlowIR = body.ir ?? body;
    const result = compile(ir);

    if (result.success) {
      return NextResponse.json({
        success: true,
        code: result.code,
        filePath: result.filePath,
        writtenTo: null, // Next.js dev mode 不寫入檔案
        dependencies: result.dependencies,
        sourceMap: result.sourceMap,
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.errors?.join("\n") },
        { status: 400 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `伺服器錯誤: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}
