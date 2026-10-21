import * as RD from '@radix-ui/react-dialog';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/cn';
import { highlight, searchSite, SITE_INDEX, snippet, type SiteEntry } from './siteSearch';

const POPULAR = ['faq-only-the-assignee', 'faq-drag-to-done', 'faq-how-predictions-work', 'faq-need-ai', 'home-roles', 'faq-forgot-password'];

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-[2px] bg-brand-soft px-0.5 text-brand-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Search the public site: every page section, FAQ answer and legal section, found as you type.
 * ↑/↓ move, Enter opens, Esc closes. Runs in the browser; nothing is sent anywhere.
 */
export function SiteSearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const q = query.trim();
  const results: SiteEntry[] = useMemo(
    () => (q ? searchSite(q, 12).map((h) => h.entry) : POPULAR.map((id) => SITE_INDEX.find((e) => e.id === id)).filter((e): e is SiteEntry => !!e)),
    [q],
  );
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openEntry = (e: SiteEntry) => {
    onOpenChange(false);
    navigate(e.to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      openEntry(results[active]);
    }
  };

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/35 animate-fade-in" />
        <RD.Content
          className="fixed top-[10vh] left-1/2 z-50 flex max-h-[76vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col rounded-xl border border-line bg-surface shadow-pop animate-pop-in focus:outline-none"
          aria-describedby={undefined}
          data-site-search=""
        >
          <RD.Title className="sr-only">Search this site</RD.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search questions, guides and policies…"
              aria-label="Search this site"
              className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
              aria-autocomplete="list"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="Clear the search">
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
            <RD.Close className="caps hidden rounded border border-line px-1.5 py-0.5 text-[9px] text-muted hover:border-ink hover:text-ink sm:inline" aria-label="Close search">
              Esc
            </RD.Close>
          </div>

          <div ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto py-2">
            <p className="caps px-4 pt-2 pb-1.5 text-[11px] text-muted" id={`${listId}-label`}>
              {q ? `${results.length === 12 ? '12+' : results.length} result${results.length === 1 ? '' : 's'}` : 'Popular'}
            </p>
            <p className="sr-only" role="status" aria-live="polite">
              {q ? (results.length ? `${results.length} results` : `No results for ${q}`) : ''}
            </p>
            {q && results.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-[14px] text-ink">Nothing matches “{q}”.</p>
                <p className="mt-1 text-[13px] text-muted">Try fewer or other words, or ask with the Contact button at the bottom of the page.</p>
              </div>
            ) : (
              <div id={listId} role="listbox" aria-labelledby={`${listId}-label`}>
                {results.map((e, index) => (
                  <div
                    key={e.id}
                    id={`${listId}-${e.id}`}
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => openEntry(e)}
                    className={cn('mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors', index === active ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-ink">
                        <Marked text={e.title} query={q} />
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">{e.where}</p>
                      {q && e.text && (
                        <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-2">
                          <Marked text={snippet(e.text, q)} query={q} />
                        </p>
                      )}
                    </div>
                    {index === active && <CornerDownLeft className="mt-1 size-3.5 shrink-0 text-muted" aria-hidden="true" />}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 rounded-b-xl border-t border-line px-4 py-2 text-[12px] text-muted">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span className="ml-auto">Searches this site’s pages</span>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
