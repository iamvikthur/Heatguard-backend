'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  siteTime,
  type CheckInResult,
  type Level,
  type WorkerApi,
  type WorkerToday,
} from '@/lib/api';

const LEVEL_COLOUR: Record<Level, string> = {
  GREEN: 'var(--green)',
  YELLOW: 'var(--yellow)',
  ORANGE: 'var(--orange)',
  RED: 'var(--red)',
};

const OUTCOME: Record<CheckInResult['action'], string> = {
  ESCALATED: 'Emergency raised. Your supervisor has been told to come to you now.',
  URGENT_CHECK: 'Your supervisor has been asked to check on you right away.',
  STRICTER_SCHEDULE: 'Your supervisor will check on you. Your schedule is below.',
  CHECK_REQUESTED: 'Your supervisor has been asked to check on you.',
  NONE: 'Nothing was reported, so your schedule has not changed.',
};

export function WorkerView({
  api,
  replay,
  corner,
  onUnauthorized,
}: {
  api: WorkerApi;
  replay: boolean;
  /** Shown at the top right: a link back for a supervisor, nothing for a worker. */
  corner?: React.ReactNode;
  onUnauthorized?: (message: string) => void;
}) {
  const [data, setData] = useState<WorkerToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taps, setTaps] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.today(replay));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && onUnauthorized) {
        onUnauthorized(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load this page');
    }
    // api is rebuilt on each render by its owner; replay is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(body: { text?: string; taps?: string[] }) {
    setSending(true);
    setError(null);
    try {
      setResult(await api.checkIn({ ...body, replay }));
      setTaps([]);
      setText('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the check-in');
    } finally {
      setSending(false);
    }
  }

  async function toggleConsent(scope: 'CHECKIN' | 'WEARABLE', granted: boolean) {
    try {
      const consents = await api.setConsent(scope, granted);
      setData((current) => (current ? { ...current, consents: consents as WorkerToday['consents'] } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the consent');
    }
  }

  if (!data) {
    return <main className="worker">{error ? <p className="error">{error}</p> : <p className="empty">Loading.</p>}</main>;
  }

  const { worker, schedule, message, consents, symptomOptions } = data;
  const colour = schedule ? LEVEL_COLOUR[schedule.level] : 'var(--ink-faint)';
  const labelFor = (name: string) => symptomOptions.find((o) => o.name === name)?.label ?? name;

  return (
    <main className="worker" dir={worker.direction}>
      <header className="worker-head" dir="ltr">
        <div>
          <strong>{worker.pseudonym}</strong>
          <span className="worker-sub">
            {worker.crewName}, {worker.siteName}
          </span>
        </div>
        {corner}
      </header>

      {error && <p className="error">{error}</p>}

      <section className="worker-now" style={{ borderColor: colour }}>
        {schedule ? (
          <>
            <p className="worker-level" style={{ background: colour }}>
              {schedule.level}
            </p>
            <p className="worker-minutes" dir="ltr">
              {schedule.workMin} <span>min work</span> &nbsp; {schedule.restMin} <span>min rest</span>
            </p>
            <p className="worker-when" dir="ltr">
              For the hour from {siteTime(schedule.validAt, worker.timezone)}
              {schedule.isOwn ? '. This is your own schedule, not the crew’s.' : '.'}
            </p>
          </>
        ) : (
          <p className="worker-when">No schedule yet. You are assessed during your shift.</p>
        )}
      </section>

      {message && (
        <section className="worker-message" dir={worker.direction}>
          {message.body}
        </section>
      )}

      {result && (
        <section className="worker-result">
          <p>{OUTCOME[result.action]}</p>
          {result.reported.length > 0 && (
            <p className="worker-sub">Understood: {result.reported.map(labelFor).join(', ')}</p>
          )}
          {result.needsTapCheckin && <p className="worker-sub">That could not be read. Tap below instead.</p>}
        </section>
      )}

      <section className="checkin">
        <h2 dir="ltr">How do you feel?</h2>
        {!consents.CHECKIN && <p className="worker-sub">Check-ins are off. Turn them on below to send one.</p>}
        <div className="taps">
          {symptomOptions.map((option) => (
            <button
              key={option.name}
              type="button"
              className="tap"
              aria-pressed={taps.includes(option.name)}
              disabled={!consents.CHECKIN}
              onClick={() =>
                setTaps((current) =>
                  current.includes(option.name) ? current.filter((n) => n !== option.name) : [...current, option.name],
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="submit"
          disabled={sending || taps.length === 0 || !consents.CHECKIN}
          onClick={() => send({ taps })}
        >
          {sending ? 'Sending' : 'Send'}
        </button>

        <p className="or" dir="ltr">or say it in your own words</p>
        <textarea
          rows={3}
          value={text}
          disabled={!consents.CHECKIN}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type here"
        />
        <button
          className="submit"
          disabled={sending || text.trim().length === 0 || !consents.CHECKIN}
          onClick={() => send({ text })}
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </section>

      <section className="consents" dir="ltr">
        <h2>What you agreed to</h2>
        {(['CHECKIN', 'WEARABLE'] as const).map((scope) => (
          <label key={scope} className="consent-row">
            <input
              type="checkbox"
              checked={consents[scope]}
              onChange={(e) => void toggleConsent(scope, e.target.checked)}
            />
            <span>
              {scope === 'CHECKIN' ? 'Share how I feel with my supervisor' : 'Share heart rate from a wearable'}
            </span>
          </label>
        ))}
        <p className="worker-sub">
          You can turn these off at any time. Supervisors see that you need checking, never which symptoms you
          reported.
        </p>
      </section>
    </main>
  );
}
