'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api, session, type Site, type User } from '@/lib/api';

const REST_AREA = {
  SUN: 'Breaks taken in the open sun',
  SHADE: 'Breaks taken in shade',
  COOLED: 'Breaks taken in a cooled area',
};

export default function SitesPage() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.token()) {
      router.replace('/login');
      return;
    }
    setUser(session.user());
    api
      .sites()
      .then(setSites)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          session.clear();
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not load sites');
      });
  }, [router]);

  function signOut() {
    session.clear();
    router.replace('/login');
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="wordmark">HeatGuard</h1>
          <div className="topbar-spacer" />
          <div className="topbar-meta">
            {user && <span>{user.name}</span>}
            <button className="linkish" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        {error && <p className="error">{error}</p>}
        {!sites && !error && <p className="empty">Loading sites.</p>}
        {sites && sites.length === 0 && <p className="empty">No sites are assigned to you yet.</p>}
        {sites && sites.length > 0 && (
          <ul className="sitelist">
            {sites.map((site) => (
              <li key={site.id}>
                <Link href={`/sites/${site.id}`}>
                  <div className="site-name">{site.name}</div>
                  <div className="site-sub">
                    {site.crews.length} {site.crews.length === 1 ? 'crew' : 'crews'}
                    {'. '}
                    {REST_AREA[site.restArea]}
                    {site.restArea === 'COOLED' && site.restWbgtC !== null ? ` at ${site.restWbgtC} °C WBGT.` : '.'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
