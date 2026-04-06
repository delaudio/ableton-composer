// Docusaurus-style documentation features

// Dark mode toggle
const initTheme = () => {
  const theme = localStorage.getItem("theme") || "light";
  document.documentElement.classList.toggle("dark", theme === "dark");
  updateThemeIcons(theme);
};

const updateThemeIcons = (theme) => {
  const darkIcon = document.querySelector(".dark-icon");
  const lightIcon = document.querySelector(".light-icon");
  if (darkIcon && lightIcon) {
    darkIcon.classList.toggle("hidden", theme === "light");
    lightIcon.classList.toggle("hidden", theme === "dark");
  }
};

const themeToggle = document.getElementById("theme-toggle");
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.classList.toggle("dark");
    const theme = isDark ? "dark" : "light";
    localStorage.setItem("theme", theme);
    updateThemeIcons(theme);
  });
}

initTheme();

// Mobile menu toggle
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const mobileSidebar = document.getElementById("mobile-sidebar");
const mobileOverlay = document.getElementById("mobile-overlay");

const openMobileMenu = () => {
  mobileSidebar.classList.remove("translate-x-full");
  mobileOverlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

const closeMobileMenu = () => {
  mobileSidebar.classList.add("translate-x-full");
  mobileOverlay.classList.add("hidden");
  document.body.style.overflow = "";
};

if (mobileMenuToggle) {
  mobileMenuToggle.addEventListener("click", openMobileMenu);
}

if (mobileOverlay) {
  mobileOverlay.addEventListener("click", closeMobileMenu);
}

document.querySelectorAll("#mobile-sidebar a").forEach((link) => {
  link.addEventListener("click", closeMobileMenu);
});

// Collapsible sidebar sections
document.querySelectorAll(".sidebar-category-header").forEach((header) => {
  header.addEventListener("click", () => {
    const category = header.dataset.category;
    const items = document.querySelector(`[data-category-items="${category}"]`);
    const arrow = header.querySelector(".category-arrow");

    items.classList.toggle("hidden");
    arrow.classList.toggle("rotate-180");
  });
});

// Highlight active sidebar link
const normalizePath = (path) => {
  if (!path || path === "/") return "/index.html";
  return path;
};

const currentPath = normalizePath(window.location.pathname);
document.querySelectorAll(".sidebar-link").forEach((link) => {
  const href = link.getAttribute("href");
  if (!href || href.startsWith("http")) return;
  if (normalizePath(href) === currentPath) {
    link.classList.add("active-link");
  }
});

// Generate Table of Contents
const generateTOC = () => {
  const article = document.querySelector("article");
  const tocContent = document.getElementById("toc-content");

  if (!article || !tocContent) return;

  const headings = article.querySelectorAll("h2, h3");
  if (headings.length === 0) {
    tocContent.innerHTML =
      '<p class="text-gray-500 dark:text-gray-400 text-xs">No headings found</p>';
    return;
  }

  const tocHTML = Array.from(headings)
    .map((heading) => {
      const id =
        heading.id ||
        heading.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      heading.id = id;

      const level = heading.tagName === "H2" ? "pl-0" : "pl-4";
      return `<a href="#${id}" class="toc-link block py-1 ${level} text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white">${heading.textContent}</a>`;
    })
    .join("");

  tocContent.innerHTML = tocHTML;
};

generateTOC();

// Highlight TOC link on scroll
const highlightTOCOnScroll = () => {
  const headings = document.querySelectorAll("article h2, article h3");
  const tocLinks = document.querySelectorAll(".toc-link");

  if (headings.length === 0 || tocLinks.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocLinks.forEach((link) => {
            const isActive = link.getAttribute("href") === `#${id}`;
            link.classList.toggle("toc-active", isActive);
          });
        }
      });
    },
    { rootMargin: "-100px 0px -80% 0px" }
  );

  headings.forEach((heading) => observer.observe(heading));
};

highlightTOCOnScroll();

// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.pushState(null, null, this.getAttribute("href"));
    }
  });
});
