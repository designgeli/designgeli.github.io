/* Jewelon Bio — site interactions */
(function () {
  document.documentElement.classList.remove('no-js');

  const header = document.querySelector('.site-header');
  const body = document.body;

  /* Header: solid background after scrolling */
  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle('is-solid', y > 24);
    const mcta = document.querySelector('.mobile-cta');
    if (mcta) mcta.classList.toggle('show', y > window.innerHeight * 0.8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Mobile menu */
  const toggle = document.querySelector('.menu-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = body.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('.nav a').forEach((a) =>
      a.addEventListener('click', () => {
        body.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
      })
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && body.classList.contains('menu-open')) {
        body.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* Dropdown (click for touch / small screens) */
  document.querySelectorAll('.nav-drop > button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.parentElement;
      const open = li.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-drop.open').forEach((d) => {
      if (!d.contains(e.target) && window.innerWidth > 1080) {
        d.classList.remove('open');
        d.querySelector('button').setAttribute('aria-expanded', 'false');
      }
    });
  });

  /* Tabs */
  document.querySelectorAll('[data-tabs]').forEach((root) => {
    const btns = Array.from(root.querySelectorAll('[role="tab"]'));
    const select = (btn, focus) => {
      btns.forEach((b) => {
        const on = b === btn;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(b.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) btn.focus();
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => select(b));
      b.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (dir) {
          e.preventDefault();
          select(btns[(i + dir + btns.length) % btns.length], true);
        }
      });
    });
  });

  /* Reveal on scroll + bar charts */
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.add('in');
          en.target.querySelectorAll('.fill[data-w]').forEach((f) => (f.style.width = f.dataset.w));
          io.unobserve(en.target);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    : null;
  document.querySelectorAll('.reveal, .bars').forEach((el) => {
    if (io) io.observe(el);
    else {
      el.classList.add('in');
      el.querySelectorAll('.fill[data-w]').forEach((f) => (f.style.width = f.dataset.w));
    }
  });

  /* Contact form: preselect need type from ?type= and validate */
  const form = document.getElementById('inquiry-form');
  if (form) {
    const type = new URLSearchParams(location.search).get('type');
    if (type) {
      const box = form.querySelector(`input[name="need"][value="${type}"]`);
      if (box) box.checked = true;
    }

    const setInvalid = (field, bad) => field && field.classList.toggle('invalid', bad);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let firstBad = null;

      form.querySelectorAll('[data-required]').forEach((field) => {
        const input = field.querySelector('input, select, textarea');
        let bad = false;
        if (field.dataset.required === 'group') {
          bad = !field.querySelector('input:checked');
        } else if (input.type === 'email') {
          bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
        } else if (input.type === 'checkbox') {
          bad = !input.checked;
        } else {
          bad = !input.value.trim();
        }
        setInvalid(field, bad);
        if (bad && !firstBad) firstBad = field;
      });

      if (firstBad) {
        const target = firstBad.querySelector('input, select, textarea');
        firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (target) target.focus({ preventScroll: true });
        return;
      }

      /* TODO: connect to backend / CRM endpoint. Front-end demo shows success state only. */
      form.hidden = true;
      const ok = document.getElementById('form-success');
      ok.classList.add('show');
      ok.focus();
    });

    form.addEventListener('input', (e) => {
      const field = e.target.closest('.field');
      if (field && field.classList.contains('invalid')) setInvalid(field, false);
    });
    form.addEventListener('change', (e) => {
      const field = e.target.closest('.field');
      if (field && field.classList.contains('invalid')) setInvalid(field, false);
    });
  }

  /* Newsletter (demo) */
  document.querySelectorAll('.newsletter').forEach((f) =>
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = f.querySelector('button');
      btn.textContent = '已訂閱 ✓';
      btn.disabled = true;
    })
  );

  /* Year */
  document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));
})();
