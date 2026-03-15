import { ref, watch, onMounted } from "vue";

export type Theme = "dark" | "light";

const STORAGE_KEY = "flowpost-theme";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getStoredTheme(): Theme | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" ? v : null;
}

export function useTheme() {
  const theme = ref<Theme>(getStoredTheme() ?? getSystemTheme());

  function applyTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
  }

  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  watch(theme, (t) => {
    applyTheme(t);
    localStorage.setItem(STORAGE_KEY, t);
  });

  onMounted(() => {
    applyTheme(theme.value);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!getStoredTheme()) {
        theme.value = e.matches ? "dark" : "light";
      }
    });
  });

  return { theme, toggle };
}
