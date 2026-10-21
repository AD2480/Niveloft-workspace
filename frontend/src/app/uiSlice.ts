import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { STORAGE_KEYS } from '@/config';
import { readStorage, writeStorage } from '@/lib/storage';

export type ThemePreference = 'light' | 'dark' | 'system';

interface UiState {
  theme: ThemePreference;
  mobileNavOpen: boolean;
}

const savedTheme = readStorage(STORAGE_KEYS.theme);

const initialState: UiState = {
  theme: savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'system',
  mobileNavOpen: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    themeChanged(state, action: PayloadAction<ThemePreference>) {
      state.theme = action.payload;
      writeStorage(STORAGE_KEYS.theme, action.payload);
    },
    mobileNavSet(state, action: PayloadAction<boolean>) {
      state.mobileNavOpen = action.payload;
    },
  },
});

export const { themeChanged, mobileNavSet } = uiSlice.actions;
export default uiSlice.reducer;
