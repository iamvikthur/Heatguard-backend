'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  api,
  session,
  siteDate,
  siteTime,
  type Level,
  type NeedsCheckEntry,
  type Outlook,
  type OutlookHour,
  type Site,
  type User,
} from '@/lib/api';

const LEVEL_COLOUR: Record<Level, string> = {
  GREEN: 'var(--green)',
  YELLOW: 'var(--yellow)',
  ORANGE: 'var(--orange)',
  RED: 'var(--red)',
};

type Entry = NeedsCheckEntry & { crewName: string };

export default function SitePage() {
  const router = useRouter();
  const siteId = String(useParams().id);
  const [site, setSite] = useState<Site | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  const [checks, setChecks] = useState<Entry[]>([]);
  const [crewWorkers, setCrewWorkers] = useState<Record<string, { id: string; pseudonym: string }[]>>({});
  const [replay, setReplay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(
    async (showReplay: boolean) => {
      setError(null);
      try {
        const sites = await api.sites();
        const found = sites.find((s) => s.id === siteId) ?? null;
        setSite(found);
        if (!found) {
          setError('That site is not available to you.');
          return;
        }
        const [next, queues, rosters] = await Promise.all([
          api.outlook(siteId, showReplay),
          Promise.all(found.crews.map((crew) => api.needsCheck(crew.id).then((rows) => ({ crew, rows })))),
          Promise.all(found.crews.map((crew) => api.crewWorkers(crew.id).then((rows) => [crew.id, rows] as const))),
        ]);
        setOutlook(next);
        setChecks(queues.flatMap(({ crew, rows }) => rows.map((row) => ({ ...row, crewName: crew.name }))));
        setCrewWorkers(Object.fromEntries(rosters));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          session.clear();
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load this site');
      }
    },
    [router, siteId],
  );

  useEffect(() => {
    if (!session.token()) {
      router.replace('/login');
      return;
    }
    setUser(session.user());
    void load(replay);
  }, [load, replay, router]);

  async function runNow() {
    setRunning(true);
    try {
      await api.runSite(siteId);
      await load(replay);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the assessment');
    } finally {
      setRunning(false);
    }
  }

  async function acknowledge(alertId: string) {
    setChecks((rows) => rows.filter((row) => row.id !== alertId));
    try {
      await api.acknowledge(alertId);
    } catch {
      void load(replay);
    }
  }

  const timezone = site?.timezone ?? 'UTC';
  const canRun = user?.role === 'HSE' || user?.role === 'ADMIN';

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="wordmark">
            <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
              HeatGuard
            </Link>
          </h1>
          <p className="topbar-site">{site?.name ?? ''}</p>
          <div className="topbar-spacer" />
          <div className="topbar-meta">
            {user && <span>{user.name}</span>}
            <button
              className="linkish"
              onClick={() => {
                session.clear();
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="shell">
        <div className="controls">
          <div className="segmented" role="group" aria-label="Which day to show">
            <button aria-pressed={!replay} onClick={() => setReplay(false)}>
              Today
            </button>
            <button aria-pressed={replay} onClick={() => setReplay(true)}>
              Replayed day
            </button>
          </div>
          {outlook?.computedAt && (
            <span className="asof">
              {replay && outlook.crews[0]?.hours[0]
                ? `${siteDate(outlook.crews[0].hours[0].validAt, timezone)}, replayed from recorded weather`
                : `Assessed ${siteTime(outlook.computedAt, timezone)} site time`}
            </span>
          )}
          {canRun && !replay && (
            <button className="button" onClick={runNow} disabled={running}>
              {running ? 'Assessing' : 'Assess now'}
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {checks.length > 0 && (
          <section className="needscheck">
            <h2>Needs check ({checks.length})</h2>
            <ul>
              {checks.map((entry) => (
                <li key={entry.id}>
                  <span className="body">
                    {entry.reason === 'RED_FLAG' && <span className="emergency">Emergency. </span>}
                    {entry.body}
                  </span>
                  <button className="button" onClick={() => acknowledge(entry.id)}>
                    I have checked
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outlook && outlook.crews.length === 0 && (
          <p className="empty">
            {replay
              ? 'No replayed day is stored for this site yet.'
              : 'No assessment yet. Crews are assessed every 15 minutes during their shift.'}
          </p>
        )}

        {outlook?.crews.map((crew) => (
          <Crew
            key={crew.crewId}
            name={crew.name}
            hours={crew.hours}
            timezone={timezone}
            replay={replay}
            workers={crewWorkers[crew.crewId] ?? []}
          />
        ))}
      </main>
    </>
  );
}

function Crew({
  name,
  hours,
  timezone,
  replay,
  workers,
}: {
  name: string;
  hours: OutlookHour[];
  timezone: string;
  replay: boolean;
  workers: { id: string; pseudonym: string }[];
}) {
  const [index, setIndex] = useState(0);
  const hour = hours[Math.min(index, hours.length - 1)];
  if (!hour) return null;
  const colour = LEVEL_COLOUR[hour.level];
  const quarters = Math.round(hour.workMin / 15);

  return (
    <section className="crew">
      <div className="crew-head">
        <h2 className="crew-name">{name}</h2>
        <span className={`level-tag level-${hour.level}`}>{hour.level}</span>
        <span className="crew-task">
          {replay || index > 0 ? `at ${siteTime(hour.validAt, timezone)}` : 'now'}
        </span>
      </div>

      <div className="hour" style={{ color: colour }} aria-hidden="true">
        {[0, 1, 2, 3].map((q) => (
          <div key={q} className={`quarter${q < quarters ? ' work' : ''}`} />
        ))}
      </div>

      <div className="hour-read">
        <p className="minutes" style={{ margin: 0 }}>
          {hour.workMin} <span>min work</span>
        </p>
        <p className="minutes" style={{ margin: 0, color: 'var(--ink-soft)' }}>
          {hour.restMin} <span>min rest</span>
        </p>
        <span className="readout">
          Heat {hour.wbgtC.toFixed(1)} °C against a limit of {hour.limitC.toFixed(1)} °C
          {hour.fallback ? '. Using the last stored forecast.' : ''}
        </span>
      </div>

      {hour.workMinRestInSun !== null && hour.workMinRestInSun < hour.workMin && (
        <p className="note">
          The cooled rest area buys {hour.workMin - hour.workMinRestInSun} minutes of work this hour. Resting in
          the open sun would allow {hour.workMinRestInSun === 0 ? 'none' : `only ${hour.workMinRestInSun} minutes`}.
        </p>
      )}
      {hour.workersAtHigherLevel > 0 && (
        <p className="note">
          {hour.workersAtHigherLevel} {hour.workersAtHigherLevel === 1 ? 'worker is' : 'workers are'} on a stricter
          schedule than the rest of the crew.
        </p>
      )}

      {workers.length > 0 && (
        <div className="crew-workers">
          <span className="label">Workers</span>
          {workers.map((worker) => (
            <Link key={worker.id} href={`/workers/${worker.id}${replay ? '?replay=true' : ''}`}>
              {worker.pseudonym}
            </Link>
          ))}
        </div>
      )}

      {hours.length > 1 && (
        <div className="outlook">
          <p className="outlook-label">{replay ? 'Through the shift' : 'Next six hours'}</p>
          <div className="strip">
            {hours.map((h, i) => (
              <button
                key={h.validAt}
                className="strip-hour"
                onClick={() => setIndex(i)}
                aria-pressed={i === index}
                style={{
                  background: 'none',
                  border: 0,
                  padding: '2px',
                  cursor: 'pointer',
                  outline: i === index ? '2px solid var(--ink)' : 'none',
                }}
              >
                <span className="strip-min">{h.workMin}</span>
                <div className="strip-bar">
                  {h.workMin === 0 ? (
                    <div className="strip-fill empty" />
                  ) : (
                    <div
                      className="strip-fill"
                      style={{ height: `${(h.workMin / 60) * 100}%`, color: LEVEL_COLOUR[h.level] }}
                    />
                  )}
                </div>
                <div className="strip-time">{siteTime(h.validAt, timezone)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
