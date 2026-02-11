-- AlterTable
ALTER TABLE "User" ADD COLUMN "clerkId" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");
