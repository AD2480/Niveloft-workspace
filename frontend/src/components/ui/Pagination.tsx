import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  totalElements: number;
  size: number;
  onPageChange: (page: number) => void;
  noun?: string;
}

export function Pagination({ page, totalPages, totalElements, size, onPageChange, noun = 'items' }: PaginationProps) {
  if (totalElements === 0) return null;
  const from = page * size + 1;
  const to = Math.min(totalElements, (page + 1) * size);
  return (
    <nav className="flex items-center justify-between gap-3 px-1 py-3 text-[13px] text-muted" aria-label="Pagination">
      <p>
        Showing <span className="font-medium text-ink tabular">{from}</span>–<span className="font-medium text-ink tabular">{to}</span> of{' '}
        <span className="font-medium text-ink tabular">{totalElements}</span> {noun}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => onPageChange(page - 1)} disabled={page === 0} leftIcon={<ChevronLeft />} aria-label="Previous page">
            <span className="hidden sm:inline">Previous</span>
          </Button>
          <span className="px-2 tabular" aria-current="page">
            {page + 1} / {totalPages}
          </span>
          <Button variant="secondary" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1} rightIcon={<ChevronRight />} aria-label="Next page">
            <span className="hidden sm:inline">Next</span>
          </Button>
        </div>
      )}
    </nav>
  );
}
