import { configureStore, type Middleware } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector } from 'react-redux';
import { api } from '@/api/baseApi';
import { endpoints } from '@/api/endpoints';
import { flurryMoment } from '@/features/flurry/flurryCues';
import authReducer, { loggedOut, sessionExpired } from '@/features/auth/authSlice';
import uiReducer from './uiSlice';

/**
 * Flurry's small happy reaction when something you did worked: work submitted for review, a review
 * approved, or a plan's tasks created. It only watches; it never changes anything.
 */
const flurryReactions: Middleware = () => (next) => (action) => {
  const result = next(action);
  if (
    endpoints.endpoints.submitWork.matchFulfilled(action) ||
    endpoints.endpoints.applyPlan.matchFulfilled(action) ||
    (endpoints.endpoints.reviewSubmission.matchFulfilled(action) && action.meta.arg.originalArgs.decision === 'APPROVED')
  ) {
    flurryMoment({ kind: 'happy' });
  }
  return result;
};

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefault) =>
    getDefault({
      // FormData bodies (file uploads) are passed through RTK Query mutation args.
      serializableCheck: { ignoredActionPaths: ['meta.arg.originalArgs.files', 'meta.baseQueryMeta'], ignoredPaths: ['api.mutations'] },
    }).concat(api.middleware, flurryReactions),
});

setupListeners(store.dispatch);

// Drop every cached response when the user changes, so no data leaks between accounts.
store.subscribe(
  (() => {
    let lastToken = store.getState().auth.token;
    return () => {
      const { token } = store.getState().auth;
      if (token !== lastToken) {
        lastToken = token;
        if (token === null) store.dispatch(api.util.resetApiState());
      }
    };
  })(),
);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

export { loggedOut, sessionExpired };
