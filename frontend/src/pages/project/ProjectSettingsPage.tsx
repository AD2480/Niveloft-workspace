import { Archive, Download, LogOut, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useDeleteProjectMutation, useLeaveProjectMutation, useUpdateProjectMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import { ProjectMark, ProjectStatusBadge } from '@/components/domain';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Form';
import { useAppSelector } from '@/app/store';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { OwnershipCard, SecurityLogCard } from '@/features/projects/ProjectSecurity';
import { FlurryCorrections } from '@/features/assistant/FlurryCorrections';
import { ForecastTrialStatus } from '@/features/delivery/ForecastTrial';
import { downloadTaskHistory } from '@/features/projects/taskHistory';
import { useProjectContext } from '@/features/projects/projectContext';
import { formatDate } from '@/lib/dates';
import { can } from '@/lib/permissions';

export function ProjectSettingsPage() {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const role = project.myRole;
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [updateProject, updateState] = useUpdateProjectMutation();
  const [leaveProject, leaveState] = useLeaveProjectMutation();
  const [deleteProject, deleteState] = useDeleteProjectMutation();
  const token = useAppSelector((s) => s.auth.token);
  const [downloading, setDownloading] = useState(false);

  const downloadHistory = async () => {
    setDownloading(true);
    try {
      await downloadTaskHistory(project.id, project.key, token);
      toast.success('Task history downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : getErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  const toggleArchive = async () => {
    const archived = project.status === 'ARCHIVED';
    try {
      await updateProject({
        id: project.id,
        body: {
          name: project.name,
          key: project.key,
          description: project.description,
          color: project.color,
          startDate: project.startDate,
          deadline: project.deadline,
          status: archived ? 'ACTIVE' : 'ARCHIVED',
          version: project.version,
        },
      }).unwrap();
      toast.success(archived ? 'Project restored' : 'Project archived');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10">
      <div className="max-w-3xl space-y-6">
        <Card>
          <CardHeader
            title="Project details"
            action={
              can.editProject(role) && (
                <Button variant="secondary" size="sm" leftIcon={<Pencil />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )
            }
          />
          <CardBody>
            <div className="flex items-center gap-3">
              <ProjectMark name={project.name} color={project.color} size="lg" />
              <div>
                <p className="font-semibold text-ink">{project.name}</p>
                <p className="font-mono text-xs text-muted">{project.key}</p>
              </div>
              <span className="ml-auto">
                <ProjectStatusBadge status={project.status} />
              </span>
            </div>
            <dl className="mt-4 grid gap-4 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Start date</dt>
                <dd className="mt-0.5 text-ink">{formatDate(project.startDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Deadline</dt>
                <dd className="mt-0.5 text-ink">{formatDate(project.deadline)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Owner</dt>
                <dd className="mt-0.5 text-ink">{project.owner.name}</dd>
              </div>
            </dl>
            {!can.editProject(role) && <p className="mt-4 text-xs text-muted">Only owners and managers can edit project details.</p>}
          </CardBody>
        </Card>

        {can.editProject(role) && (
          <Card data-task-history="">
            <CardHeader title="Forecast training data" />
            <CardBody>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-xl">
                  <p className="text-[13px] text-ink-2">The task history, as a file for training and testing a deadline forecast on this project’s own finished work.</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Dates, estimates, priorities, dependencies and counts. People appear as p1, p2 and so on; no titles, descriptions, comments or names are included.
                  </p>
                </div>
                <Button variant="secondary" leftIcon={<Download />} onClick={() => void downloadHistory()} loading={downloading} className="shrink-0">
                  Download CSV
                </Button>
              </div>
              <ForecastTrialStatus project={project} />
            </CardBody>
          </Card>
        )}

        {can.editProject(role) && <FlurryCorrections project={project} />}

        {role === 'OWNER' && <OwnershipCard project={project} />}
        {can.editProject(role) && <SecurityLogCard project={project} />}

        {(can.editProject(role) || can.leaveProject(role)) && (
          <Card className="border-danger/30">
            <CardHeader title="Danger zone" />
            <CardBody className="divide-y divide-line py-0">
              {can.editProject(role) && (
                <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{project.status === 'ARCHIVED' ? 'Restore project' : 'Archive project'}</p>
                    <p className="text-xs text-muted">
                      {project.status === 'ARCHIVED' ? 'Make the project active again.' : 'Hide it from active lists and make the board read-only. You can restore it later.'}
                    </p>
                  </div>
                  <Button variant="secondary" leftIcon={<Archive />} onClick={() => void toggleArchive()} loading={updateState.isLoading}>
                    {project.status === 'ARCHIVED' ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              )}
              {can.leaveProject(role) && (
                <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Leave project</p>
                    <p className="text-xs text-muted">You’ll lose access. Your open tasks will become unassigned.</p>
                  </div>
                  <Button variant="secondary" leftIcon={<LogOut />} onClick={() => setLeaving(true)}>
                    Leave
                  </Button>
                </div>
              )}
              {can.deleteProject(role) && (
                <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Delete project</p>
                    <p className="text-xs text-muted">Permanently delete the project, its tasks, comments, submissions and history.</p>
                  </div>
                  <Button variant="danger" leftIcon={<Trash2 />} onClick={() => setDeleting(true)}>
                    Delete
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        <ProjectFormDialog open={editing} onOpenChange={setEditing} project={project} />
        <ConfirmDialog
          open={leaving}
          onOpenChange={setLeaving}
          title={`Leave ${project.name}?`}
          description="You will need a new invitation to rejoin."
          confirmLabel="Leave project"
          loading={leaveState.isLoading}
          onConfirm={async () => {
            try {
              await leaveProject(project.id).unwrap();
              toast.success(`You left ${project.name}`);
              navigate('/projects', { replace: true });
            } catch (e) {
              toast.error(getErrorMessage(e));
            }
          }}
        />
        <Dialog
          open={deleting}
          onOpenChange={(o) => {
            setDeleting(o);
            if (!o) setConfirmText('');
          }}
          dismissible={!deleteState.isLoading}
          size="sm"
          title="Delete this project?"
          description="This cannot be undone."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(false)} disabled={deleteState.isLoading}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={confirmText !== project.key}
                loading={deleteState.isLoading}
                onClick={async () => {
                  try {
                    await deleteProject(project.id).unwrap();
                    toast.success(`${project.name} deleted`);
                    navigate('/projects', { replace: true });
                  } catch (e) {
                    toast.error(getErrorMessage(e));
                  }
                }}
              >
                Delete project
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-[13px] text-ink-2">
            <p>
              All <strong className="text-ink">{project.taskCounts.total} tasks</strong>, their comments, submissions, reviews and the activity history of{' '}
              <strong className="text-ink">{project.name}</strong> will be permanently deleted.
            </p>
            <Field
              label={
                <>
                  Type <span className="font-mono font-semibold">{project.key}</span> to confirm
                </>
              }
            >
              {(p) => <Input {...p} value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} autoComplete="off" />}
            </Field>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
