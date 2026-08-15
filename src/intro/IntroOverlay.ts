/**
 * The intro's DOM half: hold the site chrome back, offer a way out, and cover
 * the canvas for the reduced-motion path.
 *
 * While the sequence runs, the overlay sits above the canvas and swallows
 * pointer events. That is deliberate — it stops a stray click from landing on a
 * hotspot that is currently mid-flight — and it is also what makes "click
 * anywhere to skip" work without touching the scene's own pointer handling.
 */

export interface IntroOverlayOptions {
  /** The `.shell` element; gets `shell--intro` while the sequence runs. */
  shell: HTMLElement
  onSkip: () => void
}

export class IntroOverlay {
  private shell: HTMLElement
  private root: HTMLDivElement
  private skipButton: HTMLButtonElement
  private onSkip: () => void
  private finished = false

  constructor(options: IntroOverlayOptions) {
    this.shell = options.shell
    this.onSkip = options.onSkip

    this.shell.classList.add('shell--intro')

    this.root = document.createElement('div')
    this.root.className = 'intro-overlay'
    this.root.setAttribute('data-intro-overlay', '')

    this.skipButton = document.createElement('button')
    this.skipButton.type = 'button'
    this.skipButton.className = 'intro-skip'
    this.skipButton.textContent = 'Skip intro'
    this.skipButton.setAttribute('data-intro-skip', '')

    this.root.appendChild(this.skipButton)
    this.shell.appendChild(this.root)

    this.skipButton.addEventListener('click', this.handleSkip)
    this.root.addEventListener('pointerdown', this.handleSkip)
    window.addEventListener('keydown', this.handleKey)
  }

  private handleSkip = (event: Event): void => {
    event.stopPropagation()
    if (this.finished) return
    this.onSkip()
  }

  private handleKey = (event: KeyboardEvent): void => {
    if (this.finished) return
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      this.onSkip()
    }
  }

  /** Reveal the skip affordance — held back for the first beat on purpose. */
  revealSkip(): void {
    this.skipButton.classList.add('intro-skip--visible')
  }

  /**
   * Hand the page back: chrome fades in, the overlay stops eating clicks, and
   * the element removes itself once its own transition has run. Idempotent.
   */
  finish(): void {
    if (this.finished) return
    this.finished = true
    this.shell.classList.remove('shell--intro')
    this.root.classList.add('intro-overlay--done')
    window.removeEventListener('keydown', this.handleKey)

    const remove = (): void => this.root.remove()
    this.root.addEventListener('transitionend', remove, { once: true })
    // transitionend never fires if the element is display:none or the user has
    // transitions disabled, so guarantee removal either way.
    window.setTimeout(remove, 1200)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKey)
    this.shell.classList.remove('shell--intro')
    this.root.remove()
  }
}

/**
 * Whether the cinematic sequence should run at all.
 *
 * `?intro=0` forces it off and `?intro=1` forces it on — the override exists so
 * the reduced-motion path is testable without changing OS settings.
 */
export function shouldPlayIntro(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  prefersReducedMotion: boolean = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false,
): boolean {
  const params = new URLSearchParams(search)
  const forced = params.get('intro')
  if (forced === '0' || forced === 'false') return false
  if (forced === '1' || forced === 'true') return true
  return !prefersReducedMotion
}
