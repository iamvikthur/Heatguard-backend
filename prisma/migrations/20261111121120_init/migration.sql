-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERVISOR', 'HSE', 'ADMIN');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('GREEN', 'YELLOW', 'ORANGE', 'RED');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('CHECKIN', 'WEARABLE');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('APP', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "Extractor" AS ENUM ('LLM', 'KEYWORD', 'TAP');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "WeatherSource" AS ENUM ('FORECAST', 'OBSERVED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supervisorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "phone" TEXT,
    "acclimatizedFrom" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metabolicWatts" INTEGER NOT NULL,
    "clothingAdjC" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "source" "WeatherSource" NOT NULL,
    "validAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "humidityPct" DOUBLE PRECISION NOT NULL,
    "windMs" DOUBLE PRECISION NOT NULL,
    "radiationWm2" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "WeatherSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validAt" TIMESTAMP(3) NOT NULL,
    "horizonMin" INTEGER NOT NULL DEFAULT 0,
    "wbgtRaw" DOUBLE PRECISION NOT NULL,
    "wbgtCorrected" DOUBLE PRECISION,
    "wbgtEffective" DOUBLE PRECISION NOT NULL,
    "limitC" DOUBLE PRECISION NOT NULL,
    "level" "Level" NOT NULL,
    "workMin" INTEGER NOT NULL,
    "restMin" INTEGER NOT NULL,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "modelVersion" TEXT,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerRisk" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "reasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "language" TEXT NOT NULL,
    "transcript" TEXT,
    "symptoms" JSONB NOT NULL,
    "redFlag" BOOLEAN NOT NULL DEFAULT false,
    "extractor" "Extractor" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "workerId" TEXT,
    "crewId" TEXT,
    "level" "Level" NOT NULL,
    "action" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "language" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "ackAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearableSample" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "heartRate" INTEGER NOT NULL,

    CONSTRAINT "WearableSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_orgId_idx" ON "Site"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE INDEX "Crew_siteId_idx" ON "Crew"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_pseudonym_key" ON "Worker"("pseudonym");

-- CreateIndex
CREATE INDEX "Worker_crewId_idx" ON "Worker"("crewId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_orgId_name_key" ON "TaskType"("orgId", "name");

-- CreateIndex
CREATE INDEX "Shift_crewId_startsAt_idx" ON "Shift"("crewId", "startsAt");

-- CreateIndex
CREATE INDEX "Consent_workerId_scope_idx" ON "Consent"("workerId", "scope");

-- CreateIndex
CREATE INDEX "WeatherSnapshot_siteId_validAt_idx" ON "WeatherSnapshot"("siteId", "validAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherSnapshot_siteId_source_validAt_issuedAt_key" ON "WeatherSnapshot"("siteId", "source", "validAt", "issuedAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_crewId_validAt_idx" ON "RiskAssessment"("crewId", "validAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_siteId_computedAt_idx" ON "RiskAssessment"("siteId", "computedAt");

-- CreateIndex
CREATE INDEX "WorkerRisk_workerId_createdAt_idx" ON "WorkerRisk"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "CheckIn_workerId_createdAt_idx" ON "CheckIn"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_workerId_createdAt_idx" ON "Alert"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_crewId_createdAt_idx" ON "Alert"("crewId", "createdAt");

-- CreateIndex
CREATE INDEX "WearableSample_workerId_at_idx" ON "WearableSample"("workerId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskType" ADD CONSTRAINT "TaskType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherSnapshot" ADD CONSTRAINT "WeatherSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerRisk" ADD CONSTRAINT "WorkerRisk_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerRisk" ADD CONSTRAINT "WorkerRisk_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "RiskAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearableSample" ADD CONSTRAINT "WearableSample_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
