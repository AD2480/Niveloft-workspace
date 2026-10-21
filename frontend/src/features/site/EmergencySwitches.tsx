import { Power } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useOpsSwitchesQuery, useSetOpsSwitchMutation } from '@/api/endpoints';
import { getErrorMessage } from '@/api/errors';
import type { OpsSwitch } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Form';
import { formatDateTime } from '@/lib/dates';

/**
 * The operator's emergency switches: each turns one feature off for everyone at once, without a
 * deploy, and leaves the rest of Niveloft working. Every change is recorded in the audit log.
 */
export function EmergencySwitchesCard() {
  const switches = useOpsSwitchesQuery();
  const [setSwitch, { isLoading }] = useSetOpsSwitchMutation();
  const [turningOff, setTurningOff] = useState<OpsSwitch | null>(null);
  const [reason, setReason] = useState('');

  const flip = async (s: OpsSwitch, enabled: boolean, why?: string) => {
    try {
      await setSwitch({ name: s.name, enabled, reason: why }).unwrap();
      toast.success(enabled ? `Turned back on: ${s.stops}` : `Turned off: ${s.stops}`);
      setTurningOff(null);
      setReason('');
    } catch (e) {
      toast.error(getErrorMessage(e, 'The switch couldn’t be changed. Try again.'));
    }
  };

  return (
    <Card data-emergency-switches="">
      <CardHeader
        title="Emergency switches"
        description="Turn one feature off for everyone at once, without a deploy; everything else keeps working. Each change is recorded in the audit log."
      />
      <CardBody>
        {switches.isError && <p className="text-[13px] text-danger">{getErrorMessage(switches.error, 'The switches couldn’t be loaded.')}</p>}
        <ul className="divide-y divide-line">
          {(switches.data ?? []).map((s) => (
            <li key={s.name} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-switch={s.name}>
              <div className="min-w-0 text-[13px]">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <span className="first-letter:uppercase">{s.stops}</span>
                  <Badge tone={s.enabled ? 'success' : 'danger'}>{s.enabled ? 'On' : 'Off'}</Badge>
                </p>
                {s.changedAt && (
                  <p className="text-xs text-muted">
                    Changed {formatDateTime(s.changedAt)}
                    {s.reason ? `: ${s.reason}` : ''}
                  </p>
                )}
              </div>
              <Button variant={s.enabled ? 'secondary' : 'primary'} size="sm" leftIcon={<Power />} onClick={() => (s.enabled ? setTurningOff(s) : void flip(s, true))} loading={isLoading && turningOff?.name === s.name}>
                {s.enabled ? 'Turn off' : 'Turn back on'}
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
      <Dialog
        open={turningOff !== null}
        onOpenChange={(o) => !o && setTurningOff(null)}
        title={turningOff ? `Turn off ${turningOff.stops}?` : 'Turn off?'}
        description="It stops for everyone within a few seconds, until you turn it back on here. Say why, for the audit log and whoever reads it next."
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTurningOff(null)}>
              Keep it on
            </Button>
            <Button variant="danger" loading={isLoading} disabled={reason.trim().length < 3} onClick={() => turningOff && void flip(turningOff, false, reason.trim())}>
              Turn off
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. AI spending spike, investigating" />}
        </Field>
      </Dialog>
    </Card>
  );
}
