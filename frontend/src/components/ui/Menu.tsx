import * as DM from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = 'end', side = 'bottom', className }: { children: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom'; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        side={side}
        sideOffset={6}
        collisionPadding={8}
        className={cn('z-[60] min-w-48 overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-pop animate-pop-in dark:bg-surface-2', className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] outline-none select-none [&_svg]:size-4 [&_svg]:text-muted',
        'data-[highlighted]:bg-surface-3/80 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 dark:data-[highlighted]:bg-surface-3',
        danger ? 'text-danger [&_svg]:!text-danger' : 'text-ink',
      )}
    >
      {icon}
      {children}
    </DM.Item>
  );
}

/** A menu item that toggles something on or off (announced as a checkbox item with its state). */
export function MenuCheckItem({ children, checked, onSelect, disabled }: { children: ReactNode; checked: boolean; onSelect: () => void; disabled?: boolean }) {
  return (
    <DM.CheckboxItem
      checked={checked}
      disabled={disabled}
      onSelect={onSelect}
      className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-ink outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3/80 dark:data-[highlighted]:bg-surface-3"
    >
      <span className="flex size-4 items-center justify-center">{checked && <Check className="size-4 text-accent" />}</span>
      {children}
    </DM.CheckboxItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pt-2 pb-1 text-[12px] font-medium text-muted">{children}</DM.Label>;
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}

/** A set of choices where exactly one applies (announced as radio items). */
export function MenuRadioGroup({ value, onValueChange, children, label }: { value: string; onValueChange: (v: string) => void; children: ReactNode; label?: string }) {
  return (
    <DM.RadioGroup value={value} onValueChange={onValueChange} aria-label={label}>
      {children}
    </DM.RadioGroup>
  );
}

export function MenuRadioItem({ value, children, hint, disabled }: { value: string; children: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <DM.RadioItem
      value={value}
      disabled={disabled}
      className="group/radio flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-ink outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3/80 dark:data-[highlighted]:bg-surface-3"
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong group-data-[state=checked]/radio:border-accent">
        <DM.ItemIndicator>
          <span className="block size-2 rounded-full bg-accent" />
        </DM.ItemIndicator>
      </span>
      <span>
        <span className="block">{children}</span>
        {hint && <span className="block text-[12px] leading-snug text-muted">{hint}</span>}
      </span>
    </DM.RadioItem>
  );
}
