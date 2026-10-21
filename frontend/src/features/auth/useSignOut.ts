import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useLogoutMutation } from '@/api/endpoints';
import { loggedOut, useAppDispatch, useAppSelector } from '@/app/store';
import { announceSignOut } from './keptSignIn';

/**
 * Signs this browser out: the server ends this tab's session and the browser's kept sign-in (so
 * their tokens stop working wherever they were copied) and removes the "keep me signed in" cookie;
 * then this tab forgets its token, and the account's other tabs sign out too. If the server can't
 * be reached within a moment, the browser signs out anyway; the session then ends by itself when
 * it's next idle-checked or expires.
 */
export function useSignOut() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const me = useAppSelector((s) => s.auth.user?.id);
  const [logout] = useLogoutMutation();
  return useCallback(() => {
    const request = logout().unwrap().catch(() => undefined);
    const wait = new Promise((resolve) => setTimeout(resolve, 1500));
    void Promise.race([request, wait]).then(() => {
      dispatch(loggedOut());
      announceSignOut(me);
      navigate('/login', { replace: true });
    });
  }, [dispatch, logout, navigate, me]);
}
