"use client";

/**
 * 元件級錯誤邊界
 *
 * 包裹子元件，攔截 React 渲染錯誤，顯示友善的 fallback UI。
 * 不同於 Next.js 頁面級 error.tsx，這個可在畫布內局部使用。
 */

import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  /** 出錯時顯示的替代 UI，預設為內建面板 */
  fallback?: ReactNode;
  /** 顯示於 fallback 標題中的元件名稱 */
  name?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center p-6 bg-destructive/5 border border-destructive/20 rounded-lg text-center gap-3">
          <p className="text-sm font-semibold text-destructive">
            ⚠️ {this.props.name ?? "元件"} 發生錯誤
          </p>
          <p className="text-xs text-muted-foreground max-w-xs truncate">
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleReset}
            className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
          >
            重新嘗試
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
