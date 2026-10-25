-- DropForeignKey
ALTER TABLE `FpassSubmission` DROP FOREIGN KEY `FpassSubmission_employeeId_fkey`;

-- AlterTable
ALTER TABLE `BiometricTemplate` ADD COLUMN `counter` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `credentialId` TEXT NULL,
    ADD COLUMN `credentialPubKey` TEXT NULL,
    ADD COLUMN `engine` VARCHAR(191) NOT NULL DEFAULT 'webauthn',
    ALTER COLUMN `fingerIndex` DROP DEFAULT,
    MODIFY `templateData` TEXT NULL;

-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `contractTypeId` VARCHAR(191) NULL,
    ADD COLUMN `employmentType` VARCHAR(191) NOT NULL DEFAULT 'Teaching';

-- AlterTable
ALTER TABLE `Role` ADD COLUMN `canManageBiometrics` BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE `FpassSubmission`;

-- CreateTable
CREATE TABLE `ContractType` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ContractType_name_key`(`name`),
    UNIQUE INDEX `ContractType_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FpasSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `schoolYear` VARCHAR(191) NOT NULL,
    `formData` TEXT NOT NULL,
    `totalPoints` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FpasSubmission_employeeId_idx`(`employeeId`),
    INDEX `FpasSubmission_schoolYear_idx`(`schoolYear`),
    UNIQUE INDEX `FpasSubmission_employeeId_schoolYear_key`(`employeeId`, `schoolYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Attendance_date_idx` ON `Attendance`(`date`);

-- CreateIndex
CREATE INDEX `Employee_active_idx` ON `Employee`(`active`);

-- CreateIndex
CREATE INDEX `Evaluation_periodId_employeeId_idx` ON `Evaluation`(`periodId`, `employeeId`);

-- CreateIndex
CREATE UNIQUE INDEX `LeaveApproval_leaveRequestId_level_key` ON `LeaveApproval`(`leaveRequestId`, `level`);

-- CreateIndex
CREATE INDEX `LeaveRequest_employeeId_status_idx` ON `LeaveRequest`(`employeeId`, `status`);

-- CreateIndex
CREATE INDEX `LeaveRequest_status_idx` ON `LeaveRequest`(`status`);

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_contractTypeId_fkey` FOREIGN KEY (`contractTypeId`) REFERENCES `ContractType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FpasSubmission` ADD CONSTRAINT `FpasSubmission_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

