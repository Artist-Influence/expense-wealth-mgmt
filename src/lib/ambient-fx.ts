/**
 * Artist Influence ambient FX layer: drifting background glow, red cursor
 * dot, hover tilt on glass panels, and staggered scroll-reveal.
 *
 * Implemented with delegated listeners + observers (instead of per-element
 * wiring) so it keeps working across React route changes and re-renders.
 * Everything degrades away on touch devices and prefers-reduced-motion.
 */

const PANEL_SELECTOR = '.glass-panel, .glass-panel-sm';

/** Panels that must never tilt: sticky nav, portaled overlays, opt-outs. */
function tiltEligible(el: HTMLElement): boolean {
  if (
    el.closest(
      'nav, [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-no-tilt]',
    )
  ) {
    return false;
  }
  // Data tables are work surfaces; they must stay still under the cursor.
  return !el.querySelector('table');
}

function initAmbientLayer() {
  if (document.querySelector('.ambient')) return;
  const layer = document.createElement('div');
  layer.className = 'ambient';
  layer.setAttribute('aria-hidden', 'true');
  for (const cls of ['g1', 'g2', 'g3']) {
    const glow = document.createElement('i');
    glow.className = cls;
    layer.appendChild(glow);
  }
  document.body.prepend(layer);
}

function initCursorDot() {
  const dot = document.createElement('div');
  dot.className = 'cursor-dot';
  document.body.appendChild(dot);
  window.addEventListener('mousemove', (e) => {
    dot.style.left = `${e.clientX}px`;
    dot.style.top = `${e.clientY}px`;
    dot.style.opacity = '1';
  });
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) dot.style.opacity = '0';
  });
}

function initTilt() {
  let current: HTMLElement | null = null;

  const reset = () => {
    if (!current) return;
    current.classList.remove('tilting');
    current.style.transform = '';
    current = null;
  };

  document.addEventListener('mousemove', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const panel = target?.closest<HTMLElement>(PANEL_SELECTOR) ?? null;
    const eligible = panel && tiltEligible(panel) ? panel : null;

    if (current && current !== eligible) reset();
    if (!eligible) return;

    current = eligible;
    const r = eligible.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    // Full-width panels get a gentler tilt so tables stay readable.
    const amp = r.width > 720 ? 1.8 : 4.5;
    eligible.classList.add('tilting');
    eligible.style.transform =
      `perspective(900px) rotateX(${(-y * amp).toFixed(2)}deg) rotateY(${(x * amp).toFixed(2)}deg) translateY(-2px)`;
  });

  document.addEventListener('mouseleave', reset);
}

function initReveal() {
  const revealed = new WeakSet<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('shown');
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
  );

  const process = (root: ParentNode) => {
    // If a table mounted into a panel that is still entering, snap it static
    // so the table never moves.
    for (const panel of root.querySelectorAll<HTMLElement>('.reveal')) {
      if (panel.querySelector('table')) {
        panel.classList.remove('reveal', 'shown');
        panel.style.removeProperty('--rd');
        io.unobserve(panel);
      }
    }

    const panels = root.querySelectorAll<HTMLElement>(PANEL_SELECTOR);
    let batchIndex = 0;
    for (const panel of panels) {
      if (revealed.has(panel) || panel.closest('nav, [role="dialog"], [role="alertdialog"]')) continue;
      revealed.add(panel);
      // Panels holding data tables render in place with no entrance motion.
      if (panel.querySelector('table')) continue;
      panel.classList.add('reveal');
      panel.style.setProperty('--rd', `${Math.min(batchIndex, 8) * 60}ms`);
      batchIndex += 1;
      io.observe(panel);
    }
  };

  process(document.body);
  new MutationObserver(() => process(document.body)).observe(document.body, {
    childList: true,
    subtree: true,
  });
}

export function initAmbientFx() {
  if ((window as { __fxInit?: boolean }).__fxInit) return;
  (window as { __fxInit?: boolean }).__fxInit = true;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  initAmbientLayer();
  if (!coarse && !reduced) {
    if (matchMedia('(pointer: fine)').matches) initCursorDot();
    initTilt();
  }
  if (!reduced) initReveal();
}
