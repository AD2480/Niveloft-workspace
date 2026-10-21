import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PublicPage } from '@/components/layout/PublicFrame';
import { ANALYTICS, ANALYTICS_CONFIGURED, CONTACT_EMAIL, OPERATOR_NAME, TURNSTILE_SITE_KEY } from '@/config';
import { openCookieSettings } from '@/features/consent/consent';
import { usePageMeta } from '@/lib/pageMeta';

/** When the policy and terms last changed. Update it with every change to either page. */
export const LEGAL_UPDATED = '21 October 2026';

const WRAP = 'mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-10';

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

function Contact() {
  return CONTACT_EMAIL ? (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
      {CONTACT_EMAIL}
    </a>
  ) : (
    <span>the contact address the operator gave you (this copy hasn’t published one on this page yet)</span>
  );
}

/** A long legal text: title, date, contents on the side (wide screens), numbered sections. */
function LegalDocument({ title, intro, sections }: { title: string; intro: ReactNode; sections: Section[] }) {
  return (
    <PublicPage>
      <div className={WRAP}>
        <header className="border-b border-line py-12 lg:py-16">
          <h1 className="display-wide text-[40px] leading-[1.05] text-ink sm:text-[52px]">{title}</h1>
          <p className="mt-4 text-[13px] text-muted">Last updated {LEGAL_UPDATED}</p>
          <div className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-2">{intro}</div>
        </header>
        <div className="grid gap-10 py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16 lg:py-16">
          <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
            <p className="caps text-muted">On this page</p>
            <ol className="mt-2 space-y-0.5 text-[13px]">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex gap-2 py-1 text-ink-2 hover:text-accent">
                    <span className="w-5 shrink-0 font-mono text-[12px] text-muted tabular">{String(i + 1).padStart(2, '0')}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="max-w-2xl space-y-12">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24">
                <h2 id={`${s.id}-title`} className="flex items-baseline gap-3 display-wide text-[24px] text-ink">
                  <span className="font-mono text-[12px] text-muted tabular">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </h2>
                <div className="legal-prose mt-4 space-y-3 text-[14px] leading-relaxed text-ink-2">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </PublicPage>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function PrivacyPage() {
  usePageMeta({ title: 'Privacy policy', path: '/privacy' });
  const analyticsLine = ANALYTICS_CONFIGURED
    ? [
        ANALYTICS.vercel && 'Vercel Web Analytics, which sets no cookies and counts visits in aggregate',
        ANALYTICS.ga4 && 'Google Analytics 4, which sets cookies (_ga and _ga_…) to recognise a returning browser; advertising features are turned off',
      ]
        .filter(Boolean)
        .join('; and ')
    : null;

  const sections: Section[] = [
    {
      id: 'who',
      title: 'Who is responsible',
      body: (
        <p>
          Niveloft is project-management software. This copy of it is run by {OPERATOR_NAME} (“we”), who decide how your information is used here. You can
          download a copy of your information or delete your account yourself, in Settings → Data and privacy. For anything else about your information, contact{' '}
          <Contact />.
        </p>
      ),
    },
    {
      id: 'collect',
      title: 'What we collect',
      body: (
        <List
          items={[
            <>
              <strong className="font-medium text-ink">Your account:</strong> your name, email address, optional job title and avatar colour, when you accepted these
              terms and whether you confirmed your email. Your password is stored only as a one-way BCrypt hash; nobody can read it.
            </>,
            <>
              <strong className="font-medium text-ink">What you and your team put in:</strong> projects, tasks, acceptance criteria, checklists, comments, evidence
              links and uploaded files, submissions, reviews, milestones, dependencies, invitations, notifications, and project documents (specifications, notes,
              decisions), which are kept split into passages under their headings so they can be searched.
            </>,
            <>
              <strong className="font-medium text-ink">Corrections to Flurry:</strong> if you mark one of Flurry’s answers right or wrong, we keep your verdict, the
              kinds of mistake you chose, the right answer if you wrote one, your question, the answer, the model and what it looked up. The project’s owners and
              managers see these, without your name, to fix what goes wrong repeatedly. Your ratings are in your copy of your data, and stop being linked to you if you delete your account.
            </>,
            <>
              <strong className="font-medium text-ink">How the delivery tools are used:</strong> counts of steps on a project’s Delivery page (a blocker looked at,
              a response previewed or confirmed), as words from a fixed list. Not who did it, which task, or anything written.
            </>,
            <>
              <strong className="font-medium text-ink">A history of changes:</strong> who changed a task’s status or reviewed it, and when. The history graph and 3D
              model are built from it.
            </>,
            <>
              <strong className="font-medium text-ink">Sign-in security:</strong> when you sign in, your IP address and a short device description (such as “Chrome on
              macOS”) go into a sign-in alert email to you. To limit repeated attempts, the server also counts recent attempts for up to three hours, filed under a
              one-way scramble (hash) of the address rather than the address itself. Our hosting providers keep standard server logs, which include IP addresses.
            </>,
            <>
              <strong className="font-medium text-ink">Error reports:</strong> if the app crashes in your browser, it sends the error message, the page address
              (without anything after “?”) and your browser’s name to the server log, so it can be fixed. Nothing you typed is included.
            </>,
            <>
              <strong className="font-medium text-ink">Messages you send us:</strong> with the Contact button, your name, email address, the topic, your message,
              the page you wrote it from and, if you included one, an error reference. Only the people who run this site can read them.
            </>,
            <>
              <strong className="font-medium text-ink">Where you came from (UTM tags):</strong> if you arrived through a link with campaign tags (such as
              utm_source=newsletter) or from another website, those tags and that site’s name are kept for your visit and saved with a new account or a message,
              so we can see which campaigns bring people. They’re taken out of the address bar straight away, and kept in your browser only if you agree to
              analytics.
            </>,
            <>
              <strong className="font-medium text-ink">Form counts:</strong> how often each form is opened, sent, accepted or refused, added up per day. These are
              only numbers: nothing you typed, and nothing that identifies you.
            </>,
            <>
              <strong className="font-medium text-ink">Arena votes:</strong> which of two answer sources you preferred, in which project. Not your question, and
              not the answers.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'use',
      title: 'Why we use it',
      body: (
        <>
          <List
            items={[
              'To run the service you signed up for: your account, your projects, and showing your work to the members of your projects.',
              'To keep accounts safe: confirming email addresses, sign-in alerts, password resets, and limits on repeated attempts.',
              'To send the emails the service needs: confirming your address, sign-in alerts, password reset links and “your password was changed”. We don’t send marketing email.',
              'To answer your messages, to see which forms fail so they can be fixed, and to see which campaigns and sites bring people.',
              ANALYTICS_CONFIGURED ? 'To understand which pages are used, but only if you agree to analytics.' : 'We don’t use analytics on this copy.',
            ]}
          />
          <p>We don’t sell your information, show advertising, or use your content to train AI models.</p>
          <p>
            A project’s owners and managers can download its task history to test a better deadline forecast: dates, estimates, priorities and counts, with
            people shown as p1, p2 and so on. It holds no titles, descriptions, comments or names. If this copy runs a trained forecast model on trial, the server
            records its forecast and Niveloft’s for each task in progress, and how long the work took: numbers only.
          </p>
        </>
      ),
    },
    {
      id: 'cookies',
      title: 'Cookies and browser storage',
      body: (
        <>
          <p>
            <strong className="font-medium text-ink">Essential, always on:</strong> your browser’s storage keeps your sign-in for this tab only, your theme and view
            settings, assistant voice settings, and your cookie choice. If you tick “Keep me signed in”, our server also sets one cookie (niveloft-session) that keeps
            you signed in on this browser until you sign out or it expires; pages can’t read it, and it’s only ever sent back to our server. These don’t track you and
            aren’t shared.
          </p>
          <p>
            <strong className="font-medium text-ink">Analytics, only if you agree:</strong>{' '}
            {analyticsLine ? `${analyticsLine}. Addresses are shortened first, so project and task numbers and one-time links never reach them.` : 'this copy doesn’t use any.'}
          </p>
          <p>
            <button type="button" onClick={openCookieSettings} className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
              Open cookie settings
            </button>{' '}
            to change your choice at any time.
          </p>
        </>
      ),
    },
    {
      id: 'share',
      title: 'Who can see it',
      body: (
        <>
          <p>
            <strong className="font-medium text-ink">People in your projects</strong> see what their role allows (owner, manager, member or viewer). Evidence can
            only be opened by members of that project. People outside a project see nothing of it.
          </p>
          <p>
            <strong className="font-medium text-ink">Service providers</strong> process information for us, only to provide their service:
          </p>
          <List
            items={[
              'the hosts of this website, the server and the database (for example Vercel, Railway or Render, depending on how this copy is set up);',
              'our email provider (Resend), for the account emails listed above;',
              ...(TURNSTILE_SITE_KEY ? ['Cloudflare Turnstile, which checks that a person, not a bot, is filling in the sign-up and email-link forms;'] : []),
              'the AI provider this copy is set up with (for example Groq, Google or Anthropic; none when it uses a model on its own server), only if AI assistance is switched on: a question you ask, and the project records it needs (including passages of the project’s approved documents, never drafts), are sent to generate an answer. AI is never used unless you ask it something, and you can stop an answer while it’s being written;',
              'ElevenLabs, only if this copy reads answers aloud in a natural voice and you turn on Read answers aloud: the text of each answer is sent to turn it into speech;',
              ...(ANALYTICS_CONFIGURED ? ['the analytics services named above, only if you agree.'] : []),
            ]}
          />
          <p>
            Voice input uses your browser’s own speech recognition. Your browser’s maker (for example Google for Chrome, or Apple for Safari) may process the audio to
            turn it into text; Niveloft only receives the text.
          </p>
          <p>We may disclose information if the law requires it.</p>
        </>
      ),
    },
    {
      id: 'keep',
      title: 'How long we keep it',
      body: (
        <List
          items={[
            'Your account and your projects are kept until you delete your account (Settings → Data and privacy), or the project owner deletes a project. When you delete your account, your name, email address, password, sign-ins and notifications are removed straight away, along with projects you own alone. What you wrote in projects shared with others (comments, submissions, reviews) stays there, shown as by “Deleted user”, so the team’s record stays whole.',
            'Sign-ins (the device, a shortened network address such as 203.0.113.0/24, and when you signed in and last used it) are kept while they’re active and for 30 days after they end.',
            'The audit log of sensitive actions (sign-ins, password changes, membership and role changes, exports, account deletion, and Flurry requests without their text) is kept for at least 180 days and at most the period the operator sets, then deleted.',
            'Messages sent with the Contact button are kept until they’ve been dealt with and you ask us to delete them. Form counts are daily totals with nothing personal in them.',
            'Corrections to Flurry’s answers and the Delivery page’s step counts are kept for 180 days, then deleted. A project document and its passages are deleted together; forecast trial records go with their task or project.',
            'Links sent by email expire after 24 hours (confirming your address) or 1 hour (resetting your password), and their records are deleted a week after they expire.',
            'Counts of sign-in and other attempts are kept for at most three hours, under a one-way hash of the address or account, never the address itself.',
            'The “Keep me signed in” cookie lasts as long as that sign-in (14 days at most) and is removed when you sign out.',
            'Server logs are kept by our hosting providers under their own retention periods. Backups are kept for a limited period and expire on their own; if one is ever restored, deletions made since are applied again.',
          ]}
        />
      ),
    },
    {
      id: 'security',
      title: 'How we protect it',
      body: (
        <List
          items={[
            'Connections use HTTPS.',
            'Passwords are stored as BCrypt hashes, and links sent by email are stored as SHA-256 hashes.',
            'Every request is checked against your role in the project, on the server.',
            'You get an email each time your account is signed in to (on an unusually busy day these alerts can pause, so that confirmation and password-reset emails still go out). A password reset signs you out everywhere.',
            'Repeated sign-in and sign-up attempts are limited.',
          ]}
        />
      ),
    },
    {
      id: 'rights',
      title: 'Your choices and rights',
      body: (
        <>
          <p>
            You can change your name, job title and password in <Link to="/settings" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">Settings</Link>, and your
            cookie choice at any time. Depending on where you live (for example under the GDPR in the EU and UK, or India’s Digital Personal Data Protection Act,
            2023), you may also have the right to ask for a copy of your information, to have it corrected or deleted, to object to some uses, and to complain to a
            data-protection authority.
          </p>
          <p>
            Download a copy of your information, end your sign-ins on other devices, or delete your account yourself in Settings. For the other rights, contact{' '}
            <Contact />. We’ll reply within 30 days. Content you added to a shared project stays visible to its other members where it’s part of their work (for
            example a review decision); when you delete your account it’s no longer linked to your name.
          </p>
        </>
      ),
    },
    {
      id: 'age',
      title: 'Age',
      body: (
        <p>
          Niveloft is for people aged 18 or over, and you confirm that you are when you create an account. It isn’t designed for children, and we don’t knowingly
          hold information about anyone under 18; if you think we do, contact <Contact /> and we’ll delete it.
        </p>
      ),
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: (
        <p>
          If we change this policy, we’ll update the date at the top. For significant changes we’ll tell account holders by email or in the app before they apply.
          The <Link to="/terms" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">terms and conditions</Link> explain the rules for using the service.
        </p>
      ),
    },
  ];

  return (
    <LegalDocument
      title="Privacy policy"
      intro={<p>What Niveloft collects, why, who can see it, how long it’s kept, and how to see, change or delete your information. In plain language.</p>}
      sections={sections}
    />
  );
}

export function TermsPage() {
  usePageMeta({ title: 'Terms and conditions', path: '/terms' });
  const sections: Section[] = [
    {
      id: 'agreement',
      title: 'The agreement',
      body: (
        <p>
          These terms are an agreement between you and {OPERATOR_NAME} (“we”), who run this copy of Niveloft. By creating an account or using the service you
          accept them, and the <Link to="/privacy" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">privacy policy</Link>. If you use Niveloft for an
          organisation, you confirm you may accept these terms for it.
        </p>
      ),
    },
    {
      id: 'service',
      title: 'The service',
      body: (
        <>
          <p>
            Niveloft is a free project and task manager. It started as a student capstone project, and it’s provided as it is: we work to keep it running and
            correct, but we can’t promise it will always be available, fast or free of errors, and features may change or end.
          </p>
          <p>Keep your own copies of anything important. We don’t promise backups.</p>
        </>
      ),
    },
    {
      id: 'account',
      title: 'Your account',
      body: (
        <List
          items={[
            'Give your real name and an email address you can receive mail at, and confirm it when asked.',
            'One account per person. Keep your password to yourself; you’re responsible for what happens under your account.',
            'Tell us straight away if you think someone else has used your account. A password reset signs out every device.',
            'You must be 18 or over.',
          ]}
        />
      ),
    },
    {
      id: 'content',
      title: 'Your content',
      body: (
        <>
          <p>
            You keep ownership of what you put into Niveloft. You give us permission to store it, process it and show it to the members of your projects,
            only as needed to run the service.
          </p>
          <p>
            Only upload what you have the right to share. Don’t upload other people’s personal information unless you’re allowed to, and don’t use Niveloft for
            health, financial or other sensitive records it wasn’t built to protect.
          </p>
        </>
      ),
    },
    {
      id: 'use',
      title: 'Acceptable use',
      body: (
        <>
          <p>Don’t use Niveloft to:</p>
          <List
            items={[
              'break the law, or infringe anyone’s rights;',
              'harass, threaten or deceive people;',
              'upload malware, or content meant to harm people or computers;',
              'get around the permission checks or the review workflow, access accounts or projects that aren’t yours, or probe the service for weaknesses without our written permission;',
              'create accounts automatically, send spam, or overload the service (including scraping).',
            ]}
          />
          <p>If you find a security problem, please tell us privately at <Contact />.</p>
        </>
      ),
    },
    {
      id: 'ai',
      title: 'AI answers and forecasts',
      body: (
        <p>
          Forecasts are estimates from your records, and AI answers (when this copy offers them) can be wrong. Both are labelled as such. Check them before you
          rely on them. AI never changes anything by itself: every suggested change waits for a person to confirm it.
        </p>
      ),
    },
    {
      id: 'ending',
      title: 'Ending your use',
      body: (
        <p>
          You can stop using Niveloft at any time and ask us to delete your account at <Contact />. We may suspend or close accounts that break these terms or
          put other people or the service at risk; where we can, we’ll tell you first and let you take a copy of your content.
        </p>
      ),
    },
    {
      id: 'liability',
      title: 'Liability',
      body: (
        <p>
          As far as the law allows, we aren’t liable for indirect or consequential losses, lost data or lost profits from using Niveloft, and because the service
          is free, our total liability to you is limited to the amount you paid us in the last 12 months (which is nothing). Nothing in these terms limits
          liability that the law doesn’t allow to be limited, or your rights as a consumer.
        </p>
      ),
    },
    {
      id: 'changes',
      title: 'Changes and contact',
      body: (
        <p>
          We may update these terms; the date at the top shows the latest version. For significant changes we’ll tell account holders before they apply, and if
          you keep using Niveloft afterwards, the new terms apply. These terms are governed by the laws of the place where the operator is based. Questions:{' '}
          <Contact />.
        </p>
      ),
    },
  ];
  return (
    <LegalDocument
      title="Terms and conditions"
      intro={<p>The rules for using Niveloft: your account, your content, what isn’t allowed, and the limits of a free service.</p>}
      sections={sections}
    />
  );
}
