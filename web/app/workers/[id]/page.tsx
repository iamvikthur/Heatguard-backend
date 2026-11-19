'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { WorkerView } from '@/components/WorkerView';
import { api, session, staffWorkerApi } from '@/lib/api';

/** The worker's page as a supervisor sees it, plus the sign-in link to hand over. */
export default function WorkerPage() {
  const router = useRouter();
  const workerId = String(useParams().id);
  const replay = useSearchParams().get('replay') === 'true';
  const workerApi = useMemo(() => staffWorkerApi(workerId), [workerId]);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setBusy(true);
    setLinkError(null);
    try {
      const issued = await api.issueAccessLink(workerId);
      setLink({ url: issued.url, expiresAt: issued.expiresAt });
      setCopied(false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not issue a link');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setLinkError(null);
    try {
      await api.revokeAccessLink(workerId);
      setLink(null);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Could not revoke the links');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <WorkerView
        api={workerApi}
        replay={replay}
        corner={
          <Link href="/" className="linkish">
            Dashboard
          </Link>
        }
        onUnauthorized={() => {
          session.clear();
          router.replace('/login');
        }}
      />
      <section className="worker accesslink">
        <h2>Sign-in link</h2>
        <p className="worker-sub">
          Hand this to the worker so they can open their own page. Issuing a new link stops the old one working.
          Anyone holding the link is this worker, so send it to them directly.
        </p>
        {linkError && <p className="error">{linkError}</p>}
        {link && (
          <div className="linkbox">
            <code>{link.url}</code>
            <button
              className="button"
              onClick={() => {
                void navigator.clipboard.writeText(link.url);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        <div className="linkactions">
          <button className="button" onClick={issue} disabled={busy}>
            {link ? 'Issue a new link' : 'Issue a link'}
          </button>
          <button className="button" onClick={revoke} disabled={busy}>
            Revoke all links
          </button>
        </div>
      </section>
    </>
  );
}
