import { Info } from 'lucide-react';
import { useState } from 'react';
import type { Role } from '@/api/types';
import { Dialog } from '@/components/ui/Dialog';
import { PERMISSIONS, ROLES, type PermissionCell } from '@/features/public/content';
import { cn } from '@/lib/cn';

const ORDER: Role[] = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'];
const LABEL: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', MEMBER: 'Member', VIEWER: 'Viewer' };

/** One sentence per role, from the point of view of the person holding it. */
export const YOU_CAN: Record<Role, string> = {
  OWNER: 'You can do everything here: plan, assign, review others’ work, manage people and settings.',
  MANAGER: 'You plan and assign work, invite members and viewers, and review work others submit.',
  MEMBER: 'You create tasks, work on the tasks assigned to you, and submit them for review.',
  VIEWER: 'You can see everything in this project, but not change anything.',
};

function Cell({ value }: { value: PermissionCell }) {
  if (value === true) return <span className="font-medium text-success">Yes</span>;
  if (value === false) return <span className="text-muted">—</span>;
  return <span className="text-[12px] text-accent">{value}</span>;
}

/**
 * Who can do what, and why. Roles belong to each project; "assignee" isn't a role but the person a
 * task is assigned to, who alone can submit that task for review.
 */
export function RoleGuideDialog({ open, onOpenChange, myRole, projectName }: { open: boolean; onOpenChange: (o: boolean) => void; myRole?: Role | null; projectName?: string }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Roles: who can do what"
      description={
        myRole
          ? `In ${projectName ?? 'this project'} you’re ${myRole === 'OWNER' ? 'the Owner' : `a ${LABEL[myRole]}`}. ${YOU_CAN[myRole]}`
          : 'Each project has its own roles. You’re the Owner of projects you create; others add you to theirs.'
      }
    >
      <div className="space-y-6">
        <ol className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r, i) => (
            <li key={r.role} className={cn('bg-surface p-4', myRole === r.role && 'bg-brand-soft')}>
              <p className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">
                  {i + 1}. {r.label}
                </span>
                {myRole === r.role && <span className="text-[12px] font-medium text-accent">You</span>}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{r.summary}</p>
            </li>
          ))}
        </ol>

        <div className="border border-line bg-surface-2 p-4 text-[13px] leading-relaxed text-ink-2">
          <p className="font-medium text-ink">What’s an “assignee”?</p>
          <p className="mt-1">
            Not a role: it’s the person a task is assigned to. Any Member, Manager or Owner can be one. Only the assignee can submit that task for review, and
            someone else (a Manager or the Owner) approves it. That’s why you may see “Only the assignee can submit”: the task is someone else’s to hand in,
            and your part is to review it or wait for it.
          </p>
        </div>

        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <caption className="sr-only">What each role can do in a project</caption>
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th scope="col" className="px-4 py-2.5 font-medium text-muted">
                  Action
                </th>
                {ORDER.map((r) => (
                  <th key={r} scope="col" className={cn('w-[15%] px-3 py-2.5 text-center font-semibold text-ink', myRole === r && 'bg-brand-soft')}>
                    {LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PERMISSIONS.map((p) => (
                <tr key={p.label}>
                  <th scope="row" className="px-4 py-2 font-normal text-ink-2">
                    {p.label}
                  </th>
                  {ORDER.map((r) => (
                    <td key={r} className={cn('px-3 py-2 text-center', myRole === r && 'bg-brand-soft/60')}>
                      <Cell value={p.cell(r)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}

/** "You: Owner (i)", opening the role guide. */
export function MyRoleButton({ role, projectName, className }: { role: Role; projectName?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink shadow-card transition-colors hover:border-[color-mix(in_srgb,var(--ink)_30%,var(--line-strong))] dark:bg-surface-2', className)}
        aria-label={`Your role: ${LABEL[role]}. What can each role do?`}
      >
        You: {LABEL[role]} <Info className="size-3.5 text-muted" aria-hidden="true" />
      </button>
      <RoleGuideDialog open={open} onOpenChange={setOpen} myRole={role} projectName={projectName} />
    </>
  );
}
