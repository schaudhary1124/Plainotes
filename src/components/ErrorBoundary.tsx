import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="glass-panel animate-card-in shadow-app max-w-lg rounded-2xl p-10 text-center @max-sm:p-5">
          <AlertTriangle className="text-danger mx-auto mb-3 h-8 w-8" />
          <p className="text-primary text-lg font-medium">Something went wrong</p>
          <p className="text-secondary mt-1.5 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
