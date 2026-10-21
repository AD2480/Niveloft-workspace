import { FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCreateDocumentMutation, useUpdateDocumentMutation } from '@/api/endpoints';
import { getErrorMessage, isEditConflict } from '@/api/errors';
import type { ProjectDocument } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/Form';
import { splitDocument } from '@/lib/documentText';

const MAX_CHARS = 200_000;

/**
 * Writing a project document, or importing one from a Markdown or text file. A new document is a
 * draft; changing an approved document's text sends it back to draft, and the editor says so
 * before saving.
 */
export function DocumentEditor({ projectId, document, onClose }: { projectId: number; document: ProjectDocument | null; onClose: (saved: ProjectDocument | null) => void }) {
  const [create, createState] = useCreateDocumentMutation();
  const [update, updateState] = useUpdateDocumentMutation();
  const [title, setTitle] = useState(document?.title ?? '');
  const [body, setBody] = useState(document?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const passages = useMemo(() => splitDocument(body).length, [body]);
  const busy = createState.isLoading || updateState.isLoading;
  const losesApproval = document?.status === 'APPROVED' && body.trim() !== document.body.trim();

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(md|markdown|txt)$/i.test(f.name) && !f.type.startsWith('text/')) {
      setError('Import a Markdown (.md) or plain-text (.txt) file. For a PDF or Word file, copy its text in.');
      return;
    }
    if (f.size > MAX_CHARS * 4) {
      setError('That file is too long for one document. Split it into parts.');
      return;
    }
    const text = await f.text();
    setBody(text.slice(0, MAX_CHARS));
    if (!title.trim()) setTitle(f.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ').slice(0, 160));
    setError(text.length > MAX_CHARS ? `Only the first ${MAX_CHARS.toLocaleString()} characters were kept.` : null);
  };

  const save = async () => {
    setError(null);
    try {
      const req = { title: title.trim(), body, version: document?.version ?? null };
      const saved = document ? await update({ projectId, id: document.id, body: req }).unwrap() : await create({ projectId, body: req }).unwrap();
      toast.success(document ? (saved.status === 'DRAFT' && document.status === 'APPROVED' ? 'Saved. It’s a draft again until it’s approved.' : 'Saved.') : 'Saved as a draft. Flurry reads it once an owner or manager approves it.');
      onClose(saved);
    } catch (e) {
      setError(isEditConflict(e) ? 'Someone changed this document since you opened it. Close this and reopen it to see their version; copy your text first if you need it.' : getErrorMessage(e));
    }
  };

  return (
    <Dialog
      open
      size="xl"
      onOpenChange={(o) => !o && !busy && onClose(null)}
      title={document ? `Edit “${document.title}”` : 'New document'}
      description="Markdown headings (#, ##) become the sections Flurry cites. Paste the text, or import a .md or .txt file."
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!title.trim() || !body.trim() || body.length > MAX_CHARS} data-document-save="">
            {document ? 'Save' : 'Save as a draft'}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-document-editor="">
        <FormError message={error} />
        <Field label="Title" required>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Sign-in specification" />}
        </Field>
        <Field label="Text" required hint={`${body.length.toLocaleString()} of ${MAX_CHARS.toLocaleString()} characters, ${passages === 1 ? 'one passage' : `${passages} passages`}.`}>
          {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={16} className="font-mono text-[13px]" placeholder={'# Sessions\n\nA session ends after 30 minutes without activity.'} />}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={file} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" className="sr-only" onChange={(e) => void importFile(e.target.files?.[0])} data-document-import="" />
          <Button variant="outline" size="sm" leftIcon={<FileUp />} onClick={() => file.current?.click()}>
            Import a file
          </Button>
          <span className="text-[12.5px] text-muted">The file stays on your device; only its text is saved.</span>
        </div>
        {losesApproval && (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" data-document-loses-approval="">
            Saving a change to the text makes this a draft again: Flurry stops reading it until an owner or manager approves it again.
          </p>
        )}
      </div>
    </Dialog>
  );
}
