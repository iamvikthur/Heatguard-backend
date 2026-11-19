'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { WorkerView } from '@/components/WorkerView';
import { selfWorkerApi } from '@/lib/api';

/**
 * A worker's own page, opened from the sign-in link their supervisor issued.
 * The link itself is the credential, so nothing is stored in the browser.
 */
export default function WorkerLinkPage() {
  const token = String(useParams().token);
  const replay = useSearchParams().get('replay') === 'true';
  const api = useMemo(() => selfWorkerApi(token), [token]);
  const [expired, setExpired] = useState<string | null>(null);

  if (expired) {
    return (
      <main className="worker">
        <section className="worker-now" style={{ borderColor: 'var(--red)' }}>
          <p className="worker-when">{expired}</p>
        </section>
      </main>
    );
  }

  return <WorkerView api={api} replay={replay} onUnauthorized={setExpired} />;
}
