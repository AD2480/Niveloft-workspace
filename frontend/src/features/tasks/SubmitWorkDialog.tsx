import { CheckSquare, FileText, FileUp, GitBranch, Globe, ImageIcon, Link2, ListChecks, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSubmitWorkMutation, useTaskQuery, useToggleChecklistItemMutation } from '@/api/endpoints';
import { getErrorMessage, getFieldErrors } from '@/api/errors';
import type { EvidenceLinkInput, Task } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/Form';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useDiscardGuard } from '@/lib/useDiscardGuard';
import { useTrackedForm } from '@/lib/useTrackedForm';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LINKS = 12;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

interface LinkRow {
  label: string;
  url: string;
}

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** Local preview for a chosen screenshot; the object URL is released when the file is removed. */
function FilePreview({ file }: { file: File }) {
  const url = useMemo(() => (IMAGE_TYPES.includes(file.type) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (!url) return <FileText className="size-8 text-muted" aria-hidden="true" />;
  return <img src={url} alt="" className="size-10 rounded-sm border border-line object-cover" />;
}

/**
 * Submit work with evidence. Mirrors the server rules so problems show up before sending:
 * the checklist must be complete, at least one link or file is required, links must be
 * full http(s) URLs, and at most 5 files of 10 MB each. The server enforces all of it again.
 */
export function SubmitWorkDialog({ task: initial, open, onOpenChange }: { task: Task | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  // Always work from the freshest copy of the task (the board card may be stale).
  const { data: fresh } = useTaskQuery(initial?.id ?? 0, { skip: !initial || !open });
  const task = fresh ?? initial;
  const [submitWork, { isLoading }] = useSubmitWorkMutation();
  const [toggle] = useToggleChecklistItemMutation();
  const [notes, setNotes] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [deployUrl, setDeployUrl] = useState('');
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const track = useTrackedForm('submit-work', open && !!initial);
  const dirty = notes.trim() !== '' || repoUrl.trim() !== '' || deployUrl.trim() !== '' || links.length > 0 || files.length > 0;
  const guard = useDiscardGuard(open && dirty && !isLoading, () => onOpenChange(false), 'this submission');

  useEffect(() => {
    if (open) {
      setNotes('');
      setRepoUrl('');
      setDeployUrl('');
      setLinks([]);
      setFiles([]);
      setErrors({});
      setFormError(null);
    }
  }, [open, initial?.id]);

  if (!task) return null;

  const openItems = task.checklist.filter((c) => !c.done);
  const blocked = openItems.length > 0;

  /** Evidence in the order the server will index it, with the form field each entry came from. */
  const evidenceSlots = (): { input: EvidenceLinkInput; field: string }[] => {
    const out: { input: EvidenceLinkInput; field: string }[] = [];
    if (repoUrl.trim()) out.push({ input: { kind: 'REPOSITORY', label: 'Repository', url: repoUrl.trim() }, field: 'repo' });
    if (deployUrl.trim()) out.push({ input: { kind: 'DEPLOYMENT', label: 'Deployed app', url: deployUrl.trim() }, field: 'deploy' });
    links.forEach((l, i) => {
      if (l.url.trim()) out.push({ input: { kind: 'LINK', label: l.label.trim(), url: l.url.trim() }, field: `link-${i}` });
    });
    return out;
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (notes.trim().length < 10) e.notes = 'Describe what you did in at least 10 characters.';
    else if (notes.length > 5000) e.notes = 'Notes must be at most 5000 characters.';
    const slots = evidenceSlots();
    for (const s of slots) if (!isHttpUrl(s.input.url)) e[s.field] = 'Enter a full URL starting with http:// or https://';
    links.forEach((l, i) => {
      if (l.label.trim() && !l.url.trim()) e[`link-${i}`] = 'Add the URL for this link, or remove it.';
    });
    if (slots.length === 0 && files.length === 0) e.evidence = 'Add at least one piece of evidence: a repository, a deployment, a link or a file.';
    if (slots.length > MAX_LINKS) e.evidence = `Add at most ${MAX_LINKS} links.`;
    if (files.length > MAX_FILES) e.files = `Attach at most ${MAX_FILES} files.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than 10 MB.`);
    const next = [...files, ...incoming.filter((f) => f.size <= MAX_FILE_BYTES)];
    if (next.length > MAX_FILES) toast.error(`Only the first ${MAX_FILES} files were kept.`);
    setFiles(next.slice(0, MAX_FILES));
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async () => {
    setFormError(null);
    if (blocked || !validate()) {
      track.invalid();
      return;
    }
    const slots = evidenceSlots();
    track.submitted();
    try {
      await submitWork({ taskId: task.id, projectId: task.projectId, notes: notes.trim(), evidence: slots.map((s) => s.input), files }).unwrap();
      track.succeeded();
      toast.success(`${task.key} submitted for review`, { description: 'Reviewers have been notified.' });
      onOpenChange(false);
    } catch (e) {
      track.failed(e);
      // Map "evidence.N" back to the input it came from.
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(getFieldErrors(e))) {
        const m = /^evidence\.(\d+)$/.exec(k);
        mapped[m ? (slots[Number(m[1])]?.field ?? 'evidence') : k] = v;
      }
      setErrors((prev) => ({ ...prev, ...mapped }));
      setFormError(getErrorMessage(e));
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      dismissible={!isLoading}
      size="lg"
      title={`Submit ${task.key} for review`}
      description="Show the reviewer how the work meets each acceptance criterion. They will approve it or request changes."
      footer={
        <>
          <Button variant="secondary" onClick={guard.requestClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isLoading} disabled={blocked}>
            Submit for review
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <FormError message={formError} />
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          <span className="font-medium text-muted tabular">{task.key}</span> {task.title}
        </p>

        {task.checklist.length > 0 && (
          <section aria-labelledby="submit-checklist" className={cn('rounded-md border px-3 py-3', blocked ? 'border-warning/40 bg-warning-soft/40' : 'border-line')}>
            <h3 id="submit-checklist" className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <ListChecks className="size-4" aria-hidden="true" />
              Checklist {task.checklist.length - openItems.length}/{task.checklist.length}
            </h3>
            {blocked && <p className="mb-2 text-xs text-ink-2">Finish every item before submitting. You can tick them here.</p>}
            <ul className="space-y-1">
              {task.checklist.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                      checked={c.done}
                      onChange={(e) =>
                        void toggle({ itemId: c.id, taskId: task.id, projectId: task.projectId, done: e.target.checked })
                          .unwrap()
                          .catch((err: unknown) => toast.error(getErrorMessage(err)))
                      }
                    />
                    <span className={cn(c.done && 'text-muted line-through')}>{c.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {task.acceptanceCriteria.length > 0 ? (
          <section aria-labelledby="submit-criteria">
            <h3 id="submit-criteria" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <CheckSquare className="size-4" aria-hidden="true" />
              The reviewer will check
            </h3>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
              {task.acceptanceCriteria.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ol>
          </section>
        ) : (
          <p className="text-xs text-muted">This task has no acceptance criteria, so the reviewer will judge the work from your notes and evidence.</p>
        )}

        <Field label="Notes" required error={errors.notes} hint="What changed, how you tested it, and how each criterion is met.">
          {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} placeholder="Implemented …, tested by …" />}
        </Field>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-[13px] font-medium text-ink-2">Evidence</legend>
          {errors.evidence && (
            <p className="text-xs font-medium text-danger" role="alert">
              {errors.evidence}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Repository or pull request" error={errors.repo}>
              {(p) => <Input {...p} type="url" leftIcon={<GitBranch />} placeholder="https://github.com/…/pull/12" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />}
            </Field>
            <Field label="Deployed version" error={errors.deploy}>
              {(p) => <Input {...p} type="url" leftIcon={<Globe />} placeholder="https://preview.example.com" value={deployUrl} onChange={(e) => setDeployUrl(e.target.value)} />}
            </Field>
          </div>

          {links.map((l, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <Input
                  aria-label={`Link ${i + 1} label`}
                  placeholder="Label (e.g. Walkthrough video)"
                  value={l.label}
                  onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  className="w-2/5"
                />
                <Input
                  aria-label={`Link ${i + 1} URL`}
                  aria-invalid={!!errors[`link-${i}`]}
                  leftIcon={<Link2 />}
                  placeholder="https://"
                  type="url"
                  value={l.url}
                  onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <Button variant="ghost" size="icon" aria-label={`Remove link ${i + 1}`} onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              {errors[`link-${i}`] && <p className="text-xs font-medium text-danger">{errors[`link-${i}`]}</p>}
            </div>
          ))}
          {links.length < MAX_LINKS - 2 && (
            <Button variant="ghost" size="sm" leftIcon={<Plus />} onClick={() => setLinks((ls) => [...ls, { label: '', url: '' }])}>
              Add another link
            </Button>
          )}

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Screenshots and files</span>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-muted transition-colors hover:border-accent hover:bg-accent/5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <FileUp className="size-5" aria-hidden="true" />
              <span>
                <span className="font-medium text-accent">Choose files</span> or drag them here
              </span>
              <span className="text-xs">Up to {MAX_FILES} files, 10 MB each. PNG, JPEG, GIF and WebP show as screenshots.</span>
              <input ref={fileInput} type="file" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            </label>
            {errors.files && <p className="mt-1 text-xs font-medium text-danger">{errors.files}</p>}
            {files.length > 0 && (
              <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <FilePreview file={f} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{f.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        {IMAGE_TYPES.includes(f.type) ? <ImageIcon className="size-3" aria-hidden="true" /> : null}
                        {IMAGE_TYPES.includes(f.type) ? 'Screenshot' : 'File'}, <span className="tabular">{formatBytes(f.size)}</span>
                      </span>
                    </span>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </fieldset>
      </div>
    </Dialog>
    {guard.prompt}
    </>
  );
}
