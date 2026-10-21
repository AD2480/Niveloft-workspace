import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/**
 * The Overview's building block: a fixed-shape card with a title, a short preview of at most a
 * few rows, and a "View all" bar in the same place on every card that opens the full list in a
 * pop-up. Cards in a row stretch to the same height, so the grid stays even.
 */
export function SummaryCard({
  title,
  description,
  action,
  viewAll,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** The bar at the bottom: its label (e.g. "View all 12") and the pop-up it opens, or a page. */
  viewAll?: { label: string; onClick: () => void } | { label: string; to: string };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('flex h-full flex-col', className)}>
      <CardHeader title={title} description={description} action={action} />
      <div className={cn('flex-1 px-4 py-3 sm:px-5', bodyClassName)}>{children}</div>
      {viewAll && <CardFooterAction {...viewAll} />}
    </Card>
  );
}

const FOOTER =
  'flex w-full items-center justify-between rounded-b-[inherit] border-t border-line px-4 py-2.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-surface-2 sm:px-5';

/** The bar at the bottom of an Overview card, in the same place on every card. */
export function CardFooterAction(props: { label: string; onClick: () => void } | { label: string; to: string }) {
  const inner = (
    <>
      {props.label}
      <ChevronRight className="size-4" aria-hidden="true" />
    </>
  );
  return 'to' in props ? (
    <Link to={props.to} className={FOOTER}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={props.onClick} className={FOOTER}>
      {inner}
    </button>
  );
}

/** A small, consistent "nothing here" line for a card's preview area. */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="flex h-full min-h-20 items-center justify-center text-center text-[12.5px] text-muted">{children}</p>;
}
