import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './buttonStyles';

/**
 * Copies text to the clipboard. Uses the Clipboard API where the page may, and falls back to a
 * hidden text box and the older copy command (plain http, older browsers). Resolves to whether it
 * worked; it never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && (typeof window === 'undefined' || window.isSecureContext)) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission refused or not focused: try the fallback */
  }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.top = '-1000px';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  /** The text, or a function that returns it at the moment of copying. */
  text: string | (() => string);
  /** What is copied, for the accessible name and the announcement ("the link", "the answer"). */
  what: string;
  label?: string;
  copiedLabel?: string;
  /** Only the icon is shown (the accessible name still says what's copied). */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * A copy button that says it worked: the icon becomes a tick and the label "Copied" for two
 * seconds, and screen readers hear "<what> copied". If copying isn't allowed it says so.
 */
export function CopyButton({ text, what, label = 'Copy', copiedLabel = 'Copied', iconOnly = false, variant = 'ghost', size = 'xs', className }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), state === 'copied' ? 2000 : 4000);
    return () => window.clearTimeout(t);
  }, [state]);

  const copy = async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    setState(ok ? 'copied' : 'failed');
  };

  const shown = state === 'copied' ? copiedLabel : state === 'failed' ? 'Couldn’t copy' : label;
  return (
    <>
      <Button
        variant={variant}
        size={iconOnly ? (size === 'xs' ? 'icon-sm' : 'icon') : size}
        onClick={() => void copy()}
        aria-label={iconOnly ? `Copy ${what}` : undefined}
        title={iconOnly ? (state === 'copied' ? `${cap(what)} copied` : `Copy ${what}`) : undefined}
        data-copy-state={state}
        data-print="hide"
        className={cn(state === 'copied' && 'text-success hover:text-success', state === 'failed' && 'text-danger hover:text-danger', className)}
      >
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {!iconOnly && <span>{shown}</span>}
        {!iconOnly && <span className="sr-only"> {what}</span>}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? `${cap(what)} copied to the clipboard.` : state === 'failed' ? `Couldn’t copy ${what}. Select it and press Ctrl+C (⌘C on a Mac).` : ''}
      </span>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
