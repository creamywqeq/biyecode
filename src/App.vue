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
  if (transitioning.value) return;
  const newTheme: Theme = theme.value === "dark" ? "light" : "dark";
  const btn = themeToggleRef.value;
  const overlay = overlayRef.value;

  if (!btn || !overlay) {
    toggle();
    return;
  }

  transitioning.value = true;
  toTheme.value = newTheme;

  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

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

  const onEnd = (e: TransitionEvent) => {
    if (e.propertyName !== "clip-path") return;
    overlay.removeEventListener("transitionend", onEnd);
    // Apply theme AFTER circle fully covers the screen
    theme.value = newTheme;
    // Brief delay then fade out overlay
    requestAnimationFrame(() => {
      overlay.classList.remove("theme-overlay--visible", "theme-overlay--expanded");
      transitioning.value = false;
    });
  };
  overlay.addEventListener("transitionend", onEnd);
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
    <div ref="overlayRef" class="theme-overlay"></div>
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
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 全局颜色和文字过渡 */
*, *::before, *::after {
  transition-property: color, background-color, border-color, box-shadow, opacity;
  transition-duration: 0.45s;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
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

/* ---- 圆形展开遮罩：主题切换动画 ---- */
.theme-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  pointer-events: none;
  --clip-x: 50%;
  --clip-y: 50%;
  opacity: 0;
  clip-path: circle(0 at var(--clip-x) var(--clip-y));
  transition:
    clip-path 0.7s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.15s ease;
  will-change: clip-path, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
  contain: strict;
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
    linear-gradient(rgba(59, 130, 246, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
}

/* ---- iOS 风格主题切换按钮 ---- */
.theme-toggle {
  position: fixed;
  top: 64px;
  right: 16px;
  z-index: 9999;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-panel);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  color: var(--text-primary);
  font-size: 19px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), var(--glass-inner-glow);
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.35s ease,
    background 0.45s ease,
    border-color 0.45s ease;
}
.theme-toggle:hover {
  transform: scale(1.12);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), 0 0 0 2px var(--accent);
}
.theme-toggle:active {
  transform: scale(0.92);
}
.theme-toggle span {
  display: inline-block;
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.theme-toggle:hover span {
  transform: rotate(20deg);
}

/* ---- 页面过渡 ---- */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}
.page-enter-from {
  opacity: 0;
  transform: scale(0.98) translateY(8px);
}
.page-leave-to {
  opacity: 0;
  transform: scale(0.98) translateY(-8px);
}
</style>
