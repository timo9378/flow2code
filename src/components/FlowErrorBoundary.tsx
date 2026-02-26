"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * FlowCanvas 專用 React Error Boundary
 *
 * 當 React Flow 或節點渲染拋錯時，顯示友善的錯誤畫面，
 * 避免整個頁面白屏。
 */
export class FlowErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[FlowErrorBoundary]", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-background/50">
          <div className="max-w-sm text-center space-y-3 p-6">
            <h3 className="text-lg font-semibold text-red-400">
              ⚠️ {this.props.fallbackMessage ?? "畫布渲染錯誤"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {this.state.error?.message ?? "未知錯誤"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={this.handleReset}
            >
              重新嘗試
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
