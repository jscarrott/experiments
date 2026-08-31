/**
 * A minimal XRPC client over `fetch`.
 *
 * The alpha SDK has generated lexicon bindings, but using them means adopting its
 * codegen toolchain, and everything it would give us here is a URL and a JSON body.
 * Bulletin's own space credential class is hand-rolled fetch for the same reason.
 * Keeping this thin means an SDK breaking change costs us a URL, not a rewrite.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class XrpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'XrpcError';
  }
}

async function toError(response: Response, nsid: string): Promise<XrpcError> {
  let code = `HTTP${response.status}`;
  let message = response.statusText || 'request failed';
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body?.error === 'string') code = body.error;
    if (typeof body?.message === 'string') message = body.message;
  } catch {
    // A non-JSON error body (an HTML 502 page, say) is not worth reporting verbatim.
  }
  return new XrpcError(response.status, code, `${nsid}: ${message}`);
}

export async function xrpcGet<T>(
  fetchImpl: FetchLike,
  service: string,
  nsid: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, service);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw await toError(response, nsid);
  return (await response.json()) as T;
}

export async function xrpcPost<T>(
  fetchImpl: FetchLike,
  service: string,
  nsid: string,
  body: unknown,
): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, service);
  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw await toError(response, nsid);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}
