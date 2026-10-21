import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { store } from './app/store';
import { loggedOut, restoreFinished, tokenRefreshed } from './features/auth/authSlice';
import { isKept, KEPT_KEY, SIGNED_OUT_KEY, signedOutAccount } from './features/auth/keptSignIn';
import { renewKeptSignIn } from './features/auth/renewal';
import { ThemeController } from './app/ThemeController';
import { AppToaster } from './components/AppToaster';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NetworkActivityBar } from './components/NetworkActivityBar';
import { OfflineBanner } from './components/OfflineBanner';
import { captureAttribution } from './lib/attribution';
import { installErrorReporting } from './lib/errorReporting';
import { installPrintSupport } from './lib/print';
import { TooltipProvider } from './components/ui/Tooltip';
import { ConsentLayer } from './features/consent/ConsentLayer';
import { ContactLayer } from './features/contact/ContactLayer';
import './index.css';

installErrorReporting();
// Before anything renders: read (and tidy away) campaign tags from the address.
captureAttribution();
installPrintSupport();

/** Signs this tab in from the browser's kept sign-in ("keep me signed in"), if it still has one. */
function renew() {
  renewKeptSignIn().then(
    (renewed) => store.dispatch(renewed ? tokenRefreshed({ ...renewed, kept: true }) : restoreFinished()),
    () => store.dispatch(restoreFinished()),
  );
}

// A tab opened without a sign-in of its own: the kept sign-in, if any, signs it in.
if (!store.getState().auth.token && isKept()) renew();

// Keep tabs in step: signing in with "keep me signed in" in one tab signs in the others that have no
// sign-in; signing out in one tab signs that account's other tabs out.
window.addEventListener('storage', (e) => {
  const { token, user } = store.getState().auth;
  if (e.key === KEPT_KEY && e.newValue && !token) renew();
  if (e.key === SIGNED_OUT_KEY && token) {
    const who = signedOutAccount(e.newValue);
    if (who !== null && (!user || user.id === who)) store.dispatch(loggedOut());
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <ThemeController />
        <NetworkActivityBar />
        <TooltipProvider>
          <BrowserRouter>
            <App />
            <ConsentLayer />
            <ContactLayer />
            <OfflineBanner />
          </BrowserRouter>
        </TooltipProvider>
        <AppToaster />
      </Provider>
    </ErrorBoundary>
  </StrictMode>,
);
