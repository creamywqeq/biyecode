<script setup lang="ts">
import { ref, provide, computed } from "vue";
import FlowAppProvider from "./app/FlowAppProvider.vue";
import TecplotLayout from "./components/TecplotLayout.vue";
import LandingPage from "./components/LandingPage.vue";
import { useTheme, type Theme } from "./composables/useTheme";

const entered = ref(false);
const { theme, toggle } = useTheme();
provide("theme", { theme, toggle });

const themeToggleRef = ref<HTMLButtonElement | null>(null);
const overlayRef = ref<HTMLDivElement | null>(null);
const transitioning = ref(false);
const toTheme = ref<Theme>("light");

const displayIconTheme = computed(() =>
  transitioning.value ? toTheme.value : (theme.value === "dark" ? "light" : "dark"),
);

/* 半透明遮罩，能透出底层流光 */
const BODY_BG: Record<Theme, string> = {
  dark: "linear-gradient(135deg, rgba(15, 20, 25, 0.88) 0%, rgba(26, 31, 46, 0.85) 50%, rgba(13, 17, 23, 0.9) 100%)",
  light: "linear-gradient(135deg, rgba(255, 255, 255, 0.88) 0%, rgba(250, 252, 255, 0.85) 50%, rgba(255, 255, 255, 0.9) 100%)",
};

function handleThemeClick() {
  const newTheme: Theme = theme.value === "dark" ? "light" : "dark";
  if (entered.value) {
    toggle();
    return;
  }
  if (transitioning.value) return;
  const btn = themeToggleRef.value;
  if (!btn || !overlayRef.value) {
    toggle();
    return;
  }
  transitioning.value = true;
  toTheme.value = newTheme;
  theme.value = newTheme;

  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const overlay = overlayRef.value;
  overlay.style.setProperty("--clip-x", `${x}px`);
  overlay.style.setProperty("--clip-y", `${y}px`);
  overlay.style.background = BODY_BG[newTheme];
  overlay.classList.remove("theme-overlay--expanded");
  overlay.classList.add("theme-overlay--visible");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("theme-overlay--expanded");
    });
  });

  overlay.ontransitionend = (e: TransitionEvent) => {
    if (e.propertyName !== "clip-path") return;
    overlay.ontransitionend = null;
    overlay.classList.remove("theme-overlay--visible", "theme-overlay--expanded");
    transitioning.value = false;
  };
}
</script>

<template>
  <div class="app-root">
    <button
      ref="themeToggleRef"
      class="theme-toggle"
      :title="displayIconTheme === 'light' ? '切换至白昼模式' : '切换至黑夜模式'"
      @click="handleThemeClick"
    >
      <span v-if="displayIconTheme === 'light'">☀</span>
      <span v-else>🌙</span>
    </button>
    <div v-if="!entered" ref="overlayRef" class="theme-overlay"></div>
    <div class="content-stack">
      <Transition name="page" mode="out-in">
        <LandingPage v-if="!entered" @enter="entered = true" />
        <FlowAppProvider v-else>
          <TecplotLayout />
        </FlowAppProvider>
      </Transition>
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
}
body {
  background: var(--body-bg);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  transition: background 0.4s ease;
}

.app-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.content-stack {
  position: relative;
  z-index: 100;
  width: 100%;
  height: 100%;
}

.theme-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  pointer-events: none;
  --clip-x: 50%;
  --clip-y: 50%;
  opacity: 0;
  clip-path: circle(0 at var(--clip-x) var(--clip-y));
  transition: clip-path 0.85s cubic-bezier(0.33, 1, 0.68, 1), opacity 0.12s ease;
  will-change: clip-path;
  transform: translateZ(0);
  backface-visibility: hidden;
}
.theme-overlay.theme-overlay--visible {
  opacity: 1;
}
.theme-overlay.theme-overlay--expanded {
  clip-path: circle(150vmax at var(--clip-x) var(--clip-y));
}

.theme-overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(59, 130, 246, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59, 130, 246, 0.04) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
}

.theme-toggle {
  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 9999;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-panel);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--text-primary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s, color 0.3s ease, border-color 0.3s ease, background 0.3s ease;
}
.theme-toggle:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.page-enter-active,
.page-leave-active {
  transition: opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
.page-enter-from,
.page-leave-to {
  opacity: 0;
}
</style>
