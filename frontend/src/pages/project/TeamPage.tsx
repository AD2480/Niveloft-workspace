import { Check, Mail, Minus, ShieldCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useMembersQuery, useProjectInvitationsQuery, useRemoveMemberMutation, useRevokeInvitationMutation, useUpdateMemberRoleMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Invitation, Member, Role } from '@/api/types';
import { RoleBadge } from '@/components/domain';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/States';
import { InviteDialog } from '@/features/projects/InviteDialog';
import { useCurrentUserId, useProjectContext } from '@/features/projects/projectContext';
import { ROLE_LABEL } from '@/lib/constants';
import { formatDate, timeAgo } from '@/lib/dates';
import { can } from '@/lib/permissions';

const MATRIX: [string, boolean, boolean, boolean, boolean][] = [
  ['View project, tasks and activity', true, true, true, true],
  ['Comment on tasks', true, true, true, false],
  ['Create tasks', true, true, true, false],
  ['Work on and submit assigned tasks', true, true, true, false],
  ['Assign anyone, edit any task', true, true, false, false],
  ['Review and approve submissions', true, true, false, false],
  ['Manage milestones', true, true, false, false],
  ['Invite and manage members and viewers', true, true, false, false],
  ['Manage managers', true, false, false, false],
  ['Delete the project', true, false, false, false],
];

export function TeamPage() {
  const { project } = useProjectContext();
  const me = useCurrentUserId();
  const role = project.myRole;
  const manage = can.manageMembers(role);
  const { data: members, isLoading, isError, error, refetch } = useMembersQuery(project.id);
  const { data: invitations } = useProjectInvitationsQuery(project.id, { skip: !manage });
  const [updateRole, roleState] = useUpdateMemberRoleMutation();
  const [removeMember, removeState] = useRemoveMemberMutation();
  const [revoke, revokeState] = useRevokeInvitationMutation();
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  const changeRole = async (m: Member, newRole: Role) => {
    try {
      await updateRole({ projectId: project.id, memberId: m.id, role: newRole }).unwrap();
      toast.success(`${m.user.name} is now a ${ROLE_LABEL[newRole].toLowerCase()}`);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
      <div className="max-w-5xl space-y-6">
        <Card>
          <CardHeader
            title="Members"
            description={members ? `${members.length} people have access to this project` : undefined}
            action={
              manage && (
                <Button size="sm" leftIcon={<UserPlus />} onClick={() => setInviting(true)}>
                  Invite
                </Button>
              )
            }
          />
          {isLoading ? (
            <CardBody className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardBody>
          ) : isError || !members ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : (
            <ul className="divide-y divide-line">
              {members.map((m) => {
                const isSelf = m.user.id === me;
                const editable = can.manageMember(role, m.role, isSelf);
                const options = Array.from(new Set([m.role, ...can.assignableRoles(role)]));
                return (
                  <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar user={m.user} size="lg" />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-ink">
                          {m.user.name}
                          {isSelf && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {m.user.email}
                          {m.user.jobTitle && `, ${m.user.jobTitle}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 pl-[52px] sm:pl-0">
                      <div className="hidden w-24 text-xs text-muted md:block">
                        <p className="tabular">{m.openTaskCount} open tasks</p>
                        <p title={formatDate(m.joinedAt.slice(0, 10))}>Joined {timeAgo(m.joinedAt)}</p>
                      </div>
                      {editable ? (
                        <Select
                          aria-label={`Role for ${m.user.name}`}
                          value={m.role}
                          disabled={roleState.isLoading}
                          onChange={(e) => void changeRole(m, e.target.value as Role)}
                          className="w-32"
                        >
                          {options.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <div className="w-32">
                          <RoleBadge role={m.role} />
                        </div>
                      )}
                      <div className="w-9">
                        {editable && (
                          <Button variant="ghost" size="icon" aria-label={`Remove ${m.user.name}`} onClick={() => setRemoving(m)}>
                            <UserMinus />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {manage && (
          <Card>
            <CardHeader title="Pending invitations" description="People who have been invited but haven’t responded yet." />
            {invitations && invitations.length > 0 ? (
              <ul className="divide-y divide-line">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <Mail className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink">{inv.email}</p>
                      <p className="text-xs text-muted">
                        Invited as {ROLE_LABEL[inv.role].toLowerCase()} by {inv.invitedBy.name}, {timeAgo(inv.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<X />}
                      loading={revokeState.isLoading && revokeState.originalArgs?.invitationId === inv.id}
                      onClick={() => setRevoking(inv)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-[13px] text-muted">No pending invitations.</p>
              </CardBody>
            )}
          </Card>
        )}

        <Card>
          <CardHeader title="Roles and permissions" description="Enforced by the server on every request, not just hidden in the interface." />
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="bg-surface-2/60 text-xs text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    <ShieldCheck className="mr-1 -mt-0.5 inline size-4" aria-hidden="true" />
                    Permission
                  </th>
                  {(['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'] as Role[]).map((r) => (
                    <th key={r} scope="col" className={`px-3 py-2 text-center font-semibold ${r === role ? 'text-accent' : ''}`}>
                      {ROLE_LABEL[r]}
                      {r === role && <span className="sr-only"> (your role)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {MATRIX.map(([label, ...allowed]) => (
                  <tr key={label}>
                    <th scope="row" className="px-5 py-2 text-left font-normal text-ink-2">
                      {label}
                    </th>
                    {allowed.map((ok, i) => (
                      <td key={i} className="px-3 py-2 text-center">
                        {ok ? <Check className="mx-auto size-4 text-success" aria-label="Allowed" /> : <Minus className="mx-auto size-4 text-subtle" aria-label="Not allowed" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <InviteDialog open={inviting} onOpenChange={setInviting} projectId={project.id} roles={can.assignableRoles(role)} />
        <ConfirmDialog
          open={revoking !== null}
          onOpenChange={(o) => !o && setRevoking(null)}
          title="Revoke this invitation?"
          description={revoking ? `${revoking.email} won’t be able to join with it any more. You can invite them again later.` : ''}
          confirmLabel="Revoke invitation"
          loading={revokeState.isLoading}
          onConfirm={async () => {
            if (!revoking) return;
            await revoke({ projectId: project.id, invitationId: revoking.id })
              .unwrap()
              .then(() => {
                setRevoking(null);
                toast.success('Invitation revoked');
              })
              .catch((e) => toast.error(getErrorMessage(e)));
          }}
        />
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Remove ${removing?.user.name}?`}
          description="They will lose access to this project immediately. Their open tasks will become unassigned; completed work and history are kept."
          confirmLabel="Remove member"
          loading={removeState.isLoading}
          onConfirm={async () => {
            if (!removing) return;
            try {
              await removeMember({ projectId: project.id, memberId: removing.id }).unwrap();
              toast.success(`${removing.user.name} was removed`);
              setRemoving(null);
            } catch (e) {
              toast.error(getErrorMessage(e));
            }
          }}
        />
      </div>
    </div>
  );
}
