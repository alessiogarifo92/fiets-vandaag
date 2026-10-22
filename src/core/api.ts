// Shapes shared by the app and the Worker (docs/architecture.md §5).

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export function apiError(code: string, message: string, fields?: Record<string, string>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.ok === true && typeof v.version === 'string' && v.version.length > 0;
}

/** `POST /api/devices` answer. The secret is shown once; the server keeps only its SHA-256. */
export interface RegisterResponse {
  deviceId: string;
  secret: string;
}

export function isRegisterResponse(value: unknown): value is RegisterResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.deviceId === 'string' && /^[\w-]{1,64}$/.test(v.deviceId) && typeof v.secret === 'string';
}

/** Error codes the device and route API answers with (docs/architecture.md §5). */
export const ERROR_CODES = {
  invalidJson: 'invalid_json',
  invalidBody: 'invalid_body',
  bodyTooLarge: 'body_too_large',
  unauthorized: 'unauthorized',
  inviteInvalid: 'invite_invalid',
  capacity: 'capacity',
  registrationClosed: 'registration_closed',
  endpointTaken: 'endpoint_taken',
  notFound: 'not_found',
} as const;

export function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
