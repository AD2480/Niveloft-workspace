import { MessageCircle } from 'lucide-react';
import { ANALYTICS_CONFIGURED } from '@/config';
import { useConsent } from '@/features/consent/consent';
import { cn } from '@/lib/cn';
import { openContact, useContactState } from './contactStore';

/**
 * The Contact button that stays in the corner of the public pages. On phones it steps aside while
 * the cookie question is showing, so the two never overlap.
 */
export function FloatingContact() {
  const { open } = useContactState();
  const { choice, settingsOpen } = useConsent();
  const bannerShowing = ANALYTICS_CONFIGURED && choice === null && !settingsOpen;
  return (
    <button
      type="button"
      onClick={() => openContact()}
      data-print="hide"
      data-floating-contact=""
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(
        'fixed right-4 bottom-4 z-30 flex h-11 items-center gap-2 rounded-full border border-line bg-surface/95 px-4 text-ink shadow-float backdrop-blur sm:right-6 sm:bottom-6',
        'transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-line-strong active:translate-y-0',
        bannerShowing && 'max-sm:hidden',
      )}
    >
      <MessageCircle className="size-4" aria-hidden="true" />
      <span className="text-[13.5px] font-medium">Contact</span>
    </button>
  );
}
