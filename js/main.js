/* Workshop PDP+IA V1 — Apple Experience JS */
document.addEventListener('DOMContentLoaded', () => {
  // Scroll reveals
  const io = new IntersectionObserver(e => {
    e.forEach(x => { if (x.isIntersecting) { x.target.classList.add('is'); io.unobserve(x.target) } })
  }, { threshold: .1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('[data-r],.num,.ic').forEach(e => io.observe(e));

  // Stagger
  document.querySelectorAll('[data-s]').forEach(c => {
    [...c.children].forEach((ch, i) => ch.style.setProperty('--i', i))
  });

  // Sticky nav
  const nav = document.getElementById('sn'), hero = document.getElementById('hero');
  if (nav && hero) {
    new IntersectionObserver(([e]) => nav.classList.toggle('vis', !e.isIntersecting)).observe(hero);
  }

  // Accordion
  document.querySelectorAll('[data-acc]').forEach(t => {
    t.addEventListener('click', () => {
      const c = t.nextElementSibling, ch = t.querySelector('.chv'), open = c.classList.contains('open');
      document.querySelectorAll('.ac.open').forEach(x => { x.classList.remove('open'); x.previousElementSibling.querySelector('.chv')?.classList.remove('rot') });
      if (!open) { c.classList.add('open'); ch?.classList.add('rot') }
    });
  });

  // Pill tabs
  document.querySelectorAll('[data-pill-group]').forEach(group => {
    const tabs = group.querySelectorAll('.pill-tab');
    const panels = document.querySelectorAll('[data-panel]');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.target;
        panels.forEach(p => {
          p.style.opacity = '0';
          p.style.transform = 'translateY(12px)';
          setTimeout(() => {
            p.hidden = p.dataset.panel !== target;
            if (p.dataset.panel === target) {
              setTimeout(() => { p.style.opacity = '1'; p.style.transform = 'none'; }, 50);
            }
          }, 200);
        });
      });
    });
  });

  // Check cards (Para quem é)
  function initCheckCards() {
    const cards = document.querySelectorAll('[data-check]');
    const countEl = document.getElementById('check-count');
    const resultEl = document.getElementById('check-result');
    const ctaEl = document.getElementById('check-cta');
    if (!cards.length || !countEl) return;

    // Show result area after first interaction
    let firstClick = true;

    cards.forEach(card => {
      card.addEventListener('click', () => {
        card.classList.toggle('checked');
        const count = document.querySelectorAll('[data-check].checked').length;
        countEl.textContent = count;

        if (firstClick) {
          resultEl.style.opacity = '1';
          resultEl.style.transform = 'none';
          firstClick = false;
        }

        if (count >= 3) {
          ctaEl.style.display = 'inline-flex';
        } else {
          ctaEl.style.display = 'none';
        }
      });
    });
  }
  initCheckCards();

  // Drag-to-scroll for sliders
  function initDragScroll() {
    document.querySelectorAll('[data-drag-scroll]').forEach(slider => {
      let isDown = false, startX, scrollLeft;
      slider.addEventListener('mousedown', e => {
        isDown = true;
        slider.style.cursor = 'grabbing';
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
      });
      slider.addEventListener('mouseleave', () => { isDown = false; slider.style.cursor = 'grab'; });
      slider.addEventListener('mouseup', () => { isDown = false; slider.style.cursor = 'grab'; });
      slider.addEventListener('mousemove', e => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5;
        slider.scrollLeft = scrollLeft - walk;
      });
    });
  }
  initDragScroll();

  // Loop slider buttons (prev/next with wrap-around)
  function initSliderButtons() {
    document.querySelectorAll('[data-slider-prev]').forEach(btn => {
      btn.addEventListener('click', () => {
        const slider = document.getElementById(btn.dataset.sliderPrev);
        if (!slider) return;
        const cardWidth = slider.querySelector('.snap-start, .snap-center')?.offsetWidth || 360;
        if (slider.scrollLeft <= 10) {
          slider.scrollTo({ left: slider.scrollWidth, behavior: 'smooth' });
        } else {
          slider.scrollBy({ left: -(cardWidth + 20), behavior: 'smooth' });
        }
      });
    });
    document.querySelectorAll('[data-slider-next]').forEach(btn => {
      btn.addEventListener('click', () => {
        const slider = document.getElementById(btn.dataset.sliderNext);
        if (!slider) return;
        const cardWidth = slider.querySelector('.snap-start, .snap-center')?.offsetWidth || 360;
        const maxScroll = slider.scrollWidth - slider.clientWidth;
        if (slider.scrollLeft >= maxScroll - 10) {
          slider.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
          slider.scrollBy({ left: cardWidth + 20, behavior: 'smooth' });
        }
      });
    });
  }
  initSliderButtons();

  // Materials accordion (IA Lab style)
  function initMatAccordion() {
    const items = document.querySelectorAll('[data-mat-item]');
    if (!items.length) return;

    items.forEach((item, i) => {
      const num = String(i + 1).padStart(2, '0');
      item.setAttribute('data-mat-num', num);

      item.addEventListener('click', () => {
        items.forEach(it => it.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }
  initMatAccordion();

  // Animated count-up (data-count-to="2034")
  const countEls = document.querySelectorAll('[data-count-to]');
  if (countEls.length) {
    const countObs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        countObs.unobserve(el);
        const target = parseInt(el.getAttribute('data-count-to'), 10);
        const duration = 1800;
        const start = performance.now();
        function tick(now) {
          const t = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(ease * target).toLocaleString('pt-BR');
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.3 });
    countEls.forEach(el => countObs.observe(el));
  }

  // Price reveal animation
  const priceObs = new IntersectionObserver(e => {
    e.forEach(x => { if (x.isIntersecting) { x.target.classList.add('is'); priceObs.unobserve(x.target); } });
  }, { threshold: 0.3 });
  document.querySelectorAll('.price-num,.price-num-w').forEach(el => priceObs.observe(el));

  // Flip cards (Antes/Depois)
  document.querySelectorAll('.flip-card').forEach(card => {
    card.addEventListener('click', () => card.classList.toggle('flipped'));
  });

  // Image comparison slider (Mão na Massa)
  function initCompareSlider() {
    const container = document.getElementById('render-compare');
    if (!container) return;

    const overlay = container.querySelector('.img-compare-overlay');
    const handle = container.querySelector('.img-compare-handle');
    const overlayImg = overlay.querySelector('img');
    let isDragging = false;

    function setPosition(x) {
      const rect = container.getBoundingClientRect();
      let pos = (x - rect.left) / rect.width;
      pos = Math.max(0.05, Math.min(0.95, pos));
      const pct = pos * 100;
      overlay.style.width = pct + '%';
      handle.style.left = pct + '%';
    }

    // Set overlay img width to match container
    function syncWidth() {
      overlayImg.style.width = container.offsetWidth + 'px';
    }
    syncWidth();
    new ResizeObserver(() => syncWidth()).observe(container);

    // Pointer events (unified mouse + touch)
    container.addEventListener('pointerdown', e => {
      isDragging = true;
      container.setPointerCapture(e.pointerId);
      setPosition(e.clientX);
    });
    container.addEventListener('pointermove', e => {
      if (!isDragging) return;
      setPosition(e.clientX);
    });
    container.addEventListener('pointerup', () => { isDragging = false; });
    container.addEventListener('pointercancel', () => { isDragging = false; });

    // Keyboard accessibility
    handle.addEventListener('keydown', e => {
      if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 5;
      const currentPct = parseFloat(overlay.style.width) || 50;
      const newPct = e.key === 'ArrowLeft'
        ? Math.max(5, currentPct - step)
        : Math.min(95, currentPct + step);
      overlay.style.width = newPct + '%';
      handle.style.left = newPct + '%';
      handle.setAttribute('aria-valuenow', Math.round(newPct));
    });
  }
  initCompareSlider();

  // Flowchart animation: audio → IA badge → workflow (Mão na Massa)
  function initFlowchartAnimation() {
    const container = document.getElementById('flowchart-anim');
    if (!container) return;

    const elements = container.querySelectorAll('[data-fc], [data-fc-line]');
    let triggered = false;

    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !triggered) {
        triggered = true;
        obs.unobserve(container);

        let delay = 0;
        elements.forEach(el => {
          setTimeout(() => el.classList.add('visible'), delay);
          // Slower for key moments, faster for small connectors
          const tag = el.dataset.fc || el.dataset.fcLine || '';
          if (tag === 'audio' || tag === 'ia') delay += 600;
          else if (tag === 'flow') delay += 400;
          else delay += 200;
        });
      }
    }, { threshold: 0.15 });

    obs.observe(container);
  }
  initFlowchartAnimation();

  // Laptop dashboard margin bar fill (Mão na Massa)
  function initLaptopDashboard() {
    const container = document.getElementById('laptop-dashboard');
    if (!container) return;

    const fillBar = container.querySelector('[data-fill]');
    if (!fillBar) return;

    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        fillBar.style.width = fillBar.dataset.fill + '%';
        obs.unobserve(container);
      }
    }, { threshold: 0.2 });

    obs.observe(container);
  }
  initLaptopDashboard();

  // IA automation bars animation
  const iaBars = document.getElementById('ia-bars');
  if (iaBars) {
    const barObs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        iaBars.querySelectorAll('.ia-bar-fill').forEach((bar, i) => {
          setTimeout(() => { bar.style.width = bar.dataset.w + '%'; }, i * 120);
        });
        barObs.unobserve(iaBars);
      }
    }, { threshold: 0.3 });
    barObs.observe(iaBars);
  }

  // Lucide
  if (window.lucide) lucide.createIcons();

  // Counter animation
  initCounters();
});

function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  counters.forEach(el => observer.observe(el));
}

function animateCounter(el) {
  const target = parseInt(el.dataset.count);
  const duration = 2500;
  const start = performance.now();
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const format = el.dataset.format || '';

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);

    let display = '';
    if (format === 'dot') {
      display = current.toLocaleString('pt-BR');
    } else if (format === 'k') {
      display = current >= 1000 ? (current / 1000).toFixed(0) : current;
    } else {
      display = current.toString();
    }

    el.textContent = prefix + display + suffix;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}
