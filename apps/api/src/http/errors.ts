export interface ApiErrorDetails {
  field?: string | undefined;
  message: string;
  rule?: string | undefined;
}

export class AppError extends Error {
  readonly code: string;
  readonly details: ApiErrorDetails[] | undefined;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number, details?: ApiErrorDetails[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

export function badRequest(message = 'Bad request'): AppError {
  return new AppError('bad_request', message, 400);
}

export function notFound(message = 'Resource not found'): AppError {
  return new AppError('not_found', message, 404);
}

export function conflict(message = 'Conflict'): AppError {
  return new AppError('conflict', message, 409);
}

export function serviceUnavailable(message = 'Service unavailable'): AppError {
  return new AppError('service_unavailable', message, 503);
}
