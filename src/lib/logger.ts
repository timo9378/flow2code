/**
 * Flow2Code Logger
 *
 * Structured logging with color output, severity levels, and --silent support.
 * Uses picocolors (zero-dependency, 3.8x faster than chalk).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Server started", url);
 *   logger.warn("Missing env var", varName);
 *   logger.error("Compile failed", err);
 *   logger.success("Compiled", outputPath);
 *
 * Silence:
 *   logger.silent = true;  // suppresses info/success/warn (errors always print)
 */

import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

class Logger {
  /** Minimum log level (default: "info"). Set to "silent" to suppress all output. */
  level: LogLevel = "info";

  /** Prefix for all log lines (default: "[flow2code]") */
  prefix = "[flow2code]";

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  debug(...args: unknown[]): void {
    if (!this.shouldLog("debug")) return;
    console.log(pc.gray(`${this.prefix} ${pc.dim("DEBUG")}`), ...args);
  }

  info(...args: unknown[]): void {
    if (!this.shouldLog("info")) return;
    console.log(pc.blue(`${this.prefix}`), ...args);
  }

  success(...args: unknown[]): void {
    if (!this.shouldLog("info")) return;
    console.log(pc.green(`${this.prefix} ✅`), ...args);
  }

  warn(...args: unknown[]): void {
    if (!this.shouldLog("warn")) return;
    console.warn(pc.yellow(`${this.prefix} ⚠️`), ...args);
  }

  error(...args: unknown[]): void {
    if (!this.shouldLog("error")) return;
    console.error(pc.red(`${this.prefix} ❌`), ...args);
  }

  /** Print a blank line (respects silent mode) */
  blank(): void {
    if (!this.shouldLog("info")) return;
    console.log();
  }

  /** Print raw text without prefix (respects silent mode) */
  raw(...args: unknown[]): void {
    if (!this.shouldLog("info")) return;
    console.log(...args);
  }

  /** Formatted key-value line for startup banners */
  kv(key: string, value: string): void {
    if (!this.shouldLog("info")) return;
    console.log(`  ${pc.dim("├─")} ${pc.bold(key)}  ${value}`);
  }

  /** Last key-value line (uses └─) */
  kvLast(key: string, value: string): void {
    if (!this.shouldLog("info")) return;
    console.log(`  ${pc.dim("└─")} ${pc.bold(key)}  ${value}`);
  }
}

/** Singleton logger instance */
export const logger = new Logger();
