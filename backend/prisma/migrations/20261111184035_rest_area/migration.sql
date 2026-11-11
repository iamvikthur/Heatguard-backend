-- CreateEnum
CREATE TYPE "RestArea" AS ENUM ('SUN', 'SHADE', 'COOLED');

-- AlterTable
ALTER TABLE "RiskAssessment" ADD COLUMN     "restWbgtC" DOUBLE PRECISION,
ADD COLUMN     "workMinRestInSun" INTEGER;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "restArea" "RestArea" NOT NULL DEFAULT 'SHADE',
ADD COLUMN     "restWbgtC" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WeatherSnapshot" ADD COLUMN     "directRadiationWm2" DOUBLE PRECISION,
ADD COLUMN     "pressureHpa" DOUBLE PRECISION;
