<script setup lang="ts">
import type { Theme } from "../composables/useTheme";

defineProps<{
  fromTheme: Theme;
  toTheme: Theme;
  transitioning: boolean;
  expanded: boolean;
  waveX: number;
  waveY: number;
}>();
</script>

<template>
  <div class="theme-transition-root">
    <div class="content-layer content-layer--old" :data-theme="fromTheme">
      <slot />
    </div>
    <div
      v-if="transitioning"
      class="content-layer content-layer--new"
      :class="{ 'content-layer--expanded': expanded }"
      :data-theme="toTheme"
      :style="{
        '--wave-x': `${waveX}px`,
        '--wave-y': `${waveY}px`,
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.theme-transition-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.content-layer {
  position: absolute;
  inset: 0;
}

.content-layer--new {
  pointer-events: none;
  clip-path: circle(0 at var(--wave-x) var(--wave-y));
  transition: clip-path 0.9s cubic-bezier(0.33, 1, 0.68, 1);
}
.content-layer--new.content-layer--expanded {
  clip-path: circle(150vmax at var(--wave-x) var(--wave-y));
}
</style>
