import { zodResolver } from '@hookform/resolvers/zod';
import { Database, KeyRound, Monitor, Moon, Palette, Sparkles, Sun, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { useChangePasswordMutation, useUpdateProfileMutation } from '@/api/endpoints';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { themeChanged, type ThemePreference } from '@/app/uiSlice';
import { PageContainer } from '@/components/layout/AppShell';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Field, FormError, Input } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { ErrorSummary, PasswordRules, SavedNote } from '@/components/ui/FormStates';
import { tokenRefreshed, userUpdated } from '@/features/auth/authSlice';
import { openCookieSettings } from '@/features/consent/consent';
import { SessionsCard, YourDataCard } from '@/features/account/AccountSections';
import { FlurryFigure } from '@/features/flurry/FlurryFigure';
import { CORNER_LABEL } from '@/features/flurry/FlurryCompanion';
import { FLURRY_CORNERS, FLURRY_MODES, FLURRY_MOTIONS, FLURRY_SIZES, flurryPx, isStill, useFlurryPrefs } from '@/features/flurry/flurryPrefs';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';
import { applyServerErrors, rules } from '@/lib/forms';
import { useDocumentTitle, useMediaQuery, useUrlState } from '@/lib/hooks';
import { useAtmosphere } from '@/components/layout/AppAtmosphere';
import { useTrackedForm } from '@/lib/useTrackedForm';

const profileSchema = z.object({
  name: rules.name,
  jobTitle: z.string().trim().max(80, 'Job title must be at most 80 characters.'),
  avatarColor: z.string(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: rules.password,
    confirmPassword: z.string().min(1, 'Please confirm the new password.'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

function ProfileSection() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user)!;
  const [update, { isLoading }] = useUpdateProfileMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const track = useTrackedForm('profile');
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    watch,
    formState: { errors, isDirty },
  } = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name, jobTitle: user.jobTitle ?? '', avatarColor: user.avatarColor },
  });
  const preview = { name: watch('name') || user.name, avatarColor: watch('avatarColor') };

  return (
    <Card>
      <CardHeader title="Profile" description="How teammates see you across Niveloft." />
      <CardBody>
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit(
            async (v) => {
              setFormError(null);
              setSavedAt(null); // a "Saved" note never outlives a later attempt that fails
              track.submitted();
              try {
                const saved = await update({ name: v.name, jobTitle: v.jobTitle || null, avatarColor: v.avatarColor }).unwrap();
                track.succeeded();
                dispatch(userUpdated(saved));
                reset({ name: saved.name, jobTitle: saved.jobTitle ?? '', avatarColor: saved.avatarColor });
                setSavedAt(Date.now());
                toast.success('Profile updated');
              } catch (e) {
                track.failed(e);
                setFormError(applyServerErrors(e, setError, ['name', 'jobTitle', 'avatarColor']));
              }
            },
            () => track.invalid(),
          )}
        >
          <FormError message={formError} />
          <div className="flex items-center gap-4">
            <Avatar user={preview} size="xl" />
            <div className="text-[13px]">
              <p className="font-medium text-ink">{user.email}</p>
              <p className="text-xs text-muted">Member since {formatDate(user.createdAt.slice(0, 10), 'MMMM yyyy')}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={errors.name?.message} required>
              {(p) => <Input {...p} {...register('name')} autoComplete="name" />}
            </Field>
            <Field label="Job title" error={errors.jobTitle?.message} hint="Optional, e.g. Frontend Developer">
              {(p) => <Input {...p} {...register('jobTitle')} />}
            </Field>
          </div>
          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-ink-2">Avatar colour</span>
            <Controller control={control} name="avatarColor" render={({ field }) => <ColorPicker label="Avatar colour" value={field.value} onChange={field.onChange} />} />
          </div>
          <div className="flex items-center justify-end gap-3">
            <SavedNote at={savedAt} label="Profile saved" />
            <Button type="submit" loading={isLoading} disabled={!isDirty}>
              Save profile
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function SecuritySection() {
  const dispatch = useAppDispatch();
  const [change, { isLoading }] = useChangePasswordMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const track = useTrackedForm('password');
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, submitCount },
  } = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });
  const newPassword = watch('newPassword');
  const confirmPassword = watch('confirmPassword');

  return (
    <Card>
      <CardHeader title="Password" description="At least 8 characters with a letter and a number, and not a common password. A phrase of unrelated words works well." />
      <CardBody>
        <form
          className="max-w-md space-y-4"
          noValidate
          onSubmit={handleSubmit(
            async (v) => {
              setFormError(null);
              setSavedAt(null); // a "Saved" note never outlives a later attempt that fails
              track.submitted();
              try {
                const res = await change({ currentPassword: v.currentPassword, newPassword: v.newPassword }).unwrap();
                track.succeeded();
                // The server signed out every other device; this one continues with a new session.
                if (res?.token) dispatch(tokenRefreshed({ token: res.token, user: res.user }));
                reset();
                setSavedAt(Date.now());
                toast.success('Password changed. Other devices were signed out.');
              } catch (e) {
                track.failed(e);
                setFormError(applyServerErrors(e, setError, ['currentPassword', 'newPassword']));
              }
            },
            () => track.invalid(),
          )}
        >
          <FormError message={formError} />
          <ErrorSummary
            errors={errors}
            labels={{ currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password' }}
            attempts={submitCount}
          />
          <Field label="Current password" error={errors.currentPassword?.message} required>
            {(p) => <PasswordInput {...p} {...register('currentPassword')} autoComplete="current-password" />}
          </Field>
          <Field label="New password" error={errors.newPassword?.message} required>
            {(p) => <PasswordInput {...p} {...register('newPassword')} autoComplete="new-password" />}
          </Field>
          {newPassword && <PasswordRules password={newPassword} confirm={confirmPassword} className="-mt-1" />}
          <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
            {(p) => <PasswordInput {...p} {...register('confirmPassword')} autoComplete="new-password" />}
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={isLoading}>
              Change password
            </Button>
            <SavedNote at={savedAt} label="Password changed" />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun; text: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, text: 'Bright surfaces' },
  { value: 'dark', label: 'Dark', icon: Moon, text: 'Easy on the eyes' },
  { value: 'system', label: 'System', icon: Monitor, text: 'Follow your device' },
];

function AppearanceSection() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.ui.theme);
  const [snow, setSnow] = useAtmosphere();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <>
    <Card>
      <CardHeader title="Theme" description="Saved on this device." />
      <CardBody>
        <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
          {THEMES.map(({ value, label, icon: Icon, text }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => dispatch(themeChanged(value))}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                theme === value ? 'border-brand/50 bg-brand-soft/50 ring-1 ring-brand/30' : 'border-line hover:bg-surface-2',
              )}
            >
              <Icon className="size-5 text-muted" aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-semibold text-ink">{label}</span>
                <span className="block text-xs text-muted">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
    <Card>
      <CardHeader title="Weather" description="Saved on this device." />
      <CardBody>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-surface-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={snow} onChange={(e) => setSnow(e.target.checked)} data-atmosphere-toggle="" />
          <span>
            <span className="block text-[13px] font-semibold text-ink">Light snowfall behind pages</span>
            <span className="block text-xs text-muted">
              A few flakes falling behind everything, off by default. It never covers content{reduceMotion ? ', and your system reduces motion, so the snow stands still' : ''}.
            </span>
          </span>
        </label>
      </CardBody>
    </Card>
    </>
  );
}

/** Flurry, the assistant: where it stays, how big it is, how much it moves. Per person, on this browser. */
function FlurrySection() {
  const userId = useAppSelector((s) => s.auth.user?.id ?? 0);
  const [prefs, setPrefs] = useFlurryPrefs(userId);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = isStill(prefs, reduceMotion);
  const toggle = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, data?: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-surface-2" data-flurry-setting={data}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
  const choice = 'flex cursor-pointer items-start gap-2 rounded-md border border-line px-2.5 py-2 text-[13px] text-ink hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-brand-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-surface-2';
  return (
    <Card>
      <CardHeader title="Flurry" description="Your AI project assistant. These choices are saved for you on this browser." />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-4 rounded-lg bg-surface-2 p-3">
          <span className="flex size-[76px] shrink-0 items-center justify-center" data-flurry-size-preview={prefs.size}>
            <FlurryFigure style={{ width: flurryPx(prefs.size), height: flurryPx(prefs.size) }} still={still} glow={false} mini={flurryPx(prefs.size) <= 48} />
          </span>
          <p className="text-[13px] leading-relaxed text-ink-2">
            Flurry reads only what you can see, keeps facts and estimates apart, and asks before creating or changing anything. Click it for its menu, drag it anywhere, or press Alt+A (Option+A on a Mac) to ask it something.{' '}
            <Link to="/flurry" className="font-medium text-accent underline-offset-4 hover:underline">
              Meet Flurry
            </Link>
          </p>
        </div>
        <fieldset className="rounded-lg border border-line p-3" data-flurry-setting="mode">
          <legend className="px-1 text-[13px] font-semibold text-ink">Where Flurry stays</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {FLURRY_MODES.map((m) => (
              <label key={m.value} className={choice}>
                <input type="radio" name="flurry-mode" className="mt-0.5 accent-[var(--accent)]" checked={prefs.mode === m.value} onChange={() => setPrefs({ mode: m.value })} />
                <span>
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-xs text-muted">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Flurry moves only inside Niveloft’s window. It can’t roam your desktop or other apps; that would take a separate desktop companion.</p>
        </fieldset>
        <div className="grid gap-3 lg:grid-cols-2">
          <fieldset className="rounded-lg border border-line p-3" data-flurry-setting="size">
            <legend className="px-1 text-[13px] font-semibold text-ink">Size</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {FLURRY_SIZES.map((x) => (
                <label key={x.value} className={choice}>
                  <input type="radio" name="flurry-size" className="mt-0.5 accent-[var(--accent)]" checked={prefs.size === x.value} onChange={() => setPrefs({ size: x.value })} />
                  {x.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">On phones Flurry is always a small button on the bottom edge.</p>
          </fieldset>
          <fieldset className="rounded-lg border border-line p-3" data-flurry-setting="motion">
            <legend className="px-1 text-[13px] font-semibold text-ink">Motion</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {FLURRY_MOTIONS.map((x) => (
                <label key={x.value} className={choice} title={x.hint}>
                  <input
                    type="radio"
                    name="flurry-motion"
                    className="mt-0.5 accent-[var(--accent)]"
                    checked={(reduceMotion ? 'off' : prefs.motion) === x.value}
                    disabled={reduceMotion && x.value !== 'off'}
                    onChange={() => setPrefs({ motion: x.value })}
                  />
                  {x.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {reduceMotion ? 'Your system asks for reduced motion, so Flurry is completely still.' : FLURRY_MOTIONS.find((x) => x.value === prefs.motion)?.hint}
            </p>
          </fieldset>
        </div>
        {toggle(
          'Let Flurry speak up',
          'Off: Flurry’s short notes appear only when you ask (click it, or choose something from its menu). On: when something new needs you, it may show one short note on its own, once.',
          prefs.speakUp,
          (v) => setPrefs({ speakUp: v }),
          'speak-up',
        )}
        {toggle('Sounds', 'A soft chime when Flurry opens, finishes something or hits a problem.', prefs.sounds, (v) => setPrefs({ sounds: v }))}
        {toggle(
          'Pin the conversation beside the page',
          'On large screens the page makes room for it. Otherwise it opens as a small card in Flurry’s corner.',
          prefs.pinned,
          (v) => setPrefs({ pinned: v }),
        )}
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-[13px] font-semibold text-ink">Flurry’s home corner</legend>
          <p className="text-xs text-muted">Where Flurry rests at first, where it naps after a quiet spell, and where the conversation opens as a card.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {FLURRY_CORNERS.map((c) => (
              <label key={c} className={cn(choice, 'items-center')}>
                <input type="radio" name="flurry-corner" className="accent-[var(--accent)]" checked={prefs.corner === c} onChange={() => setPrefs({ corner: c, spot: null })} />
                {CORNER_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
      </CardBody>
    </Card>
  );
}

function DataSection() {
  return (
    <Card>
      <CardHeader title="Privacy and cookies" />
      <CardBody className="text-[13px] text-ink-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Read the{' '}
            <Link to="/privacy" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
              privacy policy
            </Link>{' '}
            and{' '}
            <Link to="/terms" className="text-ink underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-accent">
              terms
            </Link>
            . Download or delete your data under Your data, above.
          </p>
          <Button variant="secondary" onClick={openCookieSettings}>
            Cookie settings
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

const TABS = [
  { value: 'profile', label: 'Profile', icon: UserRound },
  { value: 'security', label: 'Security', icon: KeyRound },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'flurry', label: 'Flurry', icon: Sparkles },
  { value: 'data', label: 'Data and privacy', icon: Database },
] as const;

export function SettingsPage() {
  useDocumentTitle('Settings');
  const [f, setF] = useUrlState({ tab: 'profile' });
  const tab = TABS.some((t) => t.value === f.tab) ? f.tab : 'profile';
  useEffect(() => window.scrollTo({ top: 0 }), [tab]);

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Settings" description="Manage your account and preferences." />
      <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
        <nav aria-label="Settings sections" className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setF({ tab: value })}
              aria-current={tab === value ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                tab === value ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-6">
          {tab === 'profile' && <ProfileSection />}
          {tab === 'security' && (
            <>
              <SecuritySection />
              <SessionsCard />
            </>
          )}
          {tab === 'appearance' && <AppearanceSection />}
          {tab === 'flurry' && <FlurrySection />}
          {tab === 'data' && (
            <>
              <YourDataCard />
              <DataSection />
            </>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
