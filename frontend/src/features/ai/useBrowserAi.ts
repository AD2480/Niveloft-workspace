import { useSyncExternalStore } from 'react';
import { getBrowserAiState, subscribeBrowserAi, type BrowserAiState } from './browserAi';

/** Whether the AI built into this browser can be used, and its download progress. */
export function useBrowserAi(): BrowserAiState {
  return useSyncExternalStore(subscribeBrowserAi, getBrowserAiState, getBrowserAiState);
}
