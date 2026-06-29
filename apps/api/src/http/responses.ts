import type { FastifyError } from 'fastify';

import { AppError, type ApiErrorDetails } from './errors.js';

export interface ApiSuccessResponse<TData, TMeta = undefined> {
  data: TData;
  meta?: TMeta;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    details?: ApiErrorDetails[] | undefined;
    message: string;
    statusCode: number;
  };
}

export function ok<TData>(data: TData): ApiSuccessResponse<TData>;
export function ok<TData, TMeta>(data: TData, meta: TMeta): ApiSuccessResponse<TData, TMeta>;
export function ok<TData, TMeta>(
  data: TData,
  meta?: TMeta,
): ApiSuccessResponse<TData, TMeta | undefined> {
  return meta === undefined ? { data } : { data, meta };
}

export const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'statusCode'],
      properties: {
        code: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['message'],
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
              rule: { type: 'string' },
            },
          },
        },
        message: { type: 'string' },
        statusCode: { type: 'number' },
      },
    },
  },
} as const;

export function successResponseSchema(dataSchema: unknown, metaSchema?: unknown): unknown {
  const properties: Record<string, unknown> = {
    data: dataSchema,
  };
  const required = ['data'];

  if (metaSchema) {
    properties.meta = metaSchema;
    required.push('meta');
  }

  return {
    type: 'object',
    required,
    properties,
  };
}

function normalizeValidationDetails(error: FastifyError): ApiErrorDetails[] | undefined {
  if (!error.validation?.length) {
    return undefined;
  }

  return error.validation.map((validationError) => {
    const instancePath = validationError.instancePath || '';
    const params = validationError.params as Record<string, unknown> | undefined;
    const missingProperty =
      typeof params?.missingProperty === 'string' ? params.missingProperty : undefined;
    const field = [instancePath.replace(/^\//, '').replaceAll('/', '.'), missingProperty]
      .filter(Boolean)
      .join('.');

    return {
      field: field || undefined,
      message: validationError.message ?? 'Invalid value',
      rule: validationError.keyword,
    };
  });
}

export function toErrorResponse(error: FastifyError): {
  body: ApiErrorResponse;
  statusCode: number;
} {
  if (error.validation) {
    const statusCode = 400;

    return {
      body: {
        error: {
          code: 'validation_error',
          details: normalizeValidationDetails(error),
          message: 'Request validation failed',
          statusCode,
        },
      },
      statusCode,
    };
  }

  if (error instanceof AppError) {
    return {
      body: {
        error: {
          code: error.code,
          details: error.details,
          message: error.message,
          statusCode: error.statusCode,
        },
      },
      statusCode: error.statusCode,
    };
  }

  const statusCode = error.statusCode ?? 500;

  return {
    body: {
      error: {
        code: statusCode >= 500 ? 'internal_server_error' : 'request_error',
        message: statusCode >= 500 ? 'Internal server error' : error.message,
        statusCode,
      },
    },
    statusCode,
  };
}
