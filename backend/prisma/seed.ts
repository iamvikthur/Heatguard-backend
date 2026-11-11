// Demo data: 1 organisation, 2 sites, 3 crews, 45 pseudonymous workers.
// Dev only: wipes the tables it seeds. Run with `bun run db:seed`.
import 'dotenv/config';
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Format: scrypt:<salt hex>:<hash hex>. The auth module must verify the same way.
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const DAY = 24 * 60 * 60 * 1000;
const LANGUAGES = ['hi', 'ur', 'bn', 'ml', 'ar', 'en'];

async function main() {
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) {
    throw new Error('Set SEED_PASSWORD in .env before seeding (demo user password).');
  }

  // Children go with their parents through onDelete: Cascade.
  await prisma.auditLog.deleteMany();
  await prisma.organization.deleteMany();

  const org = await prisma.organization.create({
    data: { name: 'Demo Contracting LLC' },
  });

  // Metabolic rates: OSHA workload table. Clothing adjustment 0 = ordinary
  // work clothing (NIOSH 2016-106 Table 3-2). See docs/risk-model.md.
  const taskDefs = [
    { name: 'Light: inspection, signalling', metabolicWatts: 180, clothingAdjC: 0 },
    { name: 'Moderate: formwork, scaffolding', metabolicWatts: 300, clothingAdjC: 0 },
    { name: 'Heavy: rebar tying, manual lifting', metabolicWatts: 415, clothingAdjC: 0 },
    { name: 'Very heavy: shovelling, concrete pour', metabolicWatts: 520, clothingAdjC: 0 },
  ];
  const tasks = [];
  for (const t of taskDefs) {
    tasks.push(await prisma.taskType.create({ data: { ...t, orgId: org.id } }));
  }

  const passwordHash = hashPassword(seedPassword);
  const userDefs = [
    { email: 'supervisor.a@heatguard.test', name: 'Supervisor A', role: 'SUPERVISOR' as const },
    { email: 'supervisor.b@heatguard.test', name: 'Supervisor B', role: 'SUPERVISOR' as const },
    { email: 'supervisor.c@heatguard.test', name: 'Supervisor C', role: 'SUPERVISOR' as const },
    { email: 'hse@heatguard.test', name: 'HSE Manager', role: 'HSE' as const },
    { email: 'admin@heatguard.test', name: 'Admin', role: 'ADMIN' as const },
  ];
  const users = [];
  for (const u of userDefs) {
    users.push(await prisma.user.create({ data: { ...u, orgId: org.id, passwordHash } }));
  }

  // Approximate coordinates for two Abu Dhabi industrial areas.
  // Rest area: a cooled cabin. 22 C WBGT is an assumed demo value, not a
  // measurement; a real site must measure its own rest area.
  const restArea = { restArea: 'COOLED' as const, restWbgtC: 22 };
  const mussafah = await prisma.site.create({
    data: { orgId: org.id, name: 'Mussafah Industrial Yard', latitude: 24.35, longitude: 54.5, timezone: 'Asia/Dubai', ...restArea },
  });
  const kizad = await prisma.site.create({
    data: { orgId: org.id, name: 'KIZAD Logistics Build', latitude: 24.72, longitude: 54.72, timezone: 'Asia/Dubai', ...restArea },
  });

  const crewDefs = [
    { name: 'Crew A (rebar)', site: mussafah, supervisor: users[0], task: tasks[2] },
    { name: 'Crew B (formwork)', site: mussafah, supervisor: users[1], task: tasks[1] },
    { name: 'Crew C (concrete)', site: kizad, supervisor: users[2], task: tasks[3] },
  ];

  const now = Date.now();
  const today = new Date(now);
  let n = 0;

  for (const def of crewDefs) {
    const crew = await prisma.crew.create({
      data: { name: def.name, siteId: def.site.id, supervisorId: def.supervisor.id },
    });

    // 15 workers per crew; every fifth one arrived in the last week (unacclimatized).
    for (let i = 0; i < 15; i++) {
      n += 1;
      const newArrival = i % 5 === 4;
      const worker = await prisma.worker.create({
        data: {
          crewId: crew.id,
          pseudonym: `W-${String(n).padStart(3, '0')}`,
          language: LANGUAGES[n % LANGUAGES.length],
          acclimatizedFrom: new Date(now - (newArrival ? 4 : 60) * DAY),
        },
      });
      // Everyone consents to check-ins; two in three also to the wearable.
      await prisma.consent.create({ data: { workerId: worker.id, scope: 'CHECKIN' } });
      if (i % 3 !== 0) {
        await prisma.consent.create({ data: { workerId: worker.id, scope: 'WEARABLE' } });
      }
    }

    // 06:00-14:00 Gulf time (UTC+4) for the next 7 days.
    for (let d = 0; d < 7; d++) {
      const startsAt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + d, 2, 0));
      await prisma.shift.create({
        data: { crewId: crew.id, taskTypeId: def.task.id, startsAt, endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1000) },
      });
    }
  }

  console.log(`Seeded: 1 org, 2 sites, ${crewDefs.length} crews, ${n} workers, ${users.length} users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
