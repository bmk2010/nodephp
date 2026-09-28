const root = document.documentElement;

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/* ---------- theme -------------------------------------------------- */
const media = window.matchMedia("(prefers-color-scheme: dark)");
const saved = store.get("nodephp-theme");
const initial = saved || (media.matches ? "dark" : "light");
applyTheme(initial);
media.addEventListener("change", (e) => {
  if (!store.get("nodephp-theme")) applyTheme(e.matches ? "dark" : "light");
});

function applyTheme(theme) {
  root.classList.toggle("dark", theme === "dark");
  for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
    btn.setAttribute("aria-pressed", String(theme === "dark"));
    btn
      .querySelector("[data-theme-icon]")
      ?.setAttribute("data-active", theme === "dark" ? "1" : "0");
  }
}

for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
  btn.addEventListener("click", () => {
    const next = root.classList.contains("dark") ? "light" : "dark";
    store.set("nodephp-theme", next);
    applyTheme(next);
  });
}

/* ---------- mobile sidebar ----------------------------------------- */
const navBtn = document.querySelector("[data-nav-toggle]");
const sidebar = document.querySelector("[data-sidebar]");

if (navBtn && sidebar) {
  navBtn.addEventListener("click", () => {
    const open = sidebar.classList.toggle("hidden") === false;
    navBtn.setAttribute("aria-expanded", String(open));
  });
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      sidebar.classList.add("hidden");
      navBtn.setAttribute("aria-expanded", "false");
    }
  });
}

/* ---------- copy to clipboard -------------------------------------- */
const i18n = {
  uz: { copy: "Nusxalash", copied: "Kopirlandi" },
  en: { copy: "Copy", copied: "Copied" },
}[root.lang] ?? { copy: "Copy", copied: "Copied" };

for (const wrap of document.querySelectorAll("[data-code]")) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.textContent = i18n.copy;
  btn.addEventListener("click", async () => {
    const code = wrap.querySelector("code")?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.textContent = i18n.copied;
    btn.dataset.copied = "1";
    setTimeout(() => {
      btn.textContent = i18n.copy;
      delete btn.dataset.copied;
    }, 1600);
  });
  wrap.appendChild(btn);
}

/* ---------- scroll spy --------------------------------------------- */
const links = [...document.querySelectorAll(".toc-link[href^='#']")];
const targets = links
  .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
  .filter(Boolean);

if (targets.length && "IntersectionObserver" in window) {
  const visible = new Set();

  const setCurrent = (id) => {
    for (const a of links) {
      const on = a.hash === `#${id}`;
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const first = targets.find((t) => visible.has(t.id));
      if (first) setCurrent(first.id);
    },
    { rootMargin: "-88px 0px -65% 0px", threshold: 0 },
  );

  for (const t of targets) observer.observe(t);
}
