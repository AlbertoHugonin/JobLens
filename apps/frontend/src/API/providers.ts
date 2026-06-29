import { apiRequest, type ApiSuccessDto } from './client';
import type { ProviderSessionDto } from './linkedin';

export interface CredentialFieldDto {
  help?: string;
  label: string;
  name: string;
  placeholder?: string;
  required: boolean;
  secret: boolean;
}

export interface ProviderDescriptorDto {
  credentialFields: CredentialFieldDto[];
  key: string;
  name: string;
  supportsHarImport: boolean;
  supportsVerify: boolean;
}

export interface SessionVerificationDto {
  alive: boolean;
  message: string | null;
  session: ProviderSessionDto | null;
  status: number | null;
}

export interface CredentialsPayload {
  credentials: Record<string, string>;
  label?: string | undefined;
}

export function fetchProviders(): Promise<ApiSuccessDto<ProviderDescriptorDto[]>> {
  return apiRequest<ApiSuccessDto<ProviderDescriptorDto[]>>('/api/v1/providers');
}

export function createProviderCredentials(
  providerKey: string,
  input: CredentialsPayload,
): Promise<ApiSuccessDto<ProviderSessionDto>> {
  return apiRequest<ApiSuccessDto<ProviderSessionDto>>(
    `/api/v1/providers/${providerKey}/credentials`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export function verifyProviderSession(
  providerKey: string,
  sessionId: string,
): Promise<ApiSuccessDto<SessionVerificationDto>> {
  return apiRequest<ApiSuccessDto<SessionVerificationDto>>(
    `/api/v1/providers/${providerKey}/sessions/${sessionId}/verify`,
    { method: 'POST' },
  );
}
