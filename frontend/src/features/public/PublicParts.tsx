import { Check, Minus } from 'lucide-react';
import type { Role } from '@/api/types';
import { cn } from '@/lib/cn';
import { PERMISSIONS, ROLES, type PermissionCell } from './content';

/** What each role may do, computed from the permission rules (see content.ts). */
export function PermissionTable({ className }: { className?: string }) {
  const roles: Role[] = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'];
  const label = (r: Role) => ROLES.find((x) => x.role === r)!.label;
  return (
    <div className={cn('relative overflow-x-auto rounded-xl border border-line bg-surface shadow-card', className)}>
      <table className="w-full min-w-[620px] text-left text-[13px]">
        <caption className="sr-only">What each role can do in a project</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-5 py-3 text-[12.5px] font-medium text-muted">
              In a project, who can…
            </th>
            {roles.map((r) => (
              <th key={r} scope="col" className="w-[16%] px-3 py-3 text-center text-[12.5px] font-semibold text-ink">
                {label(r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {PERMISSIONS.map((p) => (
            <tr key={p.label}>
              <th scope="row" className="px-5 py-2.5 font-normal text-ink-2">
                {p.label}
              </th>
              {roles.map((r) => (
                <td key={r} className="px-3 py-2.5 text-center">
                  <Cell value={p.cell(r)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value }: { value: PermissionCell }) {
  if (value === true)
    return (
      <>
        <Check className="mx-auto size-4 text-success" strokeWidth={2.5} aria-hidden="true" />
        <span className="sr-only">Yes</span>
      </>
    );
  if (value === false)
    return (
      <>
        <Minus className="mx-auto size-4 text-line-strong" aria-hidden="true" />
        <span className="sr-only">No</span>
      </>
    );
  return <span className="text-[12px] font-medium text-ink-2">{value}</span>;
}
