import { forwardRef, useCallback, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { useBoardTasksQuery, useMembersQuery } from '@/api/endpoints';
import type { Member, Task } from '@/api/types';
import { StatusGlyph } from '@/components/glyphs';
import { Avatar } from '@/components/ui/Avatar';
import { Textarea } from '@/components/ui/Form';
import { cn } from '@/lib/cn';
import { ROLE_LABEL } from '@/lib/constants';
import { matchPeople, matchTasks, triggerAt } from './suggest';

type Suggestion = { kind: '@'; start: number; query: string; items: Member[]; active: number } | { kind: '#'; start: number; query: string; items: Task[]; active: number };

/** Sets a field's text the way typing would, so React (and form libraries) see the change. */
function setFieldText(el: HTMLTextAreaElement, value: string, caret: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.setSelectionRange(caret, caret);
}

/**
 * A text field for writing about work: light formatting with the usual keys (⌘/Ctrl B bold,
 * I italic, E code), @ to mention someone on the project and # to link one of its tasks, both
 * with suggestions you pick with the arrow keys and Enter. Works as a plain or form-managed field.
 */
export const WritingField = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    projectId?: number;
    /** ⌘/Ctrl + Enter. */
    onSubmitShortcut?: () => void;
  }
>(function WritingField({ projectId, onSubmitShortcut, onKeyDown, onBlur, className, ...rest }, forwarded) {
  const el = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwarded, () => el.current!, []);
  const listId = useId();
  const members = useMembersQuery(projectId ?? 0, { skip: !projectId });
  const tasks = useBoardTasksQuery(projectId ?? 0, { skip: !projectId });
  const [sug, setSug] = useState<Suggestion | null>(null);

  const look = useCallback(() => {
    const t = el.current;
    if (!t || !projectId || t.selectionStart !== t.selectionEnd) return setSug(null);
    const trig = triggerAt(t.value, t.selectionStart);
    if (!trig) return setSug(null);
    if (trig.kind === '@') {
      const items = matchPeople(members.data ?? [], trig.query);
      setSug(items.length ? { ...trig, kind: '@', items, active: 0 } : null);
    } else {
      const items = matchTasks(tasks.data ?? [], trig.query);
      setSug(items.length ? { ...trig, kind: '#', items, active: 0 } : null);
    }
  }, [projectId, members.data, tasks.data]);

  const pick = (s: Suggestion, index: number) => {
    const t = el.current;
    if (!t) return;
    const insert = s.kind === '@' ? `@${s.items[index].user.name} ` : `${s.items[index].key} `;
    const end = t.selectionStart;
    const value = t.value.slice(0, s.start) + insert + t.value.slice(end);
    setFieldText(t, value, s.start + insert.length);
    setSug(null);
  };

  const wrap = (mark: string) => {
    const t = el.current;
    if (!t) return;
    const { selectionStart: a, selectionEnd: b, value } = t;
    const inner = value.slice(a, b) || 'text';
    setFieldText(t, value.slice(0, a) + mark + inner + mark + value.slice(b), a + mark.length + inner.length);
    t.setSelectionRange(a + mark.length, a + mark.length + inner.length);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sug) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = sug.items.length;
        setSug({ ...sug, active: (sug.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n } as Suggestion);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(sug, sug.active);
        return;
      }
      if (e.key === 'Escape') {
        // Close the suggestions only, not the dialog around the field.
        e.preventDefault();
        e.stopPropagation();
        setSug(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter' && onSubmitShortcut) {
      e.preventDefault();
      onSubmitShortcut();
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && ['b', 'i', 'e'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      wrap({ b: '**', i: '*', e: '`' }[e.key.toLowerCase() as 'b' | 'i' | 'e']);
      return;
    }
    onKeyDown?.(e);
  };

  const active = sug ? `${listId}-${sug.active}` : undefined;
  const people = useMemo(() => new Map((members.data ?? []).map((m) => [m.user.id, m])), [members.data]);

  return (
    <div className="relative">
      <Textarea
        ref={el}
        {...rest}
        className={className}
        onKeyDown={keys}
        onKeyUp={(e) => {
          if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) look();
        }}
        onInput={look}
        onClick={look}
        onBlur={(e) => {
          setSug(null);
          onBlur?.(e);
        }}
        // A multi-line text field keeps its own role (a textarea can't be a combobox); the list it
        // suggests from is tied to it, and the highlighted suggestion is announced as you move.
        aria-autocomplete="list"
        aria-controls={sug ? listId : undefined}
        aria-activedescendant={active}
        data-writing-field=""
      />
      {sug && (
        <ul
          id={listId}
          role="listbox"
          aria-label={sug.kind === '@' ? 'People on this project' : 'Tasks in this project'}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop dark:bg-surface-2"
          data-writing-suggestions={sug.kind}
        >
          {sug.kind === '@'
            ? sug.items.map((m, i) => (
                <li
                  key={m.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === sug.active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(sug, i);
                  }}
                  className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]', i === sug.active ? 'bg-surface-3 text-ink' : 'text-ink-2')}
                >
                  <Avatar user={people.get(m.user.id)?.user ?? m.user} size="xs" />
                  <span className="font-medium">{m.user.name}</span>
                  <span className="ml-auto text-[12px] text-muted">{ROLE_LABEL[m.role]}</span>
                </li>
              ))
            : sug.items.map((t, i) => (
                <li
                  key={t.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === sug.active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(sug, i);
                  }}
                  className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]', i === sug.active ? 'bg-surface-3 text-ink' : 'text-ink-2')}
                >
                  <StatusGlyph status={t.status} late={t.overdue} />
                  <span className="w-16 shrink-0 font-medium tabular">{t.key}</span>
                  <span className="truncate">{t.title}</span>
                </li>
              ))}
        </ul>
      )}
    </div>
  );
});

/** A one-line reminder of what the field understands. */
export function WritingHint({ className }: { className?: string }) {
  return (
    <span className={cn('text-[12px] text-muted', className)} data-writing-hint="">
      <span className="font-medium text-ink-2">@</span> mention, <span className="font-medium text-ink-2">#</span> link a task,{' '}
      <span className="font-semibold text-ink-2">**bold**</span>, <span className="italic">*italic*</span>, <code className="text-[11.5px]">`code`</code>, - lists
    </span>
  );
}
