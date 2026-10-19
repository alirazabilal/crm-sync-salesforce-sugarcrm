// Small fetch wrapper with retries and exponential backoff.
// Retries on network errors, HTTP 429 (rate limited) and 5xx responses.

export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function request<T = any>(
  url: string,
  init: RequestInit = {},
  { retries = 3, baseDelayMs = 500 } = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      let body: any = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // not JSON, keep raw text
      }

      if (res.ok) return body as T;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter ? retryAfter * 1000 : baseDelayMs * 2 ** attempt);
        attempt++;
        continue;
      }
      throw new HttpError(res.status, body, `HTTP ${res.status} for ${init.method ?? 'GET'} ${url}: ${summarize(body)}`);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // network error (connection refused, reset, DNS)
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

function summarize(body: unknown): string {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return s.length > 300 ? s.slice(0, 300) + '...' : s;
}
