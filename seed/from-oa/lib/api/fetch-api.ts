/**
 * Bounded same-origin fetches to `/api/*`.
 * Native `fetch` has no timeout; stalled serverless handlers otherwise show infinite spinners.
 */

export const API_FETCH_TIMEOUT_MS = 60_000;

/** Routes that call an LLM or may run long generation (serverless + provider). */
export const API_FETCH_TIMEOUT_LLM_MS = 120_000;

/** Large file uploads and batch apply endpoints. */
export const API_FETCH_TIMEOUT_UPLOAD_MS = 120_000;

/** SSE / long streaming responses (e.g. SOC coach). */
export const API_FETCH_TIMEOUT_STREAM_MS = 600_000;

type FetchApiInit = RequestInit & {
  timeoutMs?: number;
  /** Default true. Sends X-Request-Id for log correlation. */
  requestId?: boolean;
};

function attachTimeoutSignal(
  outerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else
      outerSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * `fetch` to app API routes with AbortController timeout and optional `X-Request-Id`.
 */
export async function fetchApi(
  input: string | URL,
  init: FetchApiInit = {},
): Promise<Response> {
  const {
    timeoutMs = API_FETCH_TIMEOUT_MS,
    requestId = true,
    signal: outerSignal,
    ...rest
  } = init;

  const headers = new Headers(rest.headers);
  if (
    requestId &&
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    headers.set("X-Request-Id", crypto.randomUUID());
  }

  const { signal, clear } = attachTimeoutSignal(outerSignal, timeoutMs);
  try {
    return await fetch(input, {
      ...rest,
      headers,
      signal,
    });
  } finally {
    clear();
  }
}
