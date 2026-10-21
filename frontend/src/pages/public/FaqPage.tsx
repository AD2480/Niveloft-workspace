import { ChevronDown, ChevronsDownUp, ChevronsUpDown, MessageCircle, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { PublicPage } from '@/components/layout/PublicFrame';
import { PrintButton } from '@/components/PrintHeader';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { openContact } from '@/features/contact/contactStore';
import { FAQ, FAQ_UPDATED, faqJsonLd, type FaqEntry } from '@/features/public/faq';
import { normalise } from '@/features/public/siteSearch';
import { cn } from '@/lib/cn';
import { usePageMeta } from '@/lib/pageMeta';

const WRAP = 'mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-10';

/** Every word of the filter must appear in the question, answer or keywords. */
function matches(e: FaqEntry, words: string[]): boolean {
  if (!words.length) return true;
  const hay = ` ${normalise(`${e.question} ${e.answer.join(' ')} ${e.keywords ?? ''}`)} `;
  return words.every((w) => hay.includes(` ${w}`));
}

/**
 * Questions and answers, grouped by topic. Each answer expands in place, has its own link
 * (/faq#question-id opens it) and a copy-link button; "Expand all" opens everything, the filter
 * narrows the list as you type, and printing opens every answer.
 */
export function FaqPage() {
  usePageMeta({ title: 'Questions and answers', path: '/faq' });
  const { hash } = useLocation();
  const [filter, setFilter] = useState('');
  const list = useRef<HTMLDivElement>(null);

  // Structured data for search engines (also written into the static page at build time).
  useEffect(() => {
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.dataset.faq = '';
    el.textContent = faqJsonLd();
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const words = useMemo(() => normalise(filter).split(' ').filter(Boolean), [filter]);
  const groups = useMemo(() => FAQ.map((g) => ({ ...g, entries: g.entries.filter((e) => matches(e, words)) })).filter((g) => g.entries.length > 0), [words]);
  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const total = FAQ.reduce((n, g) => n + g.entries.length, 0);

  // A link to one answer (#id) opens it and briefly highlights it.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const d = document.getElementById(id);
    if (!(d instanceof HTMLDetailsElement)) return;
    d.open = true;
    d.dataset.flash = 'true';
    const t = window.setTimeout(() => delete d.dataset.flash, 1800);
    requestAnimationFrame(() => d.scrollIntoView({ block: 'start' }));
    return () => window.clearTimeout(t);
  }, [hash]);

  // A narrow filter opens its few answers.
  useEffect(() => {
    if (!words.length || shown > 3) return;
    list.current?.querySelectorAll('details').forEach((d) => (d.open = true));
  }, [words, shown]);

  const setAll = (open: boolean) => list.current?.querySelectorAll('details').forEach((d) => (d.open = open));

  return (
    <PublicPage>
      <div className={WRAP}>
        <header className="border-b border-line pt-12 pb-10 lg:pt-16">
          <h1 className="display-wide text-[40px] leading-[1.04] text-ink sm:text-[54px]">Questions and answers</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            Short answers about roles, reviews, predictions, the AI, your account and what to do when something goes wrong. Can’t find yours? Ask us.
          </p>
          <p className="mt-4 text-[13px] text-muted">
            Last updated <time dateTime="2026-09-28">{FAQ_UPDATED}</time>
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3" data-print="hide">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter the questions…"
                aria-label="Filter the questions"
                aria-describedby="faq-count"
                className="h-11 w-full rounded-lg border border-line-strong bg-surface pr-10 pl-9 text-[14px] text-ink placeholder:text-subtle transition-colors focus:border-brand focus:ring-3 focus:ring-[var(--ring)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                  aria-label="Clear the filter"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <Button variant="secondary" size="md" leftIcon={<ChevronsUpDown aria-hidden="true" />} onClick={() => setAll(true)}>
              Expand all
            </Button>
            <Button variant="ghost" size="md" leftIcon={<ChevronsDownUp aria-hidden="true" />} onClick={() => setAll(false)}>
              Collapse all
            </Button>
            <PrintButton size="md" variant="ghost" />
          </div>
          <p id="faq-count" className="mt-3 text-[12.5px] text-muted" role="status" aria-live="polite" data-print="hide">
            {words.length ? `${shown} of ${total} questions match “${filter.trim()}”.` : `${total} questions in ${FAQ.length} topics.`}
          </p>
        </header>

        <div className="grid gap-10 py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16 lg:py-16">
          <nav aria-label="Topics" className="hidden lg:block" data-print="hide">
            <div className="sticky top-24">
              <p className="caps text-muted">Topics</p>
              <ol className="mt-2 space-y-0.5 text-[13px]">
                {FAQ.map((g) => {
                  const visible = groups.some((x) => x.id === g.id);
                  return (
                    <li key={g.id}>
                      <a
                        href={`#topic-${g.id}`}
                        aria-disabled={!visible || undefined}
                        tabIndex={visible ? undefined : -1}
                        className={cn('flex justify-between gap-2 rounded px-1 py-1 transition-colors', visible ? 'text-ink-2 hover:bg-surface-2 hover:text-accent' : 'pointer-events-none text-subtle')}
                      >
                        {g.title}
                        <span className="text-[12px] text-muted tabular">{groups.find((x) => x.id === g.id)?.entries.length ?? 0}</span>
                      </a>
                    </li>
                  );
                })}
              </ol>
            </div>
          </nav>

          <div ref={list} className="max-w-3xl min-w-0 space-y-12" data-faq-list="">
            {groups.length === 0 && (
              <div className="rounded-xl border border-line bg-surface px-6 py-10 text-center">
                <p className="text-[15px] font-medium text-ink">No question matches “{filter.trim()}”.</p>
                <p className="mt-1.5 text-[13px] text-muted">Try other words, or send us your question: we’ll answer it.</p>
                <div className="mt-5 flex justify-center gap-2">
                  <Button variant="secondary" onClick={() => setFilter('')}>
                    Show all questions
                  </Button>
                  <Button leftIcon={<MessageCircle aria-hidden="true" />} onClick={() => openContact({ topic: 'QUESTION', message: filter.trim() ? `About “${filter.trim()}”: ` : '' })}>
                    Ask us
                  </Button>
                </div>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.id} aria-labelledby={`topic-${g.id}`} className="scroll-mt-24">
                <h2 id={`topic-${g.id}`} className="scroll-mt-24 display-wide text-[24px] text-ink">
                  {g.title}
                </h2>
                <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                  {g.entries.map((e) => (
                    <details key={e.id} id={e.id} className="disclosure group scroll-mt-24" data-faq-entry={e.id}>
                      <summary className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2">
                        <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-medium text-ink">{e.question}</h3>
                        <ChevronDown className="disclosure-icon mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                      </summary>
                      <div className="disclosure-body px-5 pb-5">
                        <div className="max-w-2xl space-y-2.5 text-[14px] leading-relaxed text-ink-2">
                          {e.answer.map((p, i) => (
                            <p key={i}>{p}</p>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {e.link && (
                            <Link to={e.link.to} className="inline-flex min-h-6 items-center gap-1.5 py-1 text-[13px] font-medium text-accent hover:underline">
                              {e.link.label}
                            </Link>
                          )}
                          <CopyButton
                            text={() => `${window.location.origin}/faq#${e.id}`}
                            what={`the link to “${e.question}”`}
                            label="Copy link"
                            className="ml-auto text-muted"
                          />
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}

            <aside className="rounded-xl border border-line bg-surface p-6 sm:p-8" data-print="hide">
              <p className="display-wide text-[22px] text-ink">Still have a question?</p>
              <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-ink-2">Send it to the people who run this site. If it’s about an error, include its reference.</p>
              <Button className="mt-5" leftIcon={<MessageCircle aria-hidden="true" />} onClick={() => openContact({ topic: 'QUESTION' })}>
                Contact us
              </Button>
            </aside>
          </div>
        </div>
      </div>
    </PublicPage>
  );
}
