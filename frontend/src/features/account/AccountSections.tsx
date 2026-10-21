import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useDeleteAccountMutation, useDeletionCheckQuery, useEndSessionMutation, useLogoutEverywhereMutation, useSessionsQuery } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import { loggedOut, useAppDispatch, useAppSelector } from '@/app/store';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input } from '@/components/ui/Form';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { downloadAccountCopy } from '@/features/account/accountData';
import { announceSignOut } from '@/features/auth/keptSignIn';
import { formatDate, timeAgo } from '@/lib/dates';

/** Where I'm signed in: each session, with a way to end any of them, or all of them. */
export function SessionsCard() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const me = useAppSelector((s) => s.auth.user?.id);
  const sessions = useSessionsQuery();
  const [endSession, ending] = useEndSessionMutation();
  const [everywhere, { isLoading: leaving }] = useLogoutEverywhereMutation();
  const [confirm, setConfirm] = useState(false);
  const list = sessions.data ?? [];

  return (
    <Card data-sessions="">
      <CardHeader
        title="Where you’re signed in"
        description="Each sign-in is a session on the server. Ending one signs that device out at once, wherever its sign-in was copied."
      />
      <CardBody className="space-y-3 text-[13px]">
        {sessions.isLoading && <p className="text-muted">Loading your sessions…</p>}
        {sessions.isError && <FormError message={getErrorMessage(sessions.error, 'Your sessions couldn’t be loaded. Try again.')} />}
        {list.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Your sessions">
            {list.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-session={s.current ? 'current' : 'other'}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    <span className="truncate">{s.device ?? 'An unknown device'}</span>
                    {s.current && <Badge tone="brand">This device</Badge>}
                    {s.remember && <Badge tone="neutral">Kept signed in</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    Signed in {formatDate(s.createdAt)}, last used {timeAgo(s.lastSeenAt)}
                    {s.network ? `, from network ${s.network}` : ''}. Ends by {formatDate(s.expiresAt)} at the latest.
                  </p>
                </div>
                {!s.current && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={ending.isLoading && ending.originalArgs === s.id}
                    onClick={async () => {
                      try {
                        await endSession(s.id).unwrap();
                        toast.success('That device was signed out');
                      } catch (e) {
                        toast.error(getErrorMessage(e, 'That session couldn’t be ended. Try again.'));
                      }
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-ink">Sign out everywhere</p>
            <p className="text-xs text-muted">Every device, this one included. Use it if a device was lost or someone else might have your sign-in.</p>
          </div>
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Sign out everywhere
          </Button>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Sign out everywhere?"
        description="Every session ends now, including this one. You’ll sign in again with your password."
        confirmLabel="Sign out everywhere"
        loading={leaving}
        onConfirm={async () => {
          try {
            const message = await everywhere().unwrap();
            toast.success(message);
          } catch (e) {
            toast.error(getErrorMessage(e, 'Not every session could be ended. Try again.'));
            return;
          }
          setConfirm(false);
          dispatch(loggedOut());
          announceSignOut(me);
          navigate('/login', { replace: true });
        }}
      />
    </Card>
  );
}

/** A copy of my data, and deleting my account. */
export function YourDataCard() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const token = useAppSelector((s) => s.auth.token);
  const me = useAppSelector((s) => s.auth.user?.id);
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(false);
  const check = useDeletionCheckQuery(undefined, { skip: !open });
  const [remove, { isLoading: deleting }] = useDeleteAccountMutation();
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const blocked = check.data?.blockedBy ?? [];
  const withIt = check.data?.deletedWith ?? [];

  return (
    <Card data-your-data="">
      <CardHeader title="Your data" description="Everything Niveloft holds about you, and how to remove it." />
      <CardBody className="space-y-3 text-[13px] text-ink-2">
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-ink">Download a copy</p>
            <p className="text-xs text-muted">
              A JSON file with your profile, projects and roles, tasks assigned to you, what you wrote (comments, submissions, reviews, project documents), your
              ratings of Flurry’s answers, your notifications and sign-ins. Files you uploaded are listed by name and stay downloadable from their projects.
            </p>
          </div>
          <Button
            variant="secondary"
            loading={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await downloadAccountCopy(token);
                toast.success('Your data downloaded');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'The copy couldn’t be prepared. Try again.');
              } finally {
                setDownloading(false);
              }
            }}
          >
            Download my data
          </Button>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-ink">Delete your account</p>
            <p className="text-xs text-muted">
              Removes your name, email, password and sessions, and projects you own alone. What you wrote in shared projects stays there, shown as by a deleted
              user, so your team’s review history stays whole.
            </p>
          </div>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </div>
      </CardBody>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (deleting) return;
          setOpen(o);
          if (!o) {
            setPassword('');
            setTyped('');
            setError(null);
          }
        }}
        title="Delete your account?"
        description="This can’t be undone. Download a copy of your data first if you want one."
        size="sm"
        role="alertdialog"
        dismissible={!deleting}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={deleting}>
              Keep my account
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              disabled={!check.data?.canDelete || typed !== 'DELETE' || password.length === 0}
              onClick={async () => {
                setError(null);
                try {
                  await remove({ password, confirm: typed }).unwrap();
                  setOpen(false);
                  toast.success('Your account was deleted');
                  dispatch(loggedOut());
                  announceSignOut(me);
                  navigate('/', { replace: true });
                } catch (e) {
                  setError(getErrorMessage(e, 'Your account couldn’t be deleted. Try again.'));
                }
              }}
            >
              Delete my account
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-[13px] text-ink-2" data-delete-account="">
          {check.isLoading && <p className="text-muted">Checking your projects…</p>}
          {blocked.length > 0 && (
            <div className="rounded-lg bg-warning-soft p-3" role="status">
              <p className="font-medium text-ink">First, hand over {blocked.length === 1 ? 'a project' : 'these projects'}</p>
              <p className="mt-1">
                You own {blocked.map((n) => `“${n}”`).join(', ')} with other people. Make someone else the owner in each project’s settings (Transfer ownership), or
                delete it, then come back.
              </p>
              <p className="mt-2">
                <Link to="/projects" className="text-accent underline underline-offset-2" onClick={() => setOpen(false)}>
                  Go to your projects
                </Link>
              </p>
            </div>
          )}
          {withIt.length > 0 && <p>These projects you own alone are deleted with your account: {withIt.map((n) => `“${n}”`).join(', ')}.</p>}
          <FormError message={error} />
          <Field label="Your password" required>
            {(p) => <PasswordInput {...p} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
          </Field>
          <Field label="Type DELETE to confirm" required>
            {(p) => <Input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
