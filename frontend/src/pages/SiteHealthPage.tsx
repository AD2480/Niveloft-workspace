import { CheckCircle2, ClipboardList, Inbox, Link2, Mail, Megaphone, RotateCcw, ShieldAlert, Swords, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { errorStatus, getErrorMessage } from '@/api/errors';
import { useMarkContactHandledMutation, useSiteHealthQuery } from '@/api/siteEndpoints';
import type { ContactMessage, FormStats, SiteHealth } from '@/api/types';
import { useAppSelector } from '@/app/store';
import { PageContainer } from '@/components/layout/AppShell';
import { PrintButton } from '@/components/PrintHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CopyButton } from '@/components/ui/CopyButton';
import { Field, Input } from '@/components/ui/Form';
import { LastUpdated } from '@/components/ui/LastUpdated';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/Progress';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Spinner';
import { StatGrid, StatTile } from '@/components/ui/StatTile';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { SITE_URL, USE_TEST_API } from '@/config';
import { TOPICS } from '@/features/contact/contactStore';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { EmergencySwitchesCard } from '@/features/site/EmergencySwitches';
import { completionRate, FORM_LABEL, successRate } from '@/features/site/formStats';
import { useDocumentTitle } from '@/lib/hooks';

const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);
const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;
type Period = (typeof PERIODS)[number]['value'];

/**
 * Site health, for the people who run the site (OPERATOR_EMAILS): how often each form succeeds,
 * which campaigns bring sign-ups (UTM tags), messages from the Contact form, and spending
 * against the caps. Everything is counts: no form contents, no visitors' identities.
 */
export function SiteHealthPage() {
  useDocumentTitle('Site health');
  const operator = useAppSelector((s) => s.auth.user?.operator ?? false);
  const [period, setPeriod] = useState<Period>('30');
  // Only operators can open it; the server checks too (403 for anyone else).
  const q = useSiteHealthQuery(Number(period), { skip: !operator });
  const forbidden = !operator || errorStatus(q.error) === 403;

  return (
    <PageContainer>
      <PageHeader
        title="Site health"
        description="For the people who run this site: forms that work (or don’t), where new accounts come from, messages waiting for an answer, and spending against the caps."
        actions={
          !forbidden && (
            <>
              <LastUpdated at={q.fulfilledTimeStamp} onRefresh={q.refetch} refreshing={q.isFetching} className="mr-1" />
              <PrintButton variant="ghost" />
              <Segmented<Period> label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
            </>
          )
        }
      />

      {forbidden ? (
        <Card className="mt-8">
          <EmptyState
            icon={ShieldAlert}
            title="Only the people who run this site can open this page"
            description="Their accounts are listed in the server’s OPERATOR_EMAILS setting. If that should include you, ask whoever deployed this copy of Niveloft."
            action={
              <Link to="/dashboard" className="inline-flex min-h-6 items-center py-1 text-[13px] font-medium text-accent hover:underline">
                Back to Today
              </Link>
            }
          />
        </Card>
      ) : q.isLoading ? (
        <div className="mt-8 space-y-6" role="status" aria-label="Loading site health">
          <Skeleton className="h-36" />
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
        </div>
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={q.refetch} title="Couldn’t load site health" />
      ) : (
        <Report data={q.data} />
      )}
    </PageContainer>
  );
}

function Report({ data }: { data: SiteHealth }) {
  const totals = data.forms.reduce((t, f) => ({ submits: t.submits + f.submits, successes: t.successes + f.successes, failed: t.failed + f.failed }), { submits: 0, successes: 0, failed: 0 });
  const overall = successRate(totals);
  return (
    <div className="mt-8 space-y-8">
      {USE_TEST_API && (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[13px] text-ink-2" role="note">
          Test API: these numbers come from this browser only. On the real server they add up everyone’s visits.
        </p>
      )}
      <StatGrid cols={4}>
        <StatTile label="Forms sent successfully" icon={ClipboardList} value={pct(overall)} tone={overall !== null && overall < 0.8 ? 'warning' : 'success'} hint={`${totals.successes} of ${totals.submits} sends`} />
        <StatTile label="Failed on our side" icon={ShieldAlert} value={totals.failed} tone={totals.failed ? 'danger' : 'neutral'} hint="Server errors, timeouts, lost connections" />
        <StatTile label="New accounts" icon={Megaphone} value={data.signups.total} tone="brand" hint={`${data.signups.attributed} with a known source`} />
        <StatTile label="Messages to answer" icon={Inbox} value={data.contact.open} tone={data.contact.open ? 'warning' : 'neutral'} hint={`${data.contact.total} received in all`} />
      </StatGrid>

      <FormsCard forms={data.forms} from={data.from} to={data.to} />

      <div className="grid gap-8 xl:grid-cols-2">
        <SignupsCard data={data} />
        <SpendingCard data={data} />
      </div>

      <ContactCard messages={data.contact.recent} open={data.contact.open} />

      <EmergencySwitchesCard />

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <Swords className="size-4 text-muted" aria-hidden="true" />
            {data.arenaVotes} Arena {data.arenaVotes === 1 ? 'vote' : 'votes'} in this period.
          </p>
          <Link to="/arena" className="inline-flex min-h-6 items-center py-1 text-[13px] font-medium text-accent hover:underline">
            Open the Arena scoreboard
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

function FormsCard({ forms, from, to }: { forms: FormStats[]; from: string; to: string }) {
  const sorted = [...forms].sort((a, b) => (successRate(a) ?? 2) - (successRate(b) ?? 2) || b.views - a.views);
  return (
    <Card data-site-forms="">
      <CardHeader title="Form success rates" description={`${from} to ${to}. Success rate: sends the server accepted. Completion: people who saw the form and got it done. Worst first.`} />
      {forms.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No form activity in this period" description="Counts appear as people open and send forms." compact />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <caption className="sr-only">How often each form was shown, sent, accepted and refused</caption>
            <thead className="sticky top-0 border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium sm:px-6">Form</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Shown</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Sent</th>
                <th scope="col" className="w-48 px-3 py-2.5 font-medium">Success rate</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Completion</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium" title="Stopped by the form’s own checks">Needed fixing</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium" title="The server said no (validation, permissions, conflicts)">Refused</th>
                <th scope="col" className="px-3 py-2.5 pr-4 text-right font-medium sm:pr-6" title="Server errors, timeouts and lost connections">Failed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((f) => {
                const rate = successRate(f);
                const low = rate !== null && rate < 0.8;
                return (
                  <tr key={f.form} className="transition-colors hover:bg-surface-2/60" data-form-row={f.form}>
                    <th scope="row" className="px-4 py-2.5 font-medium text-ink sm:px-6">
                      {FORM_LABEL[f.form] ?? f.form}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular">{f.views}</td>
                    <td className="px-3 py-2.5 text-right tabular">{f.submits}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={(rate ?? 0) * 100} label={`${FORM_LABEL[f.form] ?? f.form} success rate`} color={low ? 'var(--warning)' : 'var(--success)'} className="flex-1" />
                        <span className={cn('w-10 text-right tabular', low ? 'font-semibold text-warning' : 'text-ink')}>{pct(rate)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(completionRate(f))}</td>
                    <td className="px-3 py-2.5 text-right text-muted tabular">{f.invalid}</td>
                    <td className="px-3 py-2.5 text-right text-muted tabular">{f.rejected}</td>
                    <td className={cn('px-3 py-2.5 pr-4 text-right tabular sm:pr-6', f.failed ? 'font-semibold text-danger' : 'text-muted')}>{f.failed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SignupsCard({ data }: { data: SiteHealth }) {
  const max = Math.max(1, ...data.signups.sources.map((s) => s.count));
  return (
    <Card data-site-signups="">
      <CardHeader
        title="Where new accounts come from"
        description={`${data.signups.total} new ${data.signups.total === 1 ? 'account' : 'accounts'}; ${data.signups.attributed} arrived from a tagged link or another site${data.signups.total > data.signups.attributed ? '. The rest came directly' : ''}.`}
      />
      <CardBody className="space-y-5">
        {data.signups.sources.length === 0 ? (
          <p className="text-[13px] text-muted">No sign-up came from a tagged link or another site in this period.</p>
        ) : (
          <ul className="space-y-3">
            {data.signups.sources.map((s) => (
              <li key={`${s.source}|${s.medium}|${s.campaign}`}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-ink">
                    {s.source}
                    <span className="text-muted">{[s.medium, s.campaign].filter(Boolean).map((x) => `, ${x}`).join('')}</span>
                  </span>
                  <span className="shrink-0 tabular">{s.count}</span>
                </div>
                <ProgressBar value={(s.count / max) * 100} label={`Sign-ups from ${s.source}`} className="mt-1.5" />
              </li>
            ))}
          </ul>
        )}
        <UtmBuilder />
      </CardBody>
    </Card>
  );
}

/** Builds a tagged link to share, so sign-ups from it are counted under its campaign. */
function UtmBuilder() {
  const [source, setSource] = useState('newsletter');
  const [medium, setMedium] = useState('email');
  const [campaign, setCampaign] = useState('');
  const link = useMemo(() => {
    const q = new URLSearchParams();
    if (source.trim()) q.set('utm_source', source.trim());
    if (medium.trim()) q.set('utm_medium', medium.trim());
    if (campaign.trim()) q.set('utm_campaign', campaign.trim());
    const qs = q.toString();
    return `${SITE_URL}/${qs ? `?${qs}` : ''}`;
  }, [source, medium, campaign]);
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-4" data-utm-builder="">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Link2 className="size-4 text-muted" aria-hidden="true" /> Make a tagged link
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Source">{(p) => <Input {...p} value={source} onChange={(e) => setSource(e.target.value)} maxLength={100} placeholder="newsletter" />}</Field>
        <Field label="Medium">{(p) => <Input {...p} value={medium} onChange={(e) => setMedium(e.target.value)} maxLength={100} placeholder="email" />}</Field>
        <Field label="Campaign">{(p) => <Input {...p} value={campaign} onChange={(e) => setCampaign(e.target.value)} maxLength={100} placeholder="autumn-launch" />}</Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 font-mono text-[12px] text-ink-2" title={link}>
          {link}
        </code>
        <CopyButton text={link} what="the tagged link" label="Copy link" variant="secondary" size="sm" />
      </div>
    </div>
  );
}

function SpendingCard({ data }: { data: SiteHealth }) {
  const s = data.spending;
  const rows: [string, number, number][] = [
    ['AI requests today', s.aiRequestsToday, s.aiRequestsPerDay],
    ['AI tokens this month', s.aiTokensThisMonth, s.aiTokensPerMonth],
    ['Emails today', s.emailsToday, s.emailsPerDay],
    ['Emails this month', s.emailsThisMonth, s.emailsPerMonth],
  ];
  return (
    <Card data-site-spending="">
      <CardHeader title="Spending against the caps" description="Paid services stop at their caps; nothing is charged beyond them. The caps are server settings (see the README)." />
      <CardBody className="space-y-4">
        {rows.map(([label, used, cap]) => {
          const share = cap > 0 ? used / cap : 0;
          return (
            <div key={label}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink-2">{label}</span>
                <span className={cn('tabular', share >= 0.8 ? 'font-semibold text-warning' : 'text-ink')}>
                  {used.toLocaleString()} <span className="text-muted">of {cap > 0 ? cap.toLocaleString() : 'no cap'}</span>
                </span>
              </div>
              <ProgressBar value={share * 100} label={`${label}: ${Math.round(share * 100)}% of the cap`} color={share >= 0.8 ? 'var(--warning)' : undefined} className="mt-1.5" />
            </div>
          );
        })}
        <p className="flex items-center gap-2 text-[12px] text-muted">
          <Wallet className="size-3.5" aria-hidden="true" /> A warning is written to the server log at 80% of the monthly AI budget.
        </p>
      </CardBody>
    </Card>
  );
}

const TOPIC_LABEL = Object.fromEntries(TOPICS.map((t) => [t.value, t.label])) as Record<string, string>;

function ContactCard({ messages, open }: { messages: ContactMessage[]; open: number }) {
  const [mark, state] = useMarkContactHandledMutation();
  const toggle = (m: ContactMessage) =>
    mark({ id: m.id, handled: !m.handled })
      .unwrap()
      .then(() => toast.success(m.handled ? 'Moved back to “to answer”' : 'Marked as answered'))
      .catch((e: unknown) => toast.error(getErrorMessage(e)));
  return (
    <Card data-site-contact="">
      <CardHeader title="Contact messages" description={open ? `${open} waiting for an answer. Reply by email, then mark them answered.` : 'Everything has been answered.'} />
      {messages.length === 0 ? (
        <EmptyState icon={Mail} title="No messages yet" description="Messages sent with the Contact button appear here (and in your inbox when email is set up)." compact />
      ) : (
        <ul className="divide-y divide-line">
          {messages.map((m) => (
            <li key={m.id} className={cn('px-4 py-4 sm:px-6', m.handled && 'opacity-70')} data-contact-row={m.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-ink">
                    {m.name}{' '}
                    <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: your message to Niveloft`)}`} className="font-normal text-accent hover:underline">
                      {m.email}
                    </a>
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {TOPIC_LABEL[m.topic] ?? m.topic}, {formatDateTime(m.createdAt)}
                    {m.page ? `, from ${m.page}` : ''}
                    {m.source ? ` · came via ${m.source}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {m.handled && (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" /> Answered
                    </span>
                  )}
                  <Button
                    variant={m.handled ? 'ghost' : 'secondary'}
                    size="sm"
                    leftIcon={m.handled ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                    loading={state.isLoading && state.originalArgs?.id === m.id}
                    onClick={() => void toggle(m)}
                  >
                    {m.handled ? 'Reopen' : 'Mark answered'}
                  </Button>
                </div>
              </div>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{m.message}</p>
              {m.reference && (
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
                  Error reference <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink-2">{m.reference}</code>
                  <CopyButton text={m.reference} what="the reference" iconOnly />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
