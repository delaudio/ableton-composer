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
  toggle.addEventListener('click', () => {
    nav.classList.toggle('hidden');
  });

  if (window.innerWidth < 1024) {
    nav.classList.add('hidden');
  }
}
