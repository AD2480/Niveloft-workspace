import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </RT.Provider>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="z-[70] max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-[12px] leading-snug font-medium text-canvas shadow-pop animate-fade-in"
        >
          {content}
          <RT.Arrow className="fill-ink" />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
