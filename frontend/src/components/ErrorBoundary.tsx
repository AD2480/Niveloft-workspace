import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '@/lib/errorReporting';

interface State {
  error: Error | null;
}

/** Last-resort boundary so a rendering bug shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
    reportClientError('render', error.message, `${error.stack ?? ''}\n${info.componentStack ?? ''}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted">
          An unexpected error occurred while displaying this page, and it has been reported. Reloading usually fixes it; your saved work is safe.
        </p>
        <pre className="max-w-xl overflow-auto rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-ink-2">{this.state.error.message}</pre>
        <button
          type="button"
          className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover dark:text-canvas"
          onClick={() => {
            this.setState({ error: null });
            window.location.assign('/dashboard');
          }}
        >
          Reload app
        </button>
      </div>
    );
  }
}
