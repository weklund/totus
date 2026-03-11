/**
 * Shared API client for the Totus CLI.
 * HTTPS fetch with Bearer auth, error mapping, and retry.
 *
 * See: LLD Sections 6.3, 8.7
 */

import { EXIT_AUTH, EXIT_ERROR, EXIT_PERMISSION } from "./exit-codes.js";

/** Error codes mapped from API responses */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "INSUFFICIENT_SCOPES"
  | "KEY_LIMIT_REACHED"
  | "SYNC_IN_PROGRESS"
  | "UNKNOWN";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
    public readonly exitCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  apiKey: string;
  serverUrl: string;
  verbose?: boolean;
}

export interface ApiResponse<T = unknown> {
  data: T;
  pagination?: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

/**
 * Create an API client configured with auth and server URL.
 */
export function createApiClient(options: ApiClientOptions) {
  const { apiKey, serverUrl, verbose } = options;

  // Normalize server URL: remove trailing slash
  const baseUrl = serverUrl.replace(/\/+$/, "");

  // Security check: refuse plain HTTP for non-localhost URLs
  if (baseUrl.startsWith("http://") && !isLocalhost(baseUrl)) {
    throw new ApiError(
      "Refusing to connect over plain HTTP. Use HTTPS for non-localhost URLs.",
      "NETWORK_ERROR",
      0,
      EXIT_ERROR,
    );
  }

  async function request<T = unknown>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, baseUrl);

    // Append query parameters
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    if (verbose) {
      process.stderr.write(`→ ${method} ${url.toString()}\n`);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Unknown network error";
      throw new ApiError(
        `Could not connect to Totus API\n  URL: ${url.toString()}\n  Error: ${errMsg}\n  Check your internet connection and try again.`,
        "NETWORK_ERROR",
        0,
        EXIT_ERROR,
      );
    }

    if (verbose) {
      process.stderr.write(`← ${response.status} ${response.statusText}\n`);
    }

    if (response.ok) {
      const json = await response.json();
      return json as ApiResponse<T>;
    }

    // Handle error responses
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error response
    }

    const apiErrorCode = errorBody.error?.code;
    const errorMessage = errorBody.error?.message || response.statusText;
    const errorDetails = errorBody.error?.details;

    switch (response.status) {
      case 401:
        throw new ApiError(
          `Authentication failed: ${errorMessage}\n  Run "totus auth login" to authenticate, or set TOTUS_API_KEY environment variable.`,
          "UNAUTHORIZED",
          401,
          EXIT_AUTH,
        );

      case 403:
        if (apiErrorCode === "INSUFFICIENT_SCOPES") {
          throw new ApiError(
            `Insufficient permissions: ${errorMessage}\n  Create a new key with the required scope.`,
            "INSUFFICIENT_SCOPES",
            403,
            EXIT_PERMISSION,
            errorDetails,
          );
        }
        throw new ApiError(
          `Permission denied: ${errorMessage}`,
          "FORBIDDEN",
          403,
          EXIT_PERMISSION,
        );

      case 404:
        throw new ApiError(
          `Not found: ${errorMessage}`,
          "NOT_FOUND",
          404,
          EXIT_ERROR,
        );

      case 400:
        throw new ApiError(
          `Validation error: ${errorMessage}`,
          apiErrorCode === "KEY_LIMIT_REACHED" ? "KEY_LIMIT_REACHED" : "VALIDATION_ERROR",
          400,
          EXIT_ERROR,
          errorDetails,
        );

      case 409:
        throw new ApiError(
          `Conflict: ${errorMessage}`,
          "SYNC_IN_PROGRESS",
          409,
          EXIT_ERROR,
        );

      case 429:
        throw new ApiError(
          `Rate limited. Please wait before making more requests.`,
          "RATE_LIMITED",
          429,
          EXIT_ERROR,
        );

      default:
        throw new ApiError(
          `API error (${response.status}): ${errorMessage}`,
          "SERVER_ERROR",
          response.status,
          EXIT_ERROR,
        );
    }
  }

  return {
    get: <T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>) =>
      request<T>("GET", path, { query }),

    post: <T = unknown>(path: string, body?: unknown) =>
      request<T>("POST", path, { body }),

    patch: <T = unknown>(path: string, body?: unknown) =>
      request<T>("PATCH", path, { body }),

    put: <T = unknown>(path: string, body?: unknown) =>
      request<T>("PUT", path, { body }),

    delete: <T = unknown>(path: string) =>
      request<T>("DELETE", path),
  };
}

/** Check if a URL is a localhost URL */
function isLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}
