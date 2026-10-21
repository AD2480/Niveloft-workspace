import { ShieldCheck, UserRoundCog } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useMembersQuery, useProjectAuditQuery, useTransferOwnershipMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { AuditEvent, ProjectDetail as Project } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, FormError, Select } from '@/components/ui/Form';
import { formatDateTime } from '@/lib/dates';

/** The owner hands the project to another member, who becomes its owner; the owner stays on as a manager. */
export function OwnershipCard({ project }: { project: Project }) {
  const members = useMembersQuery(project.id);
  const [transfer, { isLoading }] = useTransferOwnershipMutation();
  const [memberId, setMemberId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = (members.data ?? []).filter((m) => m.role !== 'OWNER');
  const chosen = others.find((m) => m.id === memberId) ?? null;

  return (
    <Card data-ownership="">
      <CardHeader title="Ownership" description="A project has one owner, who can delete it and hand it on. Your account can only be deleted once nobody else depends on a project you own." />
      <CardBody className="space-y-3">
        {others.length === 0 ? (
          <p className="text-[13px] text-muted">Invite someone first: ownership can only go to a member of this project.</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="New owner" className="min-w-0 flex-1">
              {(p) => (
                <Select {...p} value={memberId ?? ''} onChange={(e) => setMemberId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Choose a member</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user.name} ({m.role.toLowerCase()})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="secondary" leftIcon={<UserRoundCog />} disabled={!chosen} onClick={() => setConfirm(true)} className="shrink-0">
              Transfer ownership
            </Button>
          </div>
        )}
        <FormError message={error} />
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={chosen ? `Make ${chosen.user.name} the owner?` : 'Transfer ownership?'}
        description={`${chosen?.user.name ?? 'They'} will own “${project.name}”, and can delete it or hand it on. You’ll stay on as a manager.`}
        confirmLabel="Transfer ownership"
        tone="primary"
        loading={isLoading}
        onConfirm={async () => {
          if (!chosen) return;
          setError(null);
          try {
            await transfer({ projectId: project.id, memberId: chosen.id }).unwrap();
            setConfirm(false);
            toast.success(`${chosen.user.name} now owns ${project.name}`);
          } catch (e) {
            setConfirm(false);
            setError(getErrorMessage(e, 'Ownership couldn’t be transferred. Try again.'));
          }
        }}
      />
    </Card>
  );
}

const ACTIONS: Record<string, string> = {
  'project.invitation_sent': 'sent an invitation',
  'project.invitation_revoked': 'revoked an invitation',
  'project.invitation_accepted': 'accepted an invitation',
  'project.invitation_declined': 'declined an invitation',
  'project.member_removed': 'removed a member',
  'project.member_left': 'left the project',
  'project.role_changed': 'changed a member’s role',
  'project.ownership_transferred': 'made another member the owner',
  'project.exported': 'downloaded the task history',
  'project.deleted': 'deleted a project',
  'file.rejected': 'had an upload refused by the virus scanner',
};

export function describeAudit(e: AuditEvent): string {
  if (e.action.startsWith('ai.')) return `asked Flurry (${e.action.slice(3).replace(/_/g, ' ')})`;
  if (e.action === 'project.invitation_accepted' && e.outcome !== 'ok') return 'tried to accept an invitation that was no longer valid';
  return ACTIONS[e.action] ?? e.action;
}

/** The project's audit log: who changed access, exported data or asked Flurry, and whether it was allowed. */
export function SecurityLogCard({ project }: { project: Project }) {
  const log = useProjectAuditQuery(project.id);
  const events = log.data ?? [];
  return (
    <Card data-security-log="">
      <CardHeader title="Security log" description="Invitations, membership and role changes, ownership, exports and Flurry requests in this project. Owners and managers can see it; nobody can edit it." />
      <CardBody className="text-[13px]">
        {log.isLoading && <p className="text-muted">Loading the log…</p>}
        {log.isError && <FormError message={getErrorMessage(log.error, 'The log couldn’t be loaded. Try again.')} />}
        {!log.isLoading && !log.isError && events.length === 0 && <p className="text-muted">Nothing recorded yet.</p>}
        {events.length > 0 && (
          <ol className="divide-y divide-line" aria-label="Security log, newest first">
            {events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <p className="min-w-0 text-ink-2">
                  <span className="font-medium text-ink">{e.actor}</span> {describeAudit(e)}
                  {e.outcome !== 'ok' && (
                    <Badge tone={e.outcome === 'denied' ? 'warning' : 'danger'} className="ml-2">
                      {e.outcome === 'denied' ? 'Refused' : 'Failed'}
                    </Badge>
                  )}
                  {e.detail ? <span className="block text-xs text-muted">{e.detail}</span> : null}
                </p>
                <time dateTime={e.at} className="shrink-0 text-xs text-muted">
                  {formatDateTime(e.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> Kept for at least 180 days.
        </p>
      </CardBody>
    </Card>
  );
}
