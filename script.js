/* ═══════════════════════════════════════════════════════
   VEDERRA MODULAR — Cinematic Scroll Engine (stabilized)
   Vanilla JS · No dependencies
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const MOBILE_BP = 860;
  const LOW_POWER_CORES = 2;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function isMobileViewport() {
    return window.innerWidth <= MOBILE_BP;
  }

  function isLowPowerDevice() {
    const cores = safeNumber(navigator.hardwareConcurrency, 0);
    return cores > 0 && cores <= LOW_POWER_CORES;
  }

  function shouldUseLiteMode() {
    return isMobileViewport() || prefersReduced.matches || isLowPowerDevice();
  }

  // ─── MOBILE NAV ───
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });

    nav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        nav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const header = document.querySelector('.site-header');
  const cinSections = document.querySelectorAll('.cin-section');
  const isHomepage = cinSections.length > 0;

  function setHeaderState() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 50);
  }

  // Sub-pages: lightweight behavior only
  if (!isHomepage) {
    setupSimpleHeaderScroll();
    if (document.querySelector('.gallery-page')) {
      setupGallery();
    } else if (document.querySelector('.altmod-main')) {
      setupAltMod();
    } else {
      setupSubpageFX();
    }
    return;
  }

  const cinEls = Array.from(document.querySelectorAll('.cin-el'));
  const heroBg = document.querySelector('.hero-bg');
  const craneModule = document.querySelector('.crane-module');
  const craneBoom = document.querySelector('.crane-boom');
  const craneCable = document.querySelector('.crane-cable');
  const craneHook = document.querySelector('.crane-hook');

  // Advantage pinned-stage refs (crane lowers the headline lines)
  const advantageSection = document.querySelector('.advantage-section');
  const craneSvg = document.querySelector('.crane-svg');
  const craneLines = Array.from(document.querySelectorAll('.crane-line'));
  const craneCableConnector = document.querySelector('.crane-cable-connector');
  const advantageLabel = document.querySelector('.advantage-label');
  const advantageLead = document.querySelector('.advantage-lead');

  const state = {
    mode: 'uninitialized',
    sectionData: [],
    rafId: 0,
    pendingFrame: false,
    latestScrollY: window.scrollY,
    observer: null,
    observerTimeouts: new Set(),
    listenersAbort: null,
  };

  function clearObserverTimeouts() {
    state.observerTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    state.observerTimeouts.clear();
  }

  function disconnectObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    clearObserverTimeouts();
  }

  function cancelFrame() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    state.pendingFrame = false;
  }

  function cleanupListeners() {
    if (state.listenersAbort) {
      state.listenersAbort.abort();
      state.listenersAbort = null;
    }
  }

  function cleanupCurrentMode() {
    cancelFrame();
    disconnectObserver();
    cleanupListeners();
  }

  function measureSections() {
    state.sectionData = Array.from(cinSections).map((section) => {
      const rect = section.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const height = Math.max(1, rect.height);
      const cinElements = Array.from(section.querySelectorAll('.cin-el')).map((el) => ({
        el,
        delay: safeNumber(el.dataset.cinDelay, 0),
      }));

      return {
        el: section,
        top,
        height,
        bottom: top + height,
        name: section.dataset.cin || '',
        cinEls: cinElements,
      };
    });
  }

  // Pinned cinematic sequence: the crane lowers each headline line into place.
  // `p` is the normalized pinned progress (0 → 1) across the tall section track.
  function animateAdvantageStage(p) {
    // ── Phase 1 (0–0.12): scene establishes — label + crane draw in ──
    const establish = easeOutCubic(clamp(p / 0.12, 0, 1));
    if (advantageLabel) {
      advantageLabel.style.opacity = String(establish);
      advantageLabel.style.transform = `translate3d(0, ${lerp(20, 0, establish)}px, 0)`;
    }
    if (craneSvg) {
      craneSvg.style.opacity = String(lerp(0.15, 1, establish));
    }

    // ── Phase 2 (0.12–0.82): lower each headline line, one at a time ──
    const seqStart = 0.12;
    const seqEnd = 0.82;
    const n = Math.max(1, craneLines.length);
    const span = (seqEnd - seqStart) / n;

    let activeLower = -1; // 0..1 within the currently-descending line, else -1

    craneLines.forEach((line, i) => {
      const start = seqStart + i * span;
      const end = start + span * 0.9;
      const raw = clamp((p - start) / Math.max(0.001, end - start), 0, 1);
      const eased = easeOutCubic(raw);
      const drop = lerp(-240, 0, eased);
      line.style.transform = `translate3d(0, ${drop}px, 0)`;
      line.style.opacity = String(clamp(raw * 1.8, 0, 1));
      if (raw > 0 && raw < 1) activeLower = raw;
    });

    // ── Crane motion follows the active line: pick → lower → set → return ──
    // Triangular descent: hook goes down (0→0.55) then retracts (0.55→1).
    let hookPhase = 0;
    if (activeLower >= 0) {
      hookPhase = activeLower < 0.55
        ? activeLower / 0.55
        : 1 - (activeLower - 0.55) / 0.45;
    }
    hookPhase = clamp(hookPhase, 0, 1);

    // Boom swings gently across the whole sequence for life.
    const seqP = clamp((p - seqStart) / (seqEnd - seqStart), 0, 1);
    if (craneBoom) {
      const boomAngle = Math.sin(seqP * Math.PI * 2) * 3;
      craneBoom.style.transform = `rotate(${boomAngle}deg)`;
    }

    const hookTravel = lerp(140, 250, hookPhase);
    if (craneHook) {
      craneHook.setAttribute('transform', `translate(320,${hookTravel})`);
    }
    if (craneCable) {
      craneCable.setAttribute('y2', String(65 + lerp(80, 190, hookPhase)));
    }
    if (craneModule) {
      // Module rides the hook down, fades as the "beam" (text) is set.
      craneModule.style.transform = `translateY(${lerp(-30, 30, hookPhase)}px)`;
      craneModule.style.opacity = String(lerp(0.15, 0.85, hookPhase));
    }

    // CSS cable connector: glowing line that drops while a line is being set.
    if (craneCableConnector) {
      const show = activeLower >= 0 ? 1 : 0;
      craneCableConnector.style.opacity = String(show * clamp(hookPhase * 1.5, 0, 1));
      craneCableConnector.style.height = `${lerp(0, 120, hookPhase) * show}px`;
    }

    // ── Phase 3 (0.82–1.0): lead paragraph + counter settle in ──
    if (advantageLead) {
      const leadP = easeOutCubic(clamp((p - 0.82) / 0.18, 0, 1));
      advantageLead.style.opacity = String(leadP);
      advantageLead.style.transform = `translate3d(0, ${lerp(24, 0, leadP)}px, 0)`;
    }
  }

  function applyDesktopAnimations() {
    const scrollY = state.latestScrollY;
    const vh = Math.max(window.innerHeight, 1);
    const viewportTop = scrollY - vh * 0.3;
    const viewportBottom = scrollY + vh * 1.3;

    setHeaderState();

    if (heroBg) {
      const heroProgress = clamp(scrollY / vh, 0, 1.5);
      const offsetPx = heroProgress * 30;
      const scale = 1 + heroProgress * 0.05;
      heroBg.style.transform = `translate3d(0, ${offsetPx}px, 0) scale(${scale})`;
    }

    for (let i = 0; i < state.sectionData.length; i += 1) {
      const sd = state.sectionData[i];

      // Skip distant offscreen sections to avoid unnecessary style writes.
      if (sd.bottom < viewportTop || sd.top > viewportBottom) {
        continue;
      }

      const sectionVisibleStart = sd.top - vh;
      const sectionVisibleEnd = sd.bottom;
      const denominator = Math.max(1, sectionVisibleEnd - sectionVisibleStart);
      const rawProgress = (scrollY - sectionVisibleStart) / denominator;
      const progress = clamp(rawProgress, 0, 1);

      for (let j = 0; j < sd.cinEls.length; j += 1) {
        const item = sd.cinEls[j];
        const delay = clamp(item.delay, 0, 0.9);
        const entryStart = 0.1 + delay;
        const entryEnd = 0.35 + delay;
        const elementRange = Math.max(0.001, entryEnd - entryStart);
        const elProgress = clamp((progress - entryStart) / elementRange, 0, 1);
        const eased = easeOutCubic(elProgress);

        const y = lerp(50, 0, eased);
        item.el.style.opacity = String(eased);
        item.el.style.transform = `translate3d(0, ${y}px, 0)`;
      }

      if (sd.name === 'advantage') {
        // True pinned progress: how far we've scrolled through the tall track
        // while the stage is stuck to the viewport.
        const track = Math.max(1, sd.height - vh);
        const pinnedProgress = clamp((scrollY - sd.top) / track, 0, 1);
        animateAdvantageStage(pinnedProgress);
      }
    }
  }

  function runDesktopFrame() {
    state.pendingFrame = false;

    if (state.mode !== 'desktop') {
      return;
    }

    try {
      applyDesktopAnimations();
    } catch (err) {
      // Fail-safe: degrade to lite mode instead of crashing rendering.
      console.error('[Vederra] Cinematic animation disabled due to runtime error:', err);
      initializeLiteMode();
    }
  }

  function requestDesktopFrame() {
    if (state.mode !== 'desktop' || state.pendingFrame) {
      return;
    }

    state.pendingFrame = true;
    state.rafId = requestAnimationFrame(runDesktopFrame);
  }

  function onDesktopScroll() {
    state.latestScrollY = window.scrollY;
    requestDesktopFrame();
  }

  function onSharedResize() {
    const nextMode = shouldUseLiteMode() ? 'lite' : 'desktop';
    if (nextMode !== state.mode) {
      if (nextMode === 'lite') {
        initializeLiteMode();
      } else {
        initializeDesktopMode();
      }
      return;
    }

    if (state.mode === 'desktop') {
      measureSections();
      state.latestScrollY = window.scrollY;
      requestDesktopFrame();
    }
  }

  function resetDesktopTransforms() {
    if (heroBg) {
      heroBg.style.transform = 'none';
    }

    cinEls.forEach((el) => {
      el.style.opacity = '';
      el.style.transform = '';
    });

    if (craneBoom) craneBoom.style.transform = '';
    if (craneModule) {
      craneModule.style.opacity = '';
      craneModule.style.transform = '';
    }
    if (craneCable) craneCable.setAttribute('y2', '180');
    if (craneHook) craneHook.setAttribute('transform', 'translate(320,180)');

    // Unpin the advantage stage and restore the static (fully visible) layout.
    if (advantageSection) advantageSection.classList.remove('is-pinned');
    if (craneSvg) craneSvg.style.opacity = '';
    if (advantageLabel) {
      advantageLabel.style.opacity = '';
      advantageLabel.style.transform = '';
    }
    if (advantageLead) {
      advantageLead.style.opacity = '';
      advantageLead.style.transform = '';
    }
    if (craneCableConnector) {
      craneCableConnector.style.opacity = '';
      craneCableConnector.style.height = '';
    }
    craneLines.forEach((line) => {
      line.style.opacity = '';
      line.style.transform = '';
    });
  }

  function setupLiteRevealObserver() {
    if (!cinEls.length || typeof IntersectionObserver !== 'function') {
      cinEls.forEach((el) => el.classList.add('cin-visible'));
      return;
    }

    state.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const delay = clamp(safeNumber(entry.target.dataset.cinDelay, 0), 0, 0.9);
        const timeoutId = window.setTimeout(() => {
          entry.target.classList.add('cin-visible');
          state.observerTimeouts.delete(timeoutId);
        }, delay * 450);

        state.observerTimeouts.add(timeoutId);
        if (state.observer) {
          state.observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

    cinEls.forEach((el) => {
      el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      state.observer.observe(el);
    });
  }

  function initializeDesktopMode() {
    cleanupCurrentMode();
    state.mode = 'desktop';

    // Activate pinning BEFORE measuring so the tall (300vh) track height is captured.
    if (advantageSection) advantageSection.classList.add('is-pinned');

    cinEls.forEach((el) => {
      el.classList.remove('cin-visible');
      el.style.transition = 'none';
    });

    measureSections();
    state.latestScrollY = window.scrollY;

    const abortController = new AbortController();
    state.listenersAbort = abortController;

    window.addEventListener('scroll', onDesktopScroll, { passive: true, signal: abortController.signal });
    window.addEventListener('resize', onSharedResize, { passive: true, signal: abortController.signal });

    if (typeof prefersReduced.addEventListener === 'function') {
      prefersReduced.addEventListener('change', onSharedResize, { signal: abortController.signal });
    }

    // Premium animation modules (desktop only)
    setupScrollProgressBar();
    setupHeroMouseParallax();
    setupCardTilt();
    setupCounters();
    setupMagneticButtons();

    requestDesktopFrame();
  }

  function initializeLiteMode() {
    cleanupCurrentMode();
    state.mode = 'lite';

    resetDesktopTransforms();
    setupLiteRevealObserver();
    setHeaderState();
    setupScrollProgressBar();

    if (craneModule) {
      craneModule.style.opacity = '0.8';
      craneModule.style.transform = 'none';
    }

    const abortController = new AbortController();
    state.listenersAbort = abortController;

    window.addEventListener('scroll', setHeaderState, { passive: true, signal: abortController.signal });
    window.addEventListener('resize', onSharedResize, { passive: true, signal: abortController.signal });

    if (typeof prefersReduced.addEventListener === 'function') {
      prefersReduced.addEventListener('change', onSharedResize, { signal: abortController.signal });
    }
  }

  // Boot mode based on viewport + user preference + CPU capability.
  if (shouldUseLiteMode()) {
    initializeLiteMode();
  } else {
    initializeDesktopMode();
  }

  // Auto-rotating hero images (homepage) — gentle crossfade loop
  setupHeroSlideshow();

  // Fallback for legacy browsers using MediaQueryList#addListener.
  if (typeof prefersReduced.addEventListener !== 'function' && typeof prefersReduced.addListener === 'function') {
    prefersReduced.addListener(onSharedResize);
  }

  // ─── HERO SLIDESHOW (auto crossfade between hero images) ───
  function setupHeroSlideshow() {
    const slides = Array.from(document.querySelectorAll('.hero-slide'));
    if (slides.length < 2) return;
    if (prefersReduced.matches) return; // keep a single static image
    let idx = 0;
    window.setInterval(() => {
      slides[idx].classList.remove('is-active');
      idx = (idx + 1) % slides.length;
      slides[idx].classList.add('is-active');
    }, 5000);
  }

  // ─── SCROLL PROGRESS BAR ───
  function setupScrollProgressBar() {
    if (document.querySelector('.scroll-progress-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress-bar';
    document.body.prepend(bar);

    function updateBar() {
      const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const pct = clamp((window.scrollY / scrollable) * 100, 0, 100);
      document.documentElement.style.setProperty('--scroll-pct', pct + '%');
    }

    window.addEventListener('scroll', updateBar, { passive: true });
    updateBar();
  }

  // ─── HERO MOUSE PARALLAX ───
  function setupHeroMouseParallax() {
    const heroSection = document.querySelector('.hero');
    if (!heroSection || !heroBg) return;

    const heroContent = heroSection.querySelector('.hero-content');
    const kicker = heroSection.querySelector('.hero-kicker');
    const h1 = heroSection.querySelector('h1');
    const sub = heroSection.querySelector('.hero-sub');
    const actions = heroSection.querySelector('.hero-actions');

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let rafRunning = false;

    function animateParallax() {
      currentX = lerp(currentX, targetX, 0.06);
      currentY = lerp(currentY, targetY, 0.06);

      if (heroBg) {
        heroBg.style.transform = `translate3d(${-currentX * 15}px, ${-currentY * 10}px, 0) scale(1.06)`;
      }
      if (kicker) kicker.style.transform = `translate3d(${currentX * 4}px, ${currentY * 3}px, 0)`;
      if (h1) h1.style.transform = `translate3d(${currentX * 6}px, ${currentY * 4}px, 0)`;
      if (sub) sub.style.transform = `translate3d(${currentX * 5}px, ${currentY * 3.5}px, 0)`;
      if (actions) actions.style.transform = `translate3d(${currentX * 3}px, ${currentY * 2}px, 0)`;

      if (Math.abs(currentX - targetX) > 0.05 || Math.abs(currentY - targetY) > 0.05) {
        requestAnimationFrame(animateParallax);
      } else {
        rafRunning = false;
      }
    }

    heroSection.addEventListener('mousemove', (e) => {
      const rect = heroSection.getBoundingClientRect();
      targetX = clamp((e.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
      targetY = clamp((e.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
      if (!rafRunning) {
        rafRunning = true;
        requestAnimationFrame(animateParallax);
      }
    });

    heroSection.addEventListener('mouseleave', () => {
      targetX = 0;
      targetY = 0;
      if (!rafRunning) {
        rafRunning = true;
        requestAnimationFrame(animateParallax);
      }
    });
  }

  // ─── 3D CARD TILT ───
  function setupCardTilt() {
    const cards = document.querySelectorAll('.pillar-card');
    cards.forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        const rotX = clamp(-y * 14, -7, 7);
        const rotY = clamp(x * 14, -7, 7);
        card.classList.add('tilt-active');
        card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.02,1.02,1.02)`;
        card.style.boxShadow = `${-rotY * 2}px ${rotX * 2}px 30px rgba(23,145,219,0.18), 0 20px 50px rgba(10,35,65,0.12)`;
      });

      card.addEventListener('mouseleave', () => {
        card.classList.remove('tilt-active');
        card.style.transform = '';
        card.style.boxShadow = '';
      });
    });
  }

  // ─── COUNTER ANIMATION ───
  function setupCounters() {
    // Wrap target numbers in countable spans
    const advantageText = document.querySelector('.advantage-lead strong');
    const expertiseH2 = document.querySelector('.expertise-text h2');

    function wrapCounter(el, targetVal, suffix) {
      if (!el || el.dataset.counterDone) return;
      el.dataset.counterDone = 'true';
      el.dataset.counterTarget = targetVal;
      el.dataset.counterSuffix = suffix;
      el.classList.add('stat-counter');
    }

    if (advantageText) wrapCounter(advantageText, 500000, ' sq ft');
    if (expertiseH2) {
      // Find the "35" in the text and animate it counting up
      expertiseH2.innerHTML = expertiseH2.innerHTML.replace('35', '<strong class="stat-counter" data-counter-target="35" data-counter-suffix="">35</strong>');
    }

    function animateCounter(el) {
      if (el.dataset.animating) return;
      el.dataset.animating = 'true';
      const target = parseInt(el.dataset.counterTarget, 10);
      const suffix = el.dataset.counterSuffix || '';
      const duration = 1800;
      const start = performance.now();

      function tick(now) {
        const elapsed = now - start;
        const progress = clamp(elapsed / duration, 0, 1);
        const eased = easeOutCubic(progress);
        const current = Math.round(eased * target);
        el.textContent = current >= 1000
          ? current.toLocaleString() + suffix
          : current + suffix;
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    if (typeof IntersectionObserver === 'function') {
      const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });

      document.querySelectorAll('.stat-counter').forEach((el) => counterObserver.observe(el));
    }
  }

  // ─── MAGNETIC BUTTONS ───
  function setupMagneticButtons() {
    const buttons = document.querySelectorAll('.btn-primary');
    buttons.forEach((btn) => {
      let rafId = 0;
      let tx = 0, ty = 0;
      let cx = 0, cy = 0;

      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const bx = rect.left + rect.width / 2;
        const by = rect.top + rect.height / 2;
        tx = clamp((e.clientX - bx) * 0.3, -12, 12);
        ty = clamp((e.clientY - by) * 0.3, -8, 8);
      });

      btn.addEventListener('mouseleave', () => { tx = 0; ty = 0; });

      function animateMagnet() {
        cx = lerp(cx, tx, 0.14);
        cy = lerp(cy, ty, 0.14);
        btn.style.transform = `translate(${cx}px, ${cy}px)`;
        rafId = requestAnimationFrame(animateMagnet);
      }

      btn.addEventListener('mouseenter', () => {
        cancelAnimationFrame(rafId);
        animateMagnet();
      });

      btn.addEventListener('mouseleave', () => {
        // Let it spring back, then stop
        function springBack() {
          cx = lerp(cx, 0, 0.12);
          cy = lerp(cy, 0, 0.12);
          btn.style.transform = `translate(${cx}px, ${cy}px)`;
          if (Math.abs(cx) > 0.05 || Math.abs(cy) > 0.05) {
            rafId = requestAnimationFrame(springBack);
          } else {
            btn.style.transform = '';
            cancelAnimationFrame(rafId);
          }
        }
        cancelAnimationFrame(rafId);
        springBack();
      });
    });
  }

  // ─── SIMPLE FADE-IN (sub-pages) ───
  function setupSimpleFadeIn() {
    const els = document.querySelectorAll('.cin-el');
    if (!els.length) return;

    if (typeof IntersectionObserver !== 'function') {
      els.forEach((el) => el.classList.add('cin-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('cin-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1 });

    els.forEach((el) => observer.observe(el));
  }

  // ─── SHARED SIMPLE HEADER SCROLL (sub-pages) ───
  function setupSimpleHeaderScroll() {
    if (!header) return;
    setHeaderState();
    window.addEventListener('scroll', setHeaderState, { passive: true });
  }

  // ─── GENERIC SUB-PAGE FX (flashy reveals, heading underline, hover, parallax) ───
  function setupSubpageFX() {
    const main = document.querySelector('main');
    if (!main) return;

    const reduce = prefersReduced.matches;
    const mobile = isMobileViewport();

    // Site-wide extras
    setupScrollProgressBar();
    setupSimpleFadeIn();              // keep existing .cin-el reveals working
    if (!reduce && !mobile) setupMagneticButtons();

    document.body.classList.add('fx-ready');

    // Collect reveal targets (exclude existing .cin-el; keep only outermost)
    const sel = 'h1, h2, .lead, .card, .news-item, .partner-card, .quote-card, figure, .careers-detail-block';
    let candidates = Array.from(main.querySelectorAll(sel)).filter((el) => !el.classList.contains('cin-el'));
    const set = new Set(candidates);
    candidates = candidates.filter((el) => {
      let p = el.parentElement;
      while (p) { if (set.has(p)) return false; p = p.parentElement; }
      return true;
    });

    candidates.forEach((el) => el.classList.add('fx-reveal'));

    // Per-section stagger
    Array.from(main.querySelectorAll('section')).forEach((sec) => {
      candidates.filter((el) => sec.contains(el)).forEach((el, i) => {
        el.style.transitionDelay = Math.min(i * 0.07, 0.42) + 's';
      });
    });

    // Animated underline on headings
    main.querySelectorAll('h1, h2').forEach((h) => {
      if (!h.classList.contains('cin-el')) h.classList.add('fx-heading');
    });

    // Reveal on scroll
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('fx-in'); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      candidates.forEach((el) => io.observe(el));
    } else {
      candidates.forEach((el) => el.classList.add('fx-in'));
    }

    // Sub-page hero background parallax (gap-safe: zoomed layer, clamped travel)
    if (!reduce && !mobile) {
      const layers = Array.from(document.querySelectorAll('.hero-bg.parallax-layer[data-parallax]'));
      if (layers.length) {
        let ticking = false;
        function frame() {
          ticking = false;
          const sy = window.scrollY;
          layers.forEach((l) => {
            const speed = clamp(safeNumber(l.dataset.speed, 0.12), 0, 0.2);
            const h = l.offsetHeight || 420;
            const ty = clamp(sy * speed, -h * 0.09, h * 0.09);
            l.style.transform = `scale(1.2) translate3d(0, ${ty}px, 0)`;
          });
        }
        function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
        frame();
        window.addEventListener('scroll', onScroll, { passive: true });
      }
    }
  }

  // ─── ALT-MOD PAGE (pinned video hero + two-phase panels + reveals + counters) ───
  function setupAltMod() {
    const main = document.querySelector('.altmod-main');
    if (!main) return;

    const reduce = prefersReduced.matches;
    const allowPin = window.innerWidth >= 768 && !reduce;

    main.classList.add('reveal-ready');
    if (allowPin) main.classList.add('is-pinned');

    const heroVideo = main.querySelector('.altmod-hero-video');
    const heroAurora = main.querySelector('.altmod-aurora');
    const heroContent = main.querySelector('.altmod-hero-content');
    const heroLogo = main.querySelector('.altmod-hero-logo');
    const panelsSection = main.querySelector('.altmod-panels');
    const panelLeft = main.querySelector('.altmod-panel-left');
    const panelRight = main.querySelector('.altmod-panel-right');
    const cubesOuter = main.querySelector('.altmod-cubes');
    const cubesInner = main.querySelector('.altmod-cubes-inner');
    const logoAura = main.querySelector('.altmod-logo-aura');
    const panelTitleLeft = panelLeft && panelLeft.querySelector('.altmod-panel-title');
    const panelTitleRight = panelRight && panelRight.querySelector('.altmod-panel-title');

    // Hero logo entrance (scale 0.85 -> 1, fade) on load
    if (!reduce && heroLogo) {
      heroLogo.style.opacity = '0';
      heroLogo.style.transform = 'scale(0.85)';
      requestAnimationFrame(() => {
        heroLogo.style.transition = 'opacity 0.8s var(--ease-out, cubic-bezier(0.16,1,0.3,1)), transform 0.8s var(--ease-out, cubic-bezier(0.16,1,0.3,1))';
        heroLogo.style.opacity = '1';
        heroLogo.style.transform = 'scale(1)';
      });
    }

    // ── Reveals (lines stagger, cards cascade, headings, CTA) ──
    const revealTargets = [];
    main.querySelectorAll('.altmod-line').forEach((el, i) => { el.style.transitionDelay = (i * 0.12) + 's'; revealTargets.push(el); });
    main.querySelectorAll('.altmod-stat').forEach((el) => { el.style.transitionDelay = (safeNumber(el.dataset.card, 0) * 0.15) + 's'; revealTargets.push(el); });
    [main.querySelector('.altmod-adv-label'), main.querySelector('.altmod-adv-title'), main.querySelector('.altmod-cta-inner')].forEach((el) => { if (el) revealTargets.push(el); });

    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
      }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
      revealTargets.forEach((t) => io.observe(t));
    } else {
      revealTargets.forEach((t) => t.classList.add('is-visible'));
    }

    // ── Counters (count up to 15 / 40 on enter) ──
    const counters = Array.from(main.querySelectorAll('.altmod-counter'));
    function runCounter(el) {
      const target = safeNumber(el.dataset.target, 0);
      const suffix = el.dataset.suffix || '';
      if (reduce) { el.textContent = target + suffix; return; }
      const dur = 1200;
      const start = performance.now();
      function tick(now) {
        const p = clamp((now - start) / dur, 0, 1);
        el.textContent = Math.round(easeOutCubic(p) * target) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    if (typeof IntersectionObserver === 'function' && counters.length) {
      const cio = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { runCounter(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.6 });
      counters.forEach((c) => cio.observe(c));
    } else {
      counters.forEach(runCounter);
    }

    // ── Click-to-play video panels ──
    main.querySelectorAll('.altmod-panel').forEach((panel) => {
      const btn = panel.querySelector('.altmod-play');
      const video = panel.querySelector('.altmod-panel-video');
      if (!btn || !video) return;
      btn.addEventListener('click', () => {
        video.setAttribute('controls', '');
        const pr = video.play();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
        btn.classList.add('is-hidden');
      });
    });

    // ── Trippy desktop extras: mouse-reactive aurora + card tilt ──
    const hoverCapable = !reduce && window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (hoverCapable) {
      const aurora = main.querySelector('.altmod-aurora');
      const heroSection = main.querySelector('.altmod-hero');
      if (heroSection) {
        heroSection.addEventListener('mousemove', (e) => {
          const r = heroSection.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          if (aurora) {
            aurora.style.setProperty('--mx', (x * 44) + 'px');
            aurora.style.setProperty('--my', (y * 44) + 'px');
          }
          // Cube field drifts/tilts toward the cursor (3D)
          if (cubesInner) {
            cubesInner.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translate3d(${x * 30}px, ${y * 30}px, 0)`;
          }
          // Orange glow behind the logo parallaxes the opposite way for depth
          if (logoAura) {
            logoAura.style.setProperty('--lx', (-x * 26) + 'px');
            logoAura.style.setProperty('--ly', (-y * 26) + 'px');
          }
        }, { passive: true });
        heroSection.addEventListener('mouseleave', () => {
          if (aurora) { aurora.style.setProperty('--mx', '0px'); aurora.style.setProperty('--my', '0px'); }
          if (cubesInner) cubesInner.style.transform = '';
          if (logoAura) { logoAura.style.setProperty('--lx', '0px'); logoAura.style.setProperty('--ly', '0px'); }
        });
      }
      main.querySelectorAll('.altmod-stat').forEach((card) => {
        card.addEventListener('mousemove', (e) => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          card.classList.add('tilt-active');
          card.style.transform = `perspective(800px) rotateX(${clamp(-y * 12, -8, 8)}deg) rotateY(${clamp(x * 12, -8, 8)}deg) translateY(-4px)`;
        });
        card.addEventListener('mouseleave', () => { card.classList.remove('tilt-active'); card.style.transform = ''; });
      });
    }

    // ── Pinned scroll: hero parallax + text scrub, two-phase panel reveal ──
    if (!allowPin) return;

    let panelsTop = 0;
    let panelsTrack = 1;
    let ticking = false;

    function measure() {
      const vh = Math.max(window.innerHeight, 1);
      if (panelsSection) {
        const r = panelsSection.getBoundingClientRect();
        panelsTop = r.top + window.scrollY;
        panelsTrack = Math.max(1, panelsSection.offsetHeight - vh);
      }
    }

    function frame() {
      ticking = false;
      const vh = Math.max(window.innerHeight, 1);
      const sy = window.scrollY;

      // Hero: video parallax (slower) + content scrub.
      // Color-shift lives on the lightweight aurora layer (not the video) to
      // avoid forcing a full-frame video re-rasterization every scroll tick.
      const hp = clamp(sy / vh, 0, 1);
      if (heroVideo) heroVideo.style.transform = `scale(1.12) translate3d(0, ${hp * 8}%, 0)`;
      if (heroAurora) heroAurora.style.filter = `blur(34px) hue-rotate(${hp * 60}deg)`;
      // Cube field rises + scales as the pinned hero scrolls (depth)
      if (cubesOuter) cubesOuter.style.transform = `translate3d(0, ${-hp * 120}px, 0) scale(${1 + hp * 0.1})`;
      if (heroContent) {
        const f = clamp(hp / 0.7, 0, 1);
        heroContent.style.opacity = String(1 - f);
        heroContent.style.transform = `translate3d(0, ${-f * 60}px, 0) scale(${1 - f * 0.04})`;
      }

      // Panels: phase 1 (left) then phase 2 (right) — slide + scale + 3D rotate,
      // with each title dropping in just ahead of its panel.
      if (panelsSection) {
        const pp = clamp((sy - panelsTop) / panelsTrack, 0, 1);
        const p1 = easeOutCubic(clamp(pp / 0.5, 0, 1));
        const p2 = easeOutCubic(clamp((pp - 0.35) / 0.5, 0, 1));
        if (panelLeft) {
          panelLeft.style.opacity = String(p1);
          panelLeft.style.transform = `translate3d(${lerp(-70, 0, p1)}px, 0, 0) scale(${lerp(0.9, 1, p1)}) rotateY(${lerp(8, 0, p1)}deg)`;
        }
        if (panelTitleLeft) {
          const t1 = easeOutCubic(clamp((pp - 0.08) / 0.4, 0, 1));
          panelTitleLeft.style.opacity = String(t1);
          panelTitleLeft.style.transform = `translateY(${lerp(-24, 0, t1)}px)`;
        }
        if (panelRight) {
          panelRight.style.opacity = String(p2);
          panelRight.style.transform = `translate3d(${lerp(70, 0, p2)}px, 0, 0) scale(${lerp(0.9, 1, p2)}) rotateY(${lerp(-8, 0, p2)}deg)`;
        }
        if (panelTitleRight) {
          const t2 = easeOutCubic(clamp((pp - 0.43) / 0.4, 0, 1));
          panelTitleRight.style.opacity = String(t2);
          panelTitleRight.style.transform = `translateY(${lerp(-24, 0, t2)}px)`;
        }
      }
    }

    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

    measure();
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { measure(); onScroll(); }, { passive: true });
  }

  // ─── GALLERY PAGE — pinned 3D coverflow deck (scroll-driven, filterable) ───
  function setupGallery() {
    const page = document.querySelector('.gallery-page');
    if (!page) return;

    const reduce = prefersReduced.matches;
    const stage = page.querySelector('.deck-stage');
    const deck = page.querySelector('.deck');
    const cards = Array.from(page.querySelectorAll('.deck-card'));
    const tabs = Array.from(page.querySelectorAll('.filter-tab'));
    const counter = page.querySelector('.deck-counter');
    const hint = page.querySelector('.deck-hint');
    if (!stage || !deck || !cards.length) return;

    // ── Lightbox (reused; fed the active-card set) ──
    const lb = document.getElementById('lightbox');
    const lbImg = lb && lb.querySelector('.lightbox-img');
    const btnClose = lb && lb.querySelector('.lightbox-close');
    const btnPrev = lb && lb.querySelector('.lightbox-prev');
    const btnNext = lb && lb.querySelector('.lightbox-next');
    let lbSet = [];
    let lbIndex = 0;
    let lastFocused = null;

    function activeCards() { return cards.filter((c) => c.style.display !== 'none'); }
    function rebuildLightboxSet() {
      lbSet = activeCards().map((fig) => {
        const img = fig.querySelector('img');
        return { el: fig, src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' };
      });
    }
    function showAt(i) {
      if (!lbSet.length || !lbImg) return;
      lbIndex = (i + lbSet.length) % lbSet.length;
      lbImg.setAttribute('src', lbSet[lbIndex].src);
      lbImg.setAttribute('alt', lbSet[lbIndex].alt);
    }
    function openLightbox(fig) {
      if (!lb) return;
      rebuildLightboxSet();
      const i = lbSet.findIndex((x) => x.el === fig);
      if (i < 0) return;
      lastFocused = document.activeElement;
      showAt(i);
      lb.hidden = false;
      document.body.classList.add('lightbox-open');
      void lb.offsetWidth;
      lb.classList.add('is-open');
      if (btnClose) btnClose.focus();
    }
    function closeLightbox() {
      if (!lb) return;
      lb.classList.remove('is-open');
      document.body.classList.remove('lightbox-open');
      window.setTimeout(() => { if (!lb.classList.contains('is-open')) lb.hidden = true; }, 320);
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }
    if (lb) {
      btnClose.addEventListener('click', closeLightbox);
      btnPrev.addEventListener('click', () => showAt(lbIndex - 1));
      btnNext.addEventListener('click', () => showAt(lbIndex + 1));
      lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
      document.addEventListener('keydown', (e) => {
        if (lb.hidden) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowRight') showAt(lbIndex + 1);
        else if (e.key === 'ArrowLeft') showAt(lbIndex - 1);
        else if (e.key === 'Tab') {
          const f = [btnClose, btnPrev, btnNext];
          if (!f.includes(document.activeElement)) { e.preventDefault(); btnClose.focus(); }
        }
      });
    }
    cards.forEach((fig) => {
      fig.addEventListener('click', () => openLightbox(fig));
      fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(fig); } });
    });

    // ── Filter tabs (switch which photos load into the deck) ──
    let activeCat = 'all';
    function applyFilter(cat) {
      activeCat = cat;
      cards.forEach((c) => { c.style.display = (cat === 'all' || c.dataset.category === cat) ? '' : 'none'; });
      tabs.forEach((t) => {
        const on = t.dataset.filter === cat;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      rebuildLightboxSet();
      if (deckMode) { layoutSizing(); window.scrollTo(0, stageTop); position(); }
    }
    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => applyFilter(tab.dataset.filter));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          tabs[(idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].focus();
        }
      });
    });

    rebuildLightboxSet();

    // ── Mode gate: fallback to the CSS grid on mobile / reduced-motion ──
    const deckMode = !reduce && window.innerWidth >= 768;
    if (!deckMode) return; // filters + lightbox already wired; CSS renders the grid

    stage.classList.add('deck-mode');

    const STEP = 0.5; // viewport-heights of scroll per card
    let stageTop = 0;
    let track = 1;
    let vh = 1;
    let targetF = 0;   // deck position the scroll asks for
    let curF = 0;      // eased position actually rendered (decoupled from scroll cadence)
    let rafId = null;

    function layoutSizing() {
      vh = Math.max(window.innerHeight, 1);
      const n = Math.max(1, activeCards().length);
      stage.style.height = ((n * STEP + 1) * vh) + 'px';
      stageTop = stage.getBoundingClientRect().top + window.scrollY;
      track = Math.max(1, stage.offsetHeight - vh);
    }

    function computeTarget() {
      const n = Math.max(1, activeCards().length);
      const pp = clamp((window.scrollY - stageTop) / track, 0, 1);
      targetF = pp * Math.max(0, n - 1);
      if (hint) hint.classList.toggle('is-hidden', pp > 0.02);
    }

    // Draw the deck at the current eased position. Only writes style props
    // that actually changed since last frame so blur/opacity/z-index don't
    // trigger needless repaints while transforms animate every frame.
    function render() {
      const act = activeCards();
      const n = act.length;
      const f = curF;
      act.forEach((card, j) => {
        const off = j - f;
        const a = Math.abs(off);
        const s = card._deck || (card._deck = {});
        if (a > 4.6) {
          if (s.hidden !== true) {
            card.style.opacity = '0'; card.style.pointerEvents = 'none';
            card.style.zIndex = '0'; card.classList.remove('is-front');
            s.hidden = true; s.blur = -1; s.front = false;
          }
          return;
        }
        const tx = off * 300;
        const tz = -Math.min(a, 5) * 240;
        const ry = clamp(-off * 22, -55, 55);
        const sc = Math.max(0.62, 1 - a * 0.12);
        card.style.transform = `translate(-50%, -50%) translate3d(${tx.toFixed(2)}px, 0, ${tz.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
        if (s.hidden !== false) { card.style.opacity = '1'; s.hidden = false; }
        const front = a < 0.5;
        if (s.front !== front) {
          card.style.pointerEvents = front ? 'auto' : 'none';
          card.classList.toggle('is-front', front);
          s.front = front;
        }
        // Quantize blur so we only rewrite the (costly) filter when it steps.
        const blur = a < 0.4 ? 0 : Math.min(Math.round(a * 1.6), 6);
        if (s.blur !== blur) {
          card.style.filter = blur ? `blur(${blur}px)` : 'none';
          s.blur = blur;
        }
      });
      if (counter) counter.textContent = (Math.round(clamp(f, 0, n - 1)) + 1) + ' / ' + n;
    }

    // Ease curF toward targetF each frame; stop the loop once settled.
    function tick() {
      const diff = targetF - curF;
      if (Math.abs(diff) < 0.0015) { curF = targetF; render(); rafId = null; return; }
      curF += diff * 0.16;
      render();
      rafId = requestAnimationFrame(tick);
    }
    function startTick() { if (rafId == null) rafId = requestAnimationFrame(tick); }

    // Instant snap — used on load, resize and filter changes (no easing).
    function position() { computeTarget(); curF = targetF; if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } render(); }

    function onScroll() { computeTarget(); startTick(); }

    layoutSizing();
    position();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', () => { layoutSizing(); position(); }, { passive: true });

    // Keyboard rotate while the pinned deck fills the viewport
    window.addEventListener('keydown', (e) => {
      if (lb && !lb.hidden) return;
      const r = stage.getBoundingClientRect();
      if (!(r.top <= 1 && r.bottom >= vh - 1)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); window.scrollBy(0, STEP * vh); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); window.scrollBy(0, -STEP * vh); }
    });
  }
})();
