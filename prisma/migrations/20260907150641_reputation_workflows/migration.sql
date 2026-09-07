/*
  Warnings:

  - You are about to drop the column `authorId` on the `ManagerRating` table. All the data in the column will be lost.
  - Added the required column `authorEmployeeId` to the `ManagerRating` table without a default value. This is not possible if the table is not empty.
  - Added the required column `managerId` to the `ManagerRating` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ManagerRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorEmployeeId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "leadership" REAL NOT NULL,
    "communication" REAL NOT NULL,
    "fairness" REAL NOT NULL,
    "professionalism" REAL NOT NULL,
    "scheduling" REAL NOT NULL,
    "workplace" REAL NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagerRating_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManagerRating_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManagerRating_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ManagerRating" ("anonymous", "communication", "createdAt", "fairness", "id", "leadership", "professionalism", "restaurantId", "scheduling", "workplace") SELECT "anonymous", "communication", "createdAt", "fairness", "id", "leadership", "professionalism", "restaurantId", "scheduling", "workplace" FROM "ManagerRating";
DROP TABLE "ManagerRating";
ALTER TABLE "new_ManagerRating" RENAME TO "ManagerRating";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
