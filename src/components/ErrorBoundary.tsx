"use client";

/**
 * Component-level Error Boundary
 *
 * Wraps child components, catches React rendering errors, and shows a friendly fallback UI.
 * Unlike Next.js page-level error.tsx, this can be used locally within the canvas.
 */

import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  /** Fallback UI to show on error, defaults to built-in panel */
  fallback?: ReactNode;
  /** Component name shown in fallback title */
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
            ⚠️ {this.props.name ?? "Component"} encountered an error
          </p>
          <p className="text-xs text-muted-foreground max-w-xs truncate">
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleReset}
            className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
