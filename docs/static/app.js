const normalizePath = path => {
  if (!path || path === '/') return '/index.html';
  return path;
};

const currentPath = normalizePath(window.location.pathname);

for (const link of document.querySelectorAll('.doc-link')) {
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http')) continue;
  if (normalizePath(href) === currentPath) link.classList.add('is-active');
}

const nav = document.getElementById('site-nav');
const toggle = document.getElementById('nav-toggle');

if (nav && toggle) {
  const setMobileState = open => {
    if (window.innerWidth >= 1024) {
      nav.classList.remove('hidden');
      document.body.classList.remove('overflow-hidden');
      return;
    }
    nav.classList.toggle('hidden', !open);
    document.body.classList.toggle('overflow-hidden', open);
  };

  toggle.addEventListener('click', () => {
    setMobileState(nav.classList.contains('hidden'));
  });

  if (window.innerWidth < 1024) {
    setMobileState(false);
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) {
      setMobileState(true);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMobileState(false);
  });

  for (const link of nav.querySelectorAll('a')) {
    link.addEventListener('click', () => {
      if (window.innerWidth < 1024) setMobileState(false);
    });
  }
}
