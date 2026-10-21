import { Fragment, useMemo, type ReactNode } from 'react';
import { useMembersQuery } from '@/api/endpoints';
import { useAppSelector } from '@/app/store';
import { TaskRef } from '@/features/refs/TaskRef';
import { cn } from '@/lib/cn';
import { parseRichText, type Block, type Inline } from '@/lib/richText';

/**
 * Text people wrote (a description, a comment, a review, notes), with its light formatting, task
 * keys as links with previews, and @mentions of the project's people highlighted (yours more
 * strongly). Rendered from a parsed tree, never as HTML.
 *
 * `refs="static"` draws task keys without looking them up (for pages without a signed-in person).
 */
export function RichText({
  text,
  projectId,
  people,
  className,
  size = 'md',
  refs = 'app',
}: {
  text: string;
  /** The project whose members can be mentioned (looked up, and cached). */
  projectId?: number;
  /** Or the names directly. */
  people?: string[];
  className?: string;
  size?: 'sm' | 'md';
  refs?: 'app' | 'static';
}) {
  const members = useMembersQuery(projectId ?? 0, { skip: !projectId || people !== undefined });
  const me = useAppSelector((s) => s.auth.user?.name ?? null);
  const names = useMemo(() => people ?? members.data?.map((m) => m.user.name) ?? [], [people, members.data]);
  const blocks = useMemo(() => parseRichText(text, { people: names }), [text, names]);
  const ctx: Ctx = { me, refs };
  return (
    <div className={cn('rich-text space-y-2 break-words', size === 'sm' ? 'text-[13px]' : 'text-[14px]', 'leading-relaxed text-ink-2', className)} data-rich-text="">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} />
      ))}
    </div>
  );
}

interface Ctx {
  me: string | null;
  refs: 'app' | 'static';
}

function BlockView({ block: b, ctx }: { block: Block; ctx: Ctx }) {
  switch (b.t) {
    case 'p':
      return <p>{inlines(b.children, ctx)}</p>;
    case 'h':
      // Styled as a heading inside the text, without joining the page's outline.
      return <p className={cn('pt-1 font-semibold text-ink', b.level === 1 ? 'text-[1.12em]' : b.level === 2 ? 'text-[1.04em]' : 'text-[1em]')}>{inlines(b.children, ctx)}</p>;
    case 'quote':
      return <blockquote className="border-l-2 border-line-strong pl-3 text-muted">{inlines(b.children, ctx)}</blockquote>;
    case 'code':
      return (
        <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <code>{b.v}</code>
        </pre>
      );
    case 'hr':
      return <hr className="border-line" />;
    case 'list': {
      const checklist = b.items.some((i) => i.checked !== null);
      const items = b.items.map((it, i) => (
        <li key={i} className={cn(it.checked !== null && 'flex items-start gap-2 [list-style:none]')}>
          {it.checked !== null && (
            <span
              className={cn(
                'mt-[0.28em] inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border',
                it.checked ? 'border-[var(--strata-done)] bg-[var(--strata-done)] text-white' : 'border-line-strong bg-surface',
              )}
              role="img"
              aria-label={it.checked ? 'Done' : 'Not done'}
            >
              {it.checked && (
                <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
                  <path d="M2.5 6.2 4.9 8.5 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          )}
          <span className={cn(it.checked && 'text-muted')}>{inlines(it.children, ctx)}</span>
        </li>
      ));
      return b.ordered ? (
        <ol start={b.start} className="list-decimal space-y-1 pl-5 marker:text-muted">
          {items}
        </ol>
      ) : (
        <ul className={cn('space-y-1', checklist ? 'pl-0' : 'list-disc pl-5 marker:text-subtle')}>{items}</ul>
      );
    }
  }
}

function inlines(nodes: Inline[], ctx: Ctx): ReactNode {
  return nodes.map((n, i) => <Fragment key={i}>{inline(n, ctx)}</Fragment>);
}

function inline(n: Inline, ctx: Ctx): ReactNode {
  switch (n.t) {
    case 'text':
      return n.v;
    case 'br':
      return <br />;
    case 'code':
      return <code className="rounded-[5px] bg-surface-3 px-1 py-px text-[0.9em] text-ink">{n.v}</code>;
    case 'strong':
      return <strong className="font-semibold text-ink">{inlines(n.children, ctx)}</strong>;
    case 'em':
      return <em>{inlines(n.children, ctx)}</em>;
    case 'link': {
      const mail = n.href.toLowerCase().startsWith('mailto:');
      return (
        <a
          href={n.href}
          {...(mail ? {} : { target: '_blank', rel: 'noopener noreferrer nofollow' })}
          className="font-medium text-accent underline decoration-accent/35 underline-offset-2 hover:decoration-accent"
        >
          {inlines(n.children, ctx)}
        </a>
      );
    }
    case 'key':
      return ctx.refs === 'app' ? <TaskRef taskKey={n.key} /> : <span className="font-medium text-ink tabular">{n.key}</span>;
    case 'mention': {
      const mine = ctx.me !== null && n.name === ctx.me;
      return (
        <span
          className={cn('rounded-[5px] px-1 font-medium', mine ? 'bg-brand-soft text-brand-ink' : 'bg-surface-3/80 text-ink')}
          data-mention={n.name}
          title={mine ? 'You' : undefined}
        >
          @{n.name}
        </span>
      );
    }
  }
}
