import type { FlowIR } from "./compiler.js";
import type { Server } from "node:http";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface CompileRequest {
  ir?: FlowIR;
  write?: boolean;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  /** User project root directory (defaults to process.cwd()) */
  projectRoot?: string;
  /** Callback after server starts */
  onReady?: (url: string) => void;
}

export declare function handleCompile(body: CompileRequest, projectRoot: string): ApiResponse;
export declare function handleGenerate(body: { prompt?: string }): Promise<ApiResponse>;
export declare function handleImportOpenAPI(body: { spec?: unknown; filter?: { tags?: string[]; paths?: string[] } }): ApiResponse;
export declare function startServer(options?: ServerOptions): Server;
