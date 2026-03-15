<script setup lang="ts">
import FlowAppProvider from "./app/FlowAppProvider.vue";
import TecplotLayout from "./components/TecplotLayout.vue";

/**
 * 入口页面（最小可运行版本）
 * - 当前只挂 UI 面板与空 3D 场景
 * - 下一步你只需要把 DataParser 解析后的 FlowDataset 写入 Provider 的 state.dataset，
 *   并设置 state.activeScalar，即可看到线框/云图/切片联动。
 */
</script>

<template>
  <FlowAppProvider>
    <TecplotLayout />
  </FlowAppProvider>
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
  background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 50%, #0d1117 100%);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}
</style>

