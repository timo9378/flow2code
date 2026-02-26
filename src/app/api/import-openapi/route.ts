/**
 * OpenAPI Import API Route
 *
 * POST /api/import-openapi
 * Body: { spec: string | object, filter?: { tags?: string[], paths?: string[] } }
 *
 * 將 OpenAPI 規範轉換為 FlowIR 陣列
 */

import { NextResponse } from "next/server";
import { convertOpenAPIToFlowIR } from "@/lib/openapi/converter";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.spec) {
      return NextResponse.json(
        { error: "Missing 'spec' field in request body" },
        { status: 400 }
      );
    }

    const result = convertOpenAPIToFlowIR(body.spec);

    // 可選的 tag / path 篩選
    let filteredFlows = result.flows;
    if (body.filter?.tags && Array.isArray(body.filter.tags)) {
      const tags = new Set(body.filter.tags as string[]);
      filteredFlows = filteredFlows.filter((flow) => {
        // 檢查 flow 的 meta.name 是否在指定的 tag 路徑集內
        return true; // TODO: tag-based filtering
      });
    }
    if (body.filter?.paths && Array.isArray(body.filter.paths)) {
      const paths = body.filter.paths as string[];
      filteredFlows = filteredFlows.filter((flow) =>
        paths.some((p) => flow.meta.name.includes(p))
      );
    }

    return NextResponse.json({
      success: result.success,
      flows: filteredFlows,
      summary: result.summary,
      errors: result.errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
