import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, ServerOff, TriangleAlert } from 'lucide-react';
import { Logo } from './layouts.tsx';
import { Button } from './ui.tsx';

function Screen({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6 text-center">
      <div className="mb-6"><Logo /></div>
      <div className="mb-3 text-brand-red">{icon}</div>
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <div className="mt-2 max-w-md text-sm text-navy-500">{children}</div>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        <RefreshCw className="size-4" /> Try again
      </Button>
    </div>
  );
}

/** Shown when the API cannot be reached, instead of a blank or half-working page. */
export function ServerUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <Screen icon={<ServerOff className="size-10" />} title="Can’t reach the Shastra Connect server">
      <p>The app opened, but its server is not answering.</p>
      {import.meta.env.DEV ? (
        <p className="mt-2">
          On this computer: close the Shastra window and double-click <b>START-HERE.cmd</b> again. Check that Docker Desktop is running.
        </p>
      ) : (
        <p className="mt-2">Please check your internet connection. If it keeps happening, contact the school office.</p>
      )}
      {onRetry && (
        <button className="mt-3 text-xs font-semibold text-navy-600 underline" onClick={onRetry}>
          Retry without reloading
        </button>
      )}
    </Screen>
  );
}

/** Any unexpected rendering error shows a friendly screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Screen icon={<TriangleAlert className="size-10" />} title="Something went wrong on this screen">
        <p>Reloading usually fixes it. Your data is safe.</p>
        {import.meta.env.DEV && <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-navy-50 p-2 text-left text-xs text-bad">{String(this.state.error?.stack ?? this.state.error)}</pre>}
      </Screen>
    );
  }
}
