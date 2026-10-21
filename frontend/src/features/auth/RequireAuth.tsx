import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMeQuery } from '@/api/endpoints';
import { errorStatus } from '@/api/errors';
import { loggedOut, useAppDispatch, useAppSelector } from '@/app/store';
import { LogoMark } from '@/components/layout/Logo';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { userUpdated } from './authSlice';

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 text-muted">
      <LogoMark className="size-10" />
      <Spinner label="Loading your workspace" />
    </div>
  );
}

/**
 * Guards app routes: redirects guests to /login and validates the stored token once. A tab opened
 * without a token waits while the browser's kept sign-in, if any, is renewed.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const { token, user, initialized } = useAppSelector((s) => s.auth);
  const me = useMeQuery(undefined, { skip: !token });

  useEffect(() => {
    if (me.data) dispatch(userUpdated(me.data));
  }, [me.data, dispatch]);

  if (!token) {
    if (!initialized) return <Splash />;
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  if (!initialized || !user) {
    if (me.isError && errorStatus(me.error) !== 401) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center">
          <ErrorState error={me.error} title="We couldn’t load your account" onRetry={() => void me.refetch()} />
          <Button variant="link" onClick={() => dispatch(loggedOut())}>
            Sign out
          </Button>
        </div>
      );
    }
    return <Splash />;
  }
  return <>{children}</>;
}

/**
 * Where to go once the sign-in or sign-up that is completing right now has stored its session.
 * The page sets it just before storing the session; GuestOnly then does the one redirect. (If the
 * page navigated itself as well, the two redirects would race and the last one would win.)
 */
let afterSignIn: string | null = null;
export function redirectAfterSignIn(path: string) {
  afterSignIn = path;
}

/** For /login and /register: signed-in users go straight to where they were heading. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { token, initialized } = useAppSelector((s) => s.auth);
  const location = useLocation();
  useEffect(() => {
    if (token) afterSignIn = null;
  }, [token]);
  if (token) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={afterSignIn ?? (from && from !== '/login' ? from : '/dashboard')} replace />;
  }
  if (!initialized) return <Splash />; // a kept sign-in is being renewed: no sign-in form flashing up first
  return <>{children}</>;
}
