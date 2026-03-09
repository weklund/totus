/**
 * API infrastructure utilities.
 *
 * Re-exports all API helper modules for convenient importing.
 */

export {
  ApiError,
  createErrorResponse,
  type ErrorResponseBody,
} from "./errors";
export { validateRequest } from "./validation";
export {
  encodeCursor,
  decodeCursor,
  paginateResults,
  type DecodedCursor,
  type PaginationMeta,
  type PaginatedResult,
} from "./pagination";
export {
  RateLimiter,
  createRateLimitResponse,
  addRateLimitHeaders,
  generalRateLimiter,
  validationRateLimiter,
  healthDataRateLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from "./rate-limit";
