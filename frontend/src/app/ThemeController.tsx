import { useEffect } from 'react';
import { useAppSelector } from './store';

/** Applies the theme preference to <html> and follows the OS setting in "system" mode. */
export function ThemeController() {
  const theme = useAppSelector((s) => s.ui.theme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1419' : '#f4f6f7');
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return null;
}
