import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import { ToastProvider } from './components/ui.tsx';
import { ErrorBoundary } from './components/resilience.tsx';
import { queryClient } from './lib/api.ts';
import { AuthProvider } from './lib/auth.tsx';
import './index.css';

document.documentElement.dataset.app = 'mounted'; // tells boot-guard.js the app started

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
