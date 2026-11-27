import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getRedirectUrl } from '@/lib/google/auth';
import { send } from '@/lib/messages';
import { DEFAULT_SETTINGS, settingsItem } from '@/lib/storage';
import { useStorageValue } from '@/lib/use-storage';

const INTERVALS = [15, 30, 60, 120, 360];
const MAX_NAME = 100;

export function Options() {
  const settings = useStorageValue(settingsItem);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setName(settings.calendarName);
  }, [settings]);

  const trimmed = name.trim();
  const nameError = !trimmed ? 'Enter a calendar name.' : trimmed.length > MAX_NAME ? `Keep it under ${MAX_NAME} characters.` : null;

  async function update(patch: Partial<typeof DEFAULT_SETTINGS>) {
    await settingsItem.setValue({ ...(settings ?? DEFAULT_SETTINGS), ...patch });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!settings) return null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">Nomad settings</h1>

      <Card>
        <div className="flex flex-col gap-1">
          <CardTitle>Sync frequency</CardTitle>
          <CardDescription>Syncs also run when the browser starts and when you press “Sync now”.</CardDescription>
        </div>
        <Select value={String(settings.intervalMinutes)} onValueChange={(v) => void update({ intervalMinutes: Number(v) })}>
          <SelectTrigger aria-label="Sync frequency" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERVALS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                Every {m < 60 ? `${m} minutes` : m === 60 ? 'hour' : `${m / 60} hours`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      <Card>
        <div className="flex flex-col gap-1">
          <CardTitle>Calendar name</CardTitle>
          <CardDescription>The Google calendar is renamed on the next sync.</CardDescription>
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNameTouched(true);
            if (nameError) return;
            void update({ calendarName: trimmed }).then(() => send({ type: 'sync-now' }));
          }}
        >
          <Label htmlFor="cal-name" className="sr-only">
            Calendar name
          </Label>
          <div className="flex gap-2">
            <Input
              id="cal-name"
              value={name}
              maxLength={MAX_NAME + 20}
              aria-invalid={(nameTouched && !!nameError) || undefined}
              aria-describedby={nameTouched && nameError ? 'cal-name-error' : undefined}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setNameTouched(true)}
            />
            <Button type="submit" disabled={trimmed === settings.calendarName}>
              Save
            </Button>
          </div>
          {nameTouched && nameError && (
            <p id="cal-name-error" className="text-xs text-destructive">
              {nameError}
            </p>
          )}
        </form>
      </Card>

      <Card>
        <div className="flex flex-col gap-1">
          <CardTitle>Developer info</CardTitle>
          <CardDescription>OAuth redirect URI for your Google Cloud client:</CardDescription>
        </div>
        <code className="break-all rounded-md bg-muted p-2 text-xs">{getRedirectUrl()}</code>
      </Card>

      <p aria-live="polite" className="flex h-6 items-center gap-1 text-sm text-success">
        {saved && (
          <>
            <Check className="size-[1em]" aria-hidden /> Saved
          </>
        )}
      </p>
    </main>
  );
}
