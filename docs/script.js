/* ============================================================
   SPINE — Landing Page Script
   Scroll animations · Score dial · Stat counters · Nav
   ============================================================ */

/* ─── Scroll reveal ─── */
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -48px 0px' }
);

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 0.08}s`;
  revealObserver.observe(el);
});

/* ─── Stat counter animation ─── */
function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  const duration = 1800;
  const start = performance.now();

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target);
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = target;
  }

  requestAnimationFrame(update);
}

const statObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.stat-number').forEach(animateCounter);
        statObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.4 }
);

const statsGrid = document.querySelector('.stats-grid');
if (statsGrid) statObserver.observe(statsGrid);

/* ─── Navbar scroll effect ─── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 60) {
    navbar.style.background = 'rgba(4, 5, 6, 0.97)';
    navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.1)';
  } else {
    navbar.style.background = 'rgba(4, 5, 6, 0.85)';
    navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.07)';
  }
}, { passive: true });

/* ─── Interactive Score Dial ─── */
(function scoreDialInit() {
  const slider    = document.getElementById('score-slider');
  const arc       = document.getElementById('score-arc');
  const track     = document.getElementById('score-track');
  const numEl     = document.getElementById('score-number');
  const levelEl   = document.getElementById('score-level');
  const badge     = document.getElementById('score-status-badge');
  const titleEl   = document.getElementById('score-insight-title');
  const listEl    = document.getElementById('score-insight-list');
  const insightEl = document.querySelector('.score-insights');
  const sleepEl   = document.getElementById('shs-sleep');
  const hrvEl     = document.getElementById('shs-hrv');
  const energyEl  = document.getElementById('shs-energy');

  if (!slider) return;

  // Circle: r=90, cx=110, cy=110
  // circumference = 2 * π * 90 ≈ 565.5
  // gauge arc = 270/360 * 565.5 ≈ 424
  const CIRC  = 565.5;
  const GAUGE = 424;

  const states = {
    low: {
      color:   '#00ff88',
      level:   'LOW RISK',
      badge:   'badge-safe',
      badgeTxt: '✓ LOW RISK',
      title:   'Optimal state for financial decisions.',
      insights: [
        'HRV is 18% above your 7-day baseline — decision quality is high',
        'Sleep last night was above your personal optimum',
        'Spending this week is on track with your goals',
        'Good day for reviewing subscriptions, investments, or big purchases',
      ],
      sleep: '8.2 hrs sleep',
      hrv:   '72 ms HRV',
      energy: '1,240 cal active',
    },
    medium: {
      color:   '#ff9500',
      level:   'MEDIUM RISK',
      badge:   'badge-warn',
      badgeTxt: '⚡ MEDIUM RISK',
      title:   'Proceed with moderate caution.',
      insights: [
        'HRV is near baseline — some stress signals present',
        'Sleep was adequate but below your personal best',
        'Discretionary spending slightly elevated vs. similar-state days',
        'Recommend: pause before purchases over $50 · skip impulse tabs',
      ],
      sleep: '6.5 hrs sleep',
      hrv:   '54 ms HRV',
      energy: '680 cal active',
    },
    high: {
      color:   '#ff2d55',
      level:   'HIGH RISK',
      badge:   'badge-danger',
      badgeTxt: '⚠ HIGH RISK',
      title:   'Defer non-essential spending today.',
      insights: [
        'Your HRV is 31% below your 7-day baseline — impulse control is reduced',
        'Last night\'s sleep was well below optimal — decision fatigue is elevated',
        'Spending on similar-state days spiked 68% above your average',
        'Recommend: review cart before checkout · delay subscriptions · avoid browsing',
      ],
      sleep: '4.8 hrs sleep',
      hrv:   '38 ms HRV',
      energy: '240 cal active',
    },
  };

  function getState(score) {
    if (score <= 33) return 'low';
    if (score <= 66) return 'medium';
    return 'high';
  }

  function updateDial(score) {
    const stateKey = getState(score);
    const state    = states[stateKey];
    const filled   = (score / 100) * GAUGE;

    // Update arc
    arc.setAttribute('stroke-dasharray', `${filled} ${CIRC}`);
    arc.setAttribute('stroke', state.color);

    // Update center text
    numEl.textContent  = score;
    numEl.setAttribute('fill', state.color);
    levelEl.textContent = state.level;
    levelEl.setAttribute('fill', state.color);

    // Update badge
    badge.className = `score-badge ${state.badge}`;
    badge.textContent = state.badgeTxt;

    // Update insights
    titleEl.textContent = state.title;
    listEl.innerHTML = state.insights
      .map((line) => `<li>${line}</li>`)
      .join('');

    // Update health summary
    sleepEl.textContent  = state.sleep;
    hrvEl.textContent    = state.hrv;
    energyEl.textContent = state.energy;

    // Update insight panel border
    const colors = { low: '#00ff88', medium: '#ff9500', high: '#ff2d55' };
    insightEl.style.borderColor = `${colors[stateKey]}44`;

    // Update slider track fill via gradient
    const pct = score + '%';
    slider.style.background = `linear-gradient(90deg, ${state.color} 0%, ${state.color} ${pct}, rgba(255,255,255,0.08) ${pct})`;
  }

  slider.addEventListener('input', () => updateDial(parseInt(slider.value, 10)));

  // Initial render
  updateDial(parseInt(slider.value, 10));
})();

/* ─── Hero chip cycling ─── */
(function chipCycle() {
  const chips = document.querySelectorAll('.hero-chips .chip');
  if (!chips.length) return;

  let active = 0;

  setInterval(() => {
    chips[active].style.opacity = '0.35';
    chips[active].style.transform = 'translateX(-6px)';
    active = (active + 1) % chips.length;
    chips[active].style.opacity = '1';
    chips[active].style.transform = 'translateX(0)';
  }, 2400);

  chips.forEach((c, i) => {
    c.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    if (i !== 0) {
      c.style.opacity = '0.35';
    }
  });
})();

/* ─── Hero Honeycomb Visual ─── */
(function buildHexVisual() {
  const svg = document.getElementById('hex-svg');
  if (!svg) return;

  const NS   = 'http://www.w3.org/2000/svg';
  const CX   = 160, CY = 160, SIZE = 29;

  // Flat-top hex: dx = SIZE * 1.5, dy = SIZE * sqrt(3)
  const DX = SIZE * 1.5;
  const DY = SIZE * Math.sqrt(3);

  function hexCenter(q, r) {
    return [CX + DX * q, CY + DY * (r + q / 2)];
  }

  function hexPath(x, y, s) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push([x + s * Math.cos(a), y + s * Math.sin(a)]);
    }
    return 'M ' + pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' L ') + ' Z';
  }

  const cells = [
    // Center
    { q:  0, r:  0, ring: 0, label: null },
    // Ring 1
    { q:  1, r:  0, ring: 1, label: 'HRV' },
    { q:  0, r:  1, ring: 1, label: 'SLEEP' },
    { q: -1, r:  1, ring: 1, label: null },
    { q: -1, r:  0, ring: 1, label: 'SPEND' },
    { q:  0, r: -1, ring: 1, label: 'RISK' },
    { q:  1, r: -1, ring: 1, label: null },
    // Ring 2
    { q:  2, r:  0, ring: 2, label: null },
    { q:  1, r:  1, ring: 2, label: null },
    { q:  0, r:  2, ring: 2, label: null },
    { q: -1, r:  2, ring: 2, label: null },
    { q: -2, r:  2, ring: 2, label: null },
    { q: -2, r:  1, ring: 2, label: null },
    { q: -2, r:  0, ring: 2, label: null },
    { q: -1, r: -1, ring: 2, label: null },
    { q:  0, r: -2, ring: 2, label: null },
    { q:  1, r: -2, ring: 2, label: null },
    { q:  2, r: -2, ring: 2, label: null },
    { q:  2, r: -1, ring: 2, label: null },
  ];

  const styles = {
    0: { fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0.75)', sw: 1.5 },
    1: { fill: 'rgba(255,255,255,0.03)', stroke: 'rgba(255,255,255,0.3)',  sw: 1.0 },
    2: { fill: 'rgba(255,255,255,0.01)', stroke: 'rgba(255,255,255,0.1)',  sw: 0.7 },
  };

  cells.forEach(cell => {
    const [x, y] = hexCenter(cell.q, cell.r);
    const s      = styles[cell.ring];
    const inner  = SIZE - 2.5;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', hexPath(x, y, inner));
    path.setAttribute('fill', s.fill);
    path.setAttribute('stroke', s.stroke);
    path.setAttribute('stroke-width', s.sw);
    if (cell.ring === 0) path.classList.add('hex-center-anim');
    svg.appendChild(path);

    if (cell.label) {
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y + 1);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', 'rgba(255,255,255,0.45)');
      text.setAttribute('font-size', '7');
      text.setAttribute('font-family', 'JetBrains Mono, monospace');
      text.setAttribute('letter-spacing', '0.12em');
      text.textContent = cell.label;
      svg.appendChild(text);
    }
  });

  // Center pulse dot
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', CX);
  dot.setAttribute('cy', CY);
  dot.setAttribute('r', 4);
  dot.setAttribute('fill', 'rgba(255,255,255,0.8)');
  dot.classList.add('hex-core-dot');
  svg.appendChild(dot);
})();

/* ─── Spending bar animation on scroll ─── */
(function animateBars() {
  const pv = document.querySelector('.problem-visual');
  if (!pv) return;

  const barObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        document.querySelector('.bad-fill').style.width = '85%';
        document.querySelector('.good-fill').style.width = '28%';
        barObserver.disconnect();
      }
    },
    { threshold: 0.4 }
  );

  // Start bars at 0, let animation play
  document.querySelector('.bad-fill').style.width = '0%';
  document.querySelector('.good-fill').style.width = '0%';
  barObserver.observe(pv);
})();

/* ─── Email signup handler ─── */
function handleSignup(e) {
  e.preventDefault();
  const input   = document.getElementById('email-input');
  const success = document.getElementById('form-success');
  const form    = document.getElementById('cta-form');

  if (!input.value || !input.validity.valid) return;

  form.style.display = 'none';
  success.classList.remove('hidden');
}

/* ─── Smooth scroll for anchor links ─── */
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 72; // nav height
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});
