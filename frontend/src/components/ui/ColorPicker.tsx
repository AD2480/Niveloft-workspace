import { Check } from 'lucide-react';
import { PALETTE } from '@/lib/constants';
import { cn } from '@/lib/cn';

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {PALETTE.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            onClick={() => onChange(c)}
            className={cn('flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110', selected && 'ring-2 ring-ink/70')}
            style={{ backgroundColor: c }}
          >
            {selected && <Check className="size-4 text-white" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
