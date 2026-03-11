/**
 * Typed fetch wrapper with error handling, auth cookie forwarding,
 * and standard error parsing.
 */

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api${path}`;

  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      error: { code: "UNKNOWN", message: "An unexpected error occurred" },
    }));
    throw new ApiClientError(
      res.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? "Request failed",
      body.error?.details,
    );
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => apiClient<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiClient<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiClient<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiClient<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    apiClient<T>(path, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    }),
};
