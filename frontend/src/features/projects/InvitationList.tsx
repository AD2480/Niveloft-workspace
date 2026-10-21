import { Check, Mail, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useMyInvitationsQuery, useRespondToInvitationMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { Invitation } from '@/api/types';
import { ProjectMark } from '@/components/domain';
import { Button } from '@/components/ui/Button';
import { ROLE_LABEL } from '@/lib/constants';
import { timeAgo } from '@/lib/dates';

export function InvitationRow({ invitation: inv, compact }: { invitation: Invitation; compact?: boolean }) {
  const navigate = useNavigate();
  const [respond, { isLoading, originalArgs }] = useRespondToInvitationMutation();

  const handle = async (accept: boolean) => {
    try {
      await respond({ id: inv.id, accept }).unwrap();
      if (accept) {
        toast.success(`You joined ${inv.projectName}`, {
          action: { label: 'Open', onClick: () => navigate(`/projects/${inv.projectId}`) },
        });
      } else {
        toast('Invitation declined');
      }
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProjectMark name={inv.projectName} color={inv.projectColor} size={compact ? 'sm' : 'md'} />
        <div className="min-w-0">
          <p className="text-[13px] text-ink">
            <span className="font-medium">{inv.invitedBy.name}</span> invited you to <span className="font-medium">{inv.projectName}</span> as{' '}
            <span className="font-medium">{ROLE_LABEL[inv.role].toLowerCase()}</span>
          </p>
          <p className="text-xs text-muted">{timeAgo(inv.createdAt)}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" leftIcon={<X />} onClick={() => void handle(false)} loading={isLoading && originalArgs?.accept === false} disabled={isLoading}>
          Decline
        </Button>
        <Button size="sm" leftIcon={<Check />} onClick={() => void handle(true)} loading={isLoading && originalArgs?.accept === true} disabled={isLoading}>
          Accept
        </Button>
      </div>
    </div>
  );
}

/** Banner listing the user's pending project invitations (hidden when there are none). */
export function PendingInvitations() {
  const { data } = useMyInvitationsQuery();
  if (!data || data.length === 0) return null;
  return (
    <section className="rounded-xl border border-brand/25 bg-brand-soft/50 p-4" aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-brand-ink">
        <Mail className="size-4" aria-hidden="true" />
        {data.length === 1 ? 'You have a project invitation' : `You have ${data.length} project invitations`}
      </h2>
      <ul className="space-y-3">
        {data.map((inv) => (
          <li key={inv.id} className="rounded-lg bg-surface p-3 shadow-card">
            <InvitationRow invitation={inv} />
          </li>
        ))}
      </ul>
    </section>
  );
}
