import type { UserSummary } from '@/api/types';
import { cn } from '@/lib/cn';
import { Tooltip } from './Tooltip';

const sizes = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[11px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

interface AvatarProps {
  user: Pick<UserSummary, 'name' | 'avatarColor'> | null | undefined;
  size?: keyof typeof sizes;
  className?: string;
  tooltip?: boolean;
}

export function Avatar({ user, size = 'md', className, tooltip = false }: AvatarProps) {
  const el = user ? (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface select-none', sizes[size], className)}
      style={{ backgroundColor: user.avatarColor }}
      aria-label={tooltip ? undefined : user.name}
      role="img"
    >
      <span aria-hidden="true">{initials(user.name)}</span>
    </span>
  ) : (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-subtle', sizes[size], className)}
      role="img"
      aria-label="Unassigned"
    >
      <svg viewBox="0 0 16 16" className="size-1/2" fill="currentColor" aria-hidden="true">
        <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 6a5 5 0 0 1 10 0H3Z" />
      </svg>
    </span>
  );
  if (tooltip && user) return <Tooltip content={user.name}>{el}</Tooltip>;
  return el;
}

export function AvatarGroup({ users, max = 4, size = 'sm' }: { users: UserSummary[]; max?: number; size?: keyof typeof sizes }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} tooltip />
      ))}
      {rest > 0 && (
        <span className={cn('inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-ink-2 ring-2 ring-surface', sizes[size])} aria-label={`${rest} more`}>
          +{rest}
        </span>
      )}
    </div>
  );
}
