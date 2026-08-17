/**
 * Raises texture resolution after the fact, one map at a time, on idle.
 *
 * Every map enters the scene at 2K so the intro has a clear frame budget. This
 * is the other half of that bargain: once the sequence has handed over and the
 * camera is sitting still, the maps that matter are re-fetched at the device's
 * ceiling and swapped in place.
 *
 * Three properties are the whole design:
 *
 *   ONE AT A TIME.  `TextureCache.upgrade` resolves only after `initTexture` has
 *   pushed the image to the GPU, so awaiting each key in turn guarantees at most
 *   one `texImage2D` + `glGenerateMipmap` per idle slot. Firing them in parallel
 *   would collapse back into the single stall this exists to avoid.
 *
 *   IDLE, NOT IMMEDIATE.  The gap between keys is an idle callback, so an upload
 *   never lands in the same task as a frame the browser is trying to present.
 *
 *   DEMAND-ORDERED.  Only the bodies the viewer is actually looking at get
 *   raised. Nine planets at 8K is 1.6 GB of VRAM for eight planets nobody is
 *   pointed at; `boost()` moves the travel target to the front of the queue
 *   instead, and everything else stays at 2K until it is asked for.
 */
import type { TextureCache, TextureRes, UpgradeJob } from './textures'

type IdleHandle = number

/**
 * `requestIdleCallback` is absent on Safari before 17. The fallback is a plain
 * timeout rather than a microtask: the point is to leave whole frames alone, and
 * a macrotask an animation frame apart does that well enough.
 */
const IDLE_FALLBACK_MS = 140

function onIdle(fn: () => void, timeout: number): IdleHandle {
  const ric = (globalThis as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback
  if (typeof ric === 'function') {
    return ric(() => fn(), { timeout }) as unknown as IdleHandle
  }
  return setTimeout(fn, IDLE_FALLBACK_MS) as unknown as IdleHandle
}

function cancelIdle(handle: IdleHandle): void {
  const cic = (globalThis as { cancelIdleCallback?: typeof cancelIdleCallback })
    .cancelIdleCallback
  if (typeof cic === 'function') cic(handle as unknown as number)
  else clearTimeout(handle as unknown as number)
}

export class TextureUpgrader {
  private cache: TextureCache
  private queue: UpgradeJob[] = []
  private queued = new Map<string, TextureRes>()
  private running = false
  private stopped = false
  private idle: IdleHandle | null = null

  constructor(cache: TextureCache) {
    this.cache = cache
  }

  /** Append jobs, skipping any key already queued at that tier or higher. */
  enqueue(jobs: UpgradeJob[]): void {
    for (const job of jobs) this.push(job, false)
    this.drain()
  }

  /**
   * Put jobs at the head of the queue — the body the viewer just asked to travel
   * to should sharpen before the one they left.
   */
  boost(jobs: UpgradeJob[]): void {
    for (const job of [...jobs].reverse()) this.push(job, true)
    this.drain()
  }

  private push(job: UpgradeJob, front: boolean): void {
    if (this.stopped) return
    const already = this.queued.get(job.key)
    if (already === job.res) {
      // Same tier already pending: only its position can change.
      if (front) {
        const at = this.queue.findIndex((q) => q.key === job.key)
        if (at > 0) this.queue.unshift(...this.queue.splice(at, 1))
      }
      return
    }
    if (this.cache.resolutionOf(job.key) === job.res) return

    // A key can legitimately be re-queued at a higher tier; drop the stale entry.
    const at = this.queue.findIndex((q) => q.key === job.key)
    if (at >= 0) this.queue.splice(at, 1)

    this.queued.set(job.key, job.res)
    if (front) this.queue.unshift(job)
    else this.queue.push(job)
  }

  private drain(): void {
    if (this.running || this.stopped || this.queue.length === 0) return
    this.running = true
    this.step()
  }

  private step = (): void => {
    this.idle = null
    const job = this.queue.shift()
    if (!job || this.stopped) {
      this.running = false
      return
    }

    void this.cache.upgrade(job.key, job.res).then(() => {
      if (this.queued.get(job.key) === job.res) this.queued.delete(job.key)
      if (this.stopped) {
        this.running = false
        return
      }
      if (this.queue.length === 0) {
        this.running = false
        return
      }
      // Timeout is a ceiling, not a target: a page left untouched still finishes
      // upgrading rather than waiting forever for an idle window that a busy
      // render loop may never open.
      this.idle = onIdle(this.step, 1500)
    })
  }

  /** Length of the outstanding queue. Exposed for verification. */
  get pending(): number {
    return this.queue.length
  }

  dispose(): void {
    this.stopped = true
    this.queue.length = 0
    this.queued.clear()
    if (this.idle !== null) cancelIdle(this.idle)
    this.idle = null
  }
}
