import { ArrowDown, ArrowUp, CheckSquare, ListChecks, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTaskQuery, useToggleChecklistItemMutation, useUpdateChecklistMutation, useUpdateCriteriaMutation } from '@/api/endpoints';
import { getErrorMessage, isEditConflict } from '@/api/errors';
import type { Task } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { AiCriteriaSuggest } from '@/features/ai/AiPanels';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FormError, Input } from '@/components/ui/Form';
import { cn } from '@/lib/cn';

interface Row {
  id: number | null;
  text: string;
  done: boolean;
}

/** Inline list editor: add, remove, reorder, rename. Returns null rows are dropped on save. */
function ListEditor({
  rows,
  onChange,
  placeholder,
  max,
  label,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  placeholder: string;
  max: number;
  label: string;
}) {
  const update = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-right text-xs text-muted tabular">{i + 1}.</span>
            <Input
              aria-label={`${label} ${i + 1}`}
              value={r.text}
              maxLength={500}
              placeholder={placeholder}
              onChange={(e) => update(i, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && rows.length < max) {
                  e.preventDefault();
                  onChange([...rows.slice(0, i + 1), { id: null, text: '', done: false }, ...rows.slice(i + 1)]);
                }
              }}
            />
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${label.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${label.toLowerCase()} ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
      {rows.length < max && (
        <Button variant="ghost" size="sm" leftIcon={<Plus />} onClick={() => onChange([...rows, { id: null, text: '', done: false }])}>
          Add {label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

/**
 * Acceptance criteria (what the reviewer checks) and the checklist (steps the assignee ticks
 * off before submitting). Both lock while the task is In Review or Done, as on the server.
 */
export function TaskCriteriaCard({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { refetch } = useTaskQuery(task.id);
  const [saveCriteria, criteriaState] = useUpdateCriteriaMutation();
  const [saveChecklist, checklistState] = useUpdateChecklistMutation();
  const [toggle] = useToggleChecklistItemMutation();
  const [editing, setEditing] = useState<null | 'criteria' | 'checklist'>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const locked = task.status === 'IN_REVIEW' || task.status === 'DONE';
  const editable = canEdit && !locked;
  const doneCount = task.checklist.filter((c) => c.done).length;

  const start = (what: 'criteria' | 'checklist') => {
    setError(null);
    setEditing(what);
    setRows(
      what === 'criteria'
        ? task.acceptanceCriteria.map((c) => ({ id: c.id, text: c.text, done: false }))
        : task.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    );
  };

  const save = async () => {
    const items = rows.filter((r) => r.text.trim()).map((r) => ({ ...r, text: r.text.trim() }));
    setError(null);
    try {
      if (editing === 'criteria') {
        await saveCriteria({ id: task.id, projectId: task.projectId, version: task.version, items: items.map(({ id, text }) => ({ id, text })) }).unwrap();
        toast.success('Acceptance criteria saved');
      } else {
        await saveChecklist({ id: task.id, projectId: task.projectId, version: task.version, items }).unwrap();
        toast.success('Checklist saved');
      }
      setEditing(null);
    } catch (e) {
      if (isEditConflict(e)) {
        setError('Someone else changed this task while you were editing. Your edits are still here: reload the latest version, then save again.');
      } else {
        setError(getErrorMessage(e));
      }
    }
  };

  const saving = criteriaState.isLoading || checklistState.isLoading;

  return (
    <Card>
      <CardHeader
        title="Definition of done"
        description="Acceptance criteria are checked by the reviewer. The checklist must be complete before submitting."
        action={
          locked ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3.5" aria-hidden="true" /> Locked while {task.status === 'DONE' ? 'done' : 'in review'}
            </span>
          ) : null
        }
      />
      <CardBody className="space-y-6">
        {/* Acceptance criteria ------------------------------------------------ */}
        <section aria-labelledby={`criteria-${task.id}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id={`criteria-${task.id}`} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <CheckSquare className="size-4 text-muted" aria-hidden="true" />
              Acceptance criteria
              <span className="font-normal text-muted tabular">{task.acceptanceCriteria.length}</span>
            </h3>
            {editable && editing !== 'criteria' && (
              <Button variant="ghost" size="xs" leftIcon={<Pencil />} onClick={() => start('criteria')} disabled={editing !== null}>
                Edit
              </Button>
            )}
          </div>
          {editing === 'criteria' ? (
            <div className="space-y-3">
              <FormError message={error} />
              <ListEditor rows={rows} onChange={setRows} placeholder="e.g. Errors are announced to screen readers" max={20} label="Criterion" />
              <AiCriteriaSuggest taskId={task.id} onAdd={(items) => setRows((r) => [...r, ...items.map((text) => ({ id: null, text, done: false }))].slice(0, 20))} />
              <div className="flex justify-end gap-2">
                {error && (
                  <Button variant="ghost" size="sm" onClick={() => void refetch()}>
                    Reload latest
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} loading={saving}>
                  Save criteria
                </Button>
              </div>
            </div>
          ) : task.acceptanceCriteria.length > 0 ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-2 marker:text-muted">
              {task.acceptanceCriteria.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">
              No acceptance criteria yet.{editable ? ' Add the checks a reviewer should make before approving.' : ''}
            </p>
          )}
        </section>

        {/* Checklist ------------------------------------------------------------ */}
        <section aria-labelledby={`checklist-${task.id}`} className="border-t border-line pt-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id={`checklist-${task.id}`} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <ListChecks className="size-4 text-muted" aria-hidden="true" />
              Checklist
              {task.checklist.length > 0 && (
                <span className="font-normal text-muted tabular">
                  {doneCount}/{task.checklist.length}
                </span>
              )}
            </h3>
            {editable && editing !== 'checklist' && (
              <Button variant="ghost" size="xs" leftIcon={<Pencil />} onClick={() => start('checklist')} disabled={editing !== null}>
                Edit
              </Button>
            )}
          </div>
          {editing === 'checklist' ? (
            <div className="space-y-3">
              <FormError message={error} />
              <ListEditor rows={rows} onChange={setRows} placeholder="e.g. Write unit tests" max={30} label="Item" />
              <div className="flex justify-end gap-2">
                {error && (
                  <Button variant="ghost" size="sm" onClick={() => void refetch()}>
                    Reload latest
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} loading={saving}>
                  Save checklist
                </Button>
              </div>
            </div>
          ) : task.checklist.length > 0 ? (
            <ul className="space-y-1">
              {task.checklist.map((c) => (
                <li key={c.id}>
                  <label className={cn('flex items-start gap-2.5 rounded-sm px-1 py-1 text-[13.5px]', editable ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default')}>
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                      checked={c.done}
                      disabled={!editable}
                      onChange={(e) =>
                        void toggle({ itemId: c.id, taskId: task.id, projectId: task.projectId, done: e.target.checked })
                          .unwrap()
                          .catch((err: unknown) => toast.error(getErrorMessage(err)))
                      }
                    />
                    <span className={cn('min-w-0 flex-1', c.done ? 'text-muted line-through' : 'text-ink-2')}>{c.text}</span>
                    {c.done && c.doneBy && <span className="shrink-0 text-xs text-muted">{c.doneBy.name.split(' ')[0]}</span>}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No checklist.</p>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
