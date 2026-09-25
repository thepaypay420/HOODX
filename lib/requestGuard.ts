export type WorkPolicy = Readonly<{
  capacity: number;
  refillPerSecond: number;
  maxConcurrent: number;
}>;

type Bucket = { tokens: number; updatedAt: number; active: number };
type GuardState = { buckets: Map<string, Bucket> };

const GLOBAL_KEY = Symbol.for("hoodx.request-work-guard.v1");

function state(): GuardState {
  const root = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GuardState };
  if (!root[GLOBAL_KEY]) root[GLOBAL_KEY] = { buckets: new Map() };
  const current = root[GLOBAL_KEY];
  if (!current || !(current.buckets instanceof Map)) throw new Error("Request protection unavailable");
  return current;
}

export class WorkRejected extends Error {
  constructor(public readonly retryAfterSeconds = 5) { super("Request work budget exceeded"); }
}

/**
 * Process-wide admission control. It deliberately ignores IP, wallet and forwarded
 * headers, so rotating identities cannot bypass the aggregate upstream budget.
 * Hosting-edge limits are still required to coordinate multiple instances.
 */
export function admitWork(name: string, cost: number, policy: WorkPolicy, now = Date.now()): () => void {
  if (!name || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(policy.capacity) || policy.capacity < cost ||
      !Number.isFinite(policy.refillPerSecond) || policy.refillPerSecond <= 0 ||
      !Number.isInteger(policy.maxConcurrent) || policy.maxConcurrent < 1) {
    throw new Error("Invalid request protection policy");
  }
  const buckets = state().buckets;
  const bucket = buckets.get(name) ?? { tokens: policy.capacity, updatedAt: now, active: 0 };
  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsed * policy.refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.active >= policy.maxConcurrent || bucket.tokens < cost) {
    buckets.set(name, bucket);
    const missing = Math.max(0, cost - bucket.tokens);
    throw new WorkRejected(Math.max(1, Math.ceil(missing / policy.refillPerSecond)));
  }
  bucket.tokens -= cost;
  bucket.active += 1;
  buckets.set(name, bucket);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bucket.active = Math.max(0, bucket.active - 1);
  };
}

export async function withWorkBudget<T>(name: string, cost: number, policy: WorkPolicy, work: () => Promise<T>): Promise<T> {
  const release = admitWork(name, cost, policy);
  try { return await work(); } finally { release(); }
}

export async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit");
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

export function guardedError(error: unknown) {
  if (error instanceof WorkRejected) {
    return Response.json({ error: "Busy. Retry shortly." }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds), "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "Protection unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

export function resetWorkGuardForTests() {
  const root = globalThis as typeof globalThis & { [GLOBAL_KEY]?: GuardState };
  delete root[GLOBAL_KEY];
}
