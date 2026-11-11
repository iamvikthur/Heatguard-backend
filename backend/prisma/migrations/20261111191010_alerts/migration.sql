/*
  Warnings:

  - Added the required column `audience` to the `Alert` table without a default value. This is not possible if the table is not empty.
  - Added the required column `body` to the `Alert` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reason` to the `Alert` table without a default value. This is not possible if the table is not empty.
  - Added the required column `validAt` to the `Alert` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AlertAudience" AS ENUM ('WORKER', 'SUPERVISOR');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "assessmentId" TEXT,
ADD COLUMN     "audience" "AlertAudience" NOT NULL,
ADD COLUMN     "body" TEXT NOT NULL,
ADD COLUMN     "isReplay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reason" TEXT NOT NULL,
ADD COLUMN     "validAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "WorkerRisk" ADD COLUMN     "restMin" INTEGER,
ADD COLUMN     "workMin" INTEGER;

-- CreateIndex
CREATE INDEX "Alert_assessmentId_idx" ON "Alert"("assessmentId");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "RiskAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
