import type { FlowIR } from "./compiler.js";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface CompileRequest {
  ir?: FlowIR;
  write?: boolean;
}

export declare function handleCompile(body: CompileRequest, projectRoot: string): ApiResponse;
export declare function handleGenerate(body: { prompt?: string }): Promise<ApiResponse>;
export declare function handleImportOpenAPI(body: { spec?: unknown; filter?: { tags?: string[]; paths?: string[] } }): ApiResponse;
export declare function startServer(options?: { port?: number; staticDir?: string }): void;
