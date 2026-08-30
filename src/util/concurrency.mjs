/**
 * Bounded-concurrency map, order-preserving.
 *
 * The render and TTS stages are per-scene loops over INDEPENDENT scenes, but both are
 * CPU-bound (headless Chrome per-frame screenshots; Piper synthesis). Running them fully
 * parallel would thrash, so this caps the number in flight (default 3, hard max 4) while
 * still overlapping the per-scene I/O waits. Results come back in input order, so a caller
 * can rely on positional alignment regardless of which scene finished first.
 */

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 4;

/**
 * @template T,R
 * @param {Iterable<T>} items
 * @param {number} limit  max tasks in flight (clamped to >=1 and to items.length)
 * @param {(item:T, index:number)=>Promise<R>|R} fn
 * @returns {Promise<R[]>} results in the same order as `items`
 */
export async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const results = new Array(list.length);
  const workers = Math.max(1, Math.min(limit || 1, list.length || 1));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      results[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Resolve an effective concurrency from an explicit option or an env var, falling back to
 * the default and clamping to the safe [1, MAX_CONCURRENCY] band ("bounded, never unbounded").
 * @param {number|string|undefined} opt   explicit override (wins over env)
 * @param {string} [envVar]               env var name to consult when `opt` is unset
 * @returns {number}
 */
export function resolveConcurrency(opt, envVar) {
  const raw = opt ?? (envVar ? process.env[envVar] : undefined);
  let n = typeof raw === "number" ? raw : Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) n = DEFAULT_CONCURRENCY;
  return Math.min(Math.floor(n), MAX_CONCURRENCY);
}
