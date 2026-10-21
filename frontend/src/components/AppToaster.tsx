import { Toaster } from 'sonner';
import { useAppSelector } from '@/app/store';

export function AppToaster() {
  const theme = useAppSelector((s) => s.ui.theme);
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ className: 'font-sans', duration: 4000 }}
    />
  );
}
