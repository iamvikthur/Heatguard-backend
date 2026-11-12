# HeatGuard web

Supervisor dashboard. Next.js App Router, no UI framework.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

It talks to the backend at `http://localhost:5500`. Override with `NEXT_PUBLIC_API_URL`
in `web/.env.local`. The backend must allow this origin: it reads `WEB_ORIGIN`
(default `http://localhost:3000`).

Sign in with a seeded account, for example `hse@heatguard.test`.

What it shows for each crew:

- The current hour as four quarter-hour blocks, filled for work and hollow for rest.
- Work and rest minutes, the heat value and the limit it is judged against.
- What the site's rest area buys, when it buys anything.
- The next six hours, or the whole shift on a replayed day. Click an hour to read it.
- A "needs check" band for workers who reported symptoms or triggered the emergency path.

The "Replayed day" tab shows the last day replayed through `POST /sites/:id/replay`.
In November the live view is quiet, so the replayed summer day is what to demo.

Not built yet: the worker page (schedule, check-in, consent).
