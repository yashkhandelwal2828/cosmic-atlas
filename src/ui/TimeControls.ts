/**
 * Time & view dock — play/pause, simulated clock, speed presets, distance mode.
 *
 * `update()` runs on every animation frame, so it caches the last rendered
 * values and only touches the DOM when something actually changed.
 */
import {
  EPOCH_MAX_MS,
  EPOCH_MIN_MS,
  TIME_PRESETS,
  clampEpochMs,
  formatSimDate,
  type SimTimeState,
} from '../state/simTime'
import type { DistanceMode } from '../scene/scale'

export interface TimeControlsHandlers {
  onPlayToggle: (playing: boolean) => void
  onScaleChange: (secondsPerSecond: number) => void
  onJumpToDate: (unixMs: number) => void
  onJumpToNow: () => void
  onDistanceModeChange: (mode: DistanceMode) => void
  onOrbitLinesToggle: (visible: boolean) => void
  onInclinationExaggerationToggle: (on: boolean) => void
  onTopView: () => void
}

/** Mirrors `createSimTime`'s default so the dock never paints an unset speed. */
const DEFAULT_SCALE =
  TIME_PRESETS.find((preset) => preset.id === 'day')?.secondsPerSecond ?? 1

const PLAY_ICON =
  '<svg class="time-play__icon time-play__icon--play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.3 12 8l-6.8 4.7z"/></svg>'
const PAUSE_ICON =
  '<svg class="time-play__icon time-play__icon--pause" viewBox="0 0 16 16" aria-hidden="true"><rect x="4.4" y="3.4" width="2.6" height="9.2" rx="1"/><rect x="9" y="3.4" width="2.6" height="9.2" rx="1"/></svg>'

export class TimeControls {
  private root: HTMLElement
  private handlers: TimeControlsHandlers
  private teardown: Array<() => void> = []

  private card!: HTMLElement
  private playBtn!: HTMLButtonElement
  private readout!: HTMLElement
  private dateInput!: HTMLInputElement

  // Per-frame caches — the DOM is only written when one of these changes.
  private lastDate = ''
  private lastInputValue = ''
  private lastPlaying = false
  private lastScale = DEFAULT_SCALE
  private mode: DistanceMode = 'compressed'

  constructor(container: HTMLElement, handlers: TimeControlsHandlers) {
    this.root = container
    this.handlers = handlers
    this.root.classList.add('time-dock')
    this.render()
    this.bind()
  }

  /** Called every frame — must be cheap; only touch the DOM when text changes. */
  update(state: SimTimeState): void {
    const label = formatSimDate(state.epochMs)
    if (label !== this.lastDate) {
      this.lastDate = label
      this.readout.textContent = label
      this.syncDateInput(state.epochMs)
    }

    if (state.playing !== this.lastPlaying) {
      this.lastPlaying = state.playing
      this.paintPlayState()
    }

    if (state.timeScale !== this.lastScale) {
      this.lastScale = state.timeScale
      this.paintSpeed()
    }
  }

  setDistanceMode(mode: DistanceMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.paintDistanceMode()
  }

  dispose(): void {
    this.teardown.forEach((off) => off())
    this.teardown = []
    this.root.innerHTML = ''
    this.root.classList.remove('time-dock')
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="time-controls">
        <div class="time-row time-row--clock">
          <button type="button" class="time-play" data-el="play"
            aria-pressed="false" aria-label="Play the simulation" title="Play / pause">
            ${PLAY_ICON}${PAUSE_ICON}
          </button>
          <div class="time-readout">
            <span class="time-readout__label">Simulated time</span>
            <span class="time-readout__value mono" data-el="date">—</span>
          </div>
          <div class="time-row__actions">
            <button type="button" class="time-btn" data-el="now" title="Jump to the current instant">
              Now
            </button>
            <label class="time-date" title="Jump to a date and time (UTC)">
              <span class="time-date__icon" aria-hidden="true">🗓</span>
              <input type="datetime-local" class="time-date__input" data-el="date-input"
                min="${toUtcInputValue(EPOCH_MIN_MS)}"
                max="${toUtcInputValue(EPOCH_MAX_MS)}"
                aria-label="Jump to date and time, UTC" />
            </label>
          </div>
        </div>

        <div class="time-row">
          <span class="time-row__legend" id="time-speed-label">Speed</span>
          <div class="time-chips" role="group" aria-labelledby="time-speed-label">
            ${TIME_PRESETS.map(
              (preset) => `
              <button type="button" class="time-chip" data-scale="${preset.secondsPerSecond}"
                aria-pressed="${preset.secondsPerSecond === DEFAULT_SCALE}">
                ${preset.label}
              </button>`,
            ).join('')}
          </div>
        </div>

        <div class="time-row time-row--view">
          <span class="time-row__legend" id="time-view-label">View</span>
          <div class="time-seg" role="group" aria-labelledby="time-view-label">
            <button type="button" class="time-seg__btn" data-mode="compressed" aria-pressed="true">
              Compressed
            </button>
            <button type="button" class="time-seg__btn" data-mode="true" aria-pressed="false">
              True distance
            </button>
          </div>
          <label class="time-toggle">
            <input type="checkbox" data-el="orbits" checked />
            <span>Orbits</span>
          </label>
          <label class="time-toggle" title="Exaggerate orbital inclination ×4">
            <input type="checkbox" data-el="tilt" />
            <span>Tilt ×4</span>
          </label>
          <button type="button" class="time-btn time-btn--icon" data-el="top" title="Frame the whole system from above">
            <span aria-hidden="true">⌖</span> Top view
          </button>
        </div>
      </div>
    `

    this.card = this.pick('.time-controls')
    this.playBtn = this.pick<HTMLButtonElement>('[data-el="play"]')
    this.readout = this.pick('[data-el="date"]')
    this.dateInput = this.pick<HTMLInputElement>('[data-el="date-input"]')
    this.paintPlayState()
    this.paintSpeed()
    this.paintDistanceMode()
  }

  private bind(): void {
    this.on(this.playBtn, 'click', () => {
      this.handlers.onPlayToggle(!this.lastPlaying)
    })

    this.on(this.pick('[data-el="now"]'), 'click', () => {
      this.handlers.onJumpToNow()
    })

    this.on(this.pick('[data-el="top"]'), 'click', () => {
      this.handlers.onTopView()
    })

    this.on(this.dateInput, 'change', () => {
      const ms = parseUtcInput(this.dateInput.value)
      if (ms !== null) this.handlers.onJumpToDate(ms)
    })

    this.card.querySelectorAll<HTMLButtonElement>('.time-chip').forEach((chip) => {
      this.on(chip, 'click', () => {
        const scale = Number(chip.dataset.scale)
        if (Number.isFinite(scale)) this.handlers.onScaleChange(scale)
      })
    })

    this.card
      .querySelectorAll<HTMLButtonElement>('.time-seg__btn')
      .forEach((btn) => {
        this.on(btn, 'click', () => {
          const mode = btn.dataset.mode === 'true' ? 'true' : 'compressed'
          this.setDistanceMode(mode)
          this.handlers.onDistanceModeChange(mode)
        })
      })

    const orbits = this.pick<HTMLInputElement>('[data-el="orbits"]')
    this.on(orbits, 'change', () => {
      this.handlers.onOrbitLinesToggle(orbits.checked)
    })

    const tilt = this.pick<HTMLInputElement>('[data-el="tilt"]')
    this.on(tilt, 'change', () => {
      this.handlers.onInclinationExaggerationToggle(tilt.checked)
    })
  }

  private paintPlayState(): void {
    this.playBtn.classList.toggle('time-play--playing', this.lastPlaying)
    this.playBtn.setAttribute('aria-pressed', this.lastPlaying ? 'true' : 'false')
    this.playBtn.setAttribute(
      'aria-label',
      this.lastPlaying ? 'Pause the simulation' : 'Play the simulation',
    )
  }

  private paintSpeed(): void {
    this.card.querySelectorAll<HTMLButtonElement>('.time-chip').forEach((chip) => {
      const active = Number(chip.dataset.scale) === this.lastScale
      chip.classList.toggle('time-chip--active', active)
      chip.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  private paintDistanceMode(): void {
    this.card
      .querySelectorAll<HTMLButtonElement>('.time-seg__btn')
      .forEach((btn) => {
        const active = btn.dataset.mode === this.mode
        btn.classList.toggle('time-seg__btn--active', active)
        btn.setAttribute('aria-pressed', active ? 'true' : 'false')
      })
  }

  /**
   * Keep the picker in step with the clock, but never yank the value out from
   * under someone who is mid-edit.
   */
  private syncDateInput(unixMs: number): void {
    if (document.activeElement === this.dateInput) return
    const value = toUtcInputValue(unixMs)
    if (value === this.lastInputValue) return
    this.lastInputValue = value
    this.dateInput.value = value
  }

  private pick<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T
  }

  private on<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    fn: (ev: HTMLElementEventMap[K]) => void,
  ): void {
    el.addEventListener(type, fn as EventListener)
    this.teardown.push(() => el.removeEventListener(type, fn as EventListener))
  }
}

/**
 * `datetime-local` hands back a zone-less `YYYY-MM-DDTHH:mm` string, which
 * `new Date()` would read in the HOST timezone. The whole dock is labelled UTC
 * (readout, aria-label, and the value we write back in `toUtcInputValue`), so
 * the field is read as UTC too — otherwise jumping to a date would land the
 * simulation hours away from the one the user typed.
 */
export function parseUtcInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return null
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
  )
  return Number.isFinite(ms) ? clampEpochMs(ms) : null
}

/** Unix ms → the `YYYY-MM-DDTHH:mm` the input expects, in UTC fields. */
function toUtcInputValue(unixMs: number): string {
  const d = new Date(unixMs)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = String(d.getUTCFullYear()).padStart(4, '0')
  return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`
}
