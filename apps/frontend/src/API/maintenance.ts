import { apiRequest, type ApiSuccessDto } from './client';
import type { ActivityDto } from './activities';

export type BackupSectionDto =
  | 'aiEndpoints'
  | 'aiSettings'
  | 'jobDescriptions'
  | 'jobReviews'
  | 'jobSearchPresence'
  | 'jobs'
  | 'providerSessions'
  | 'searches';

export type BackupImportModeDto = 'merge' | 'replace';

export interface JobLensBackupDto {
  exportedAt: string;
  format: 'joblens.backup';
  schemaVersion: number;
  sections: Partial<Record<BackupSectionDto, unknown>>;
  version: 1;
}

export interface BackupSectionResultDto {
  deleted: number;
  imported: number;
  skipped: number;
}

export interface BackupImportResultDto {
  importedAt: string;
  mode: BackupImportModeDto;
  sections: Partial<Record<BackupSectionDto, BackupSectionResultDto>>;
}

export interface ApplicationResetDto {
  deleted: Record<string, number>;
  resetAt: string;
  seeded: {
    providers: number;
    settings: number;
  };
}

export interface OperationalClearDto {
  clearedAt: string;
  deleted: Record<string, number>;
}

export function createJobsReviewsExport(): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>('/api/v1/exports/jobs-reviews', {
    method: 'POST',
  });
}

export function createDebugBundle(): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>('/api/v1/debug/bundle', {
    method: 'POST',
  });
}

export function exportJobLensBackup(input: {
  sections: BackupSectionDto[];
}): Promise<ApiSuccessDto<JobLensBackupDto>> {
  return apiRequest<ApiSuccessDto<JobLensBackupDto>>('/api/v1/debug/backup/export', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function importJobLensBackup(input: {
  backup: unknown;
  mode: BackupImportModeDto;
  sections: BackupSectionDto[];
}): Promise<ApiSuccessDto<BackupImportResultDto>> {
  return apiRequest<ApiSuccessDto<BackupImportResultDto>>('/api/v1/debug/backup/import', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function resetApplicationData(input: {
  confirmation: string;
}): Promise<ApiSuccessDto<ApplicationResetDto>> {
  return apiRequest<ApiSuccessDto<ApplicationResetDto>>('/api/v1/debug/reset-app', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function clearOperationalData(input: {
  confirmation: string;
}): Promise<ApiSuccessDto<OperationalClearDto>> {
  return apiRequest<ApiSuccessDto<OperationalClearDto>>('/api/v1/debug/clear-operational-data', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}
