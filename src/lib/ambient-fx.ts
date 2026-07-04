/**
 * Artist Influence ambient FX layer: drifting background glow, red cursor dot,
 * and a one-time staggered scroll-reveal.
 *
 * NOTE: there is deliberately NO cursor-driven hover tilt. It was removed
 * because it made data tables "swing" under the cursor, which is disorienting
 * on a work surface. Do not reintroduce a pointer-position transform on panels.
 *
 * Implemented with delegated listeners + observers (instead of per-element
 * wiring) so it keeps working across React route changes and re-renders.
 * Everything degrades away on touch devices and prefers-reduced-motion.
 */

const PANEL_SELECTOR = '.glass-panel, .glass-panel-sm';

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
  if (!coarse && !reduced && matchMedia('(pointer: fine)').matches) {
    initCursorDot();
  }
  if (!reduced) initReveal();
}
