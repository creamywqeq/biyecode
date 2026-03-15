<script setup lang="ts">
defineEmits<{
  enter: [];
}>();

</script>

<template>
  <div class="landing">
    <!-- 底层：流光 -->
    <div class="landing-flow"></div>
    <div class="landing-blur"></div>
    <div class="landing-grid"></div>
    <!-- 顶层：文字内容 -->
    <div class="landing-content">
      <div class="brand">FlowPost</div>
      <h1 class="title">流场后处理系统</h1>
      <p class="desc">
        Web 端 CFD 可视化 · 支持 Tecplot 数据解析、切片、等值面、探针查询
      </p>
      <p class="tech">Vue 3 · Three.js · 轻量跨平台</p>
      <button class="cta" @click="$emit('enter')">
        <span class="cta-text">进入应用</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
      <p class="credit">
        设计 · 杨宇航
        <a href="mailto:2067732712@qq.com">2067732712@qq.com</a>
      </p>
    </div>
  </div>
</template>

<style scoped>
.landing {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: background 0.5s ease;
}

.landing-flow {
  position: absolute;
  z-index: 1;
  inset: -80%;
  width: 260%;
  height: 260%;
  background:
    radial-gradient(
      ellipse 40% 60% at 30% 20%,
      rgba(34, 211, 238, 0.32) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse 50% 35% at 70% 80%,
      rgba(168, 85, 247, 0.3) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse 35% 50% at 15% 70%,
      rgba(236, 72, 153, 0.26) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse 45% 45% at 55% 40%,
      rgba(59, 130, 246, 0.28) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse 38% 52% at 85% 15%,
      rgba(251, 146, 60, 0.24) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse 42% 48% at 10% 40%,
      rgba(34, 197, 94, 0.22) 0%,
      transparent 45%
    );
  animation: flow-liquid-1 22s ease-in-out infinite;
  will-change: transform;
}

.landing-flow::before {
  content: "";
  position: absolute;
  inset: -30%;
  background:
    radial-gradient(
      ellipse 60% 40% at 80% 25%,
      rgba(99, 102, 241, 0.28) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse 45% 55% at 25% 85%,
      rgba(14, 165, 233, 0.26) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse 50% 50% at 50% 50%,
      rgba(244, 114, 182, 0.2) 0%,
      transparent 40%
    ),
    radial-gradient(
      ellipse 55% 45% at 65% 70%,
      rgba(250, 204, 21, 0.2) 0%,
      transparent 42%
    ),
    radial-gradient(
      ellipse 48% 52% at 20% 25%,
      rgba(20, 184, 166, 0.22) 0%,
      transparent 45%
    ),
    radial-gradient(
      ellipse 42% 58% at 90% 55%,
      rgba(239, 68, 68, 0.18) 0%,
      transparent 42%
    );
  animation: flow-liquid-2 18s ease-in-out infinite;
  will-change: transform;
}

.landing-flow::after {
  content: "";
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(
      ellipse 55% 45% at 60% 50%,
      rgba(96, 165, 250, 0.24) 0%,
      transparent 40%
    ),
    radial-gradient(
      ellipse 40% 60% at 20% 50%,
      rgba(167, 139, 250, 0.22) 0%,
      transparent 40%
    ),
    radial-gradient(
      ellipse 50% 50% at 75% 35%,
      rgba(192, 132, 252, 0.2) 0%,
      transparent 40%
    ),
    radial-gradient(
      ellipse 45% 55% at 35% 80%,
      rgba(6, 182, 212, 0.2) 0%,
      transparent 42%
    ),
    radial-gradient(
      ellipse 52% 48% at 50% 20%,
      rgba(249, 115, 22, 0.18) 0%,
      transparent 40%
    );
  animation: flow-liquid-3 25s ease-in-out infinite;
  will-change: transform;
}

@keyframes flow-liquid-1 {
  0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
  20% { transform: translate(8%, -5%) rotate(15deg) scale(1.08); }
  40% { transform: translate(-6%, 7%) rotate(-12deg) scale(0.95); }
  60% { transform: translate(-4%, -8%) rotate(8deg) scale(1.05); }
  80% { transform: translate(5%, 4%) rotate(-5deg) scale(0.98); }
}

@keyframes flow-liquid-2 {
  0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
  25% { transform: translate(-7%, 3%) scale(1.1) rotate(10deg); }
  50% { transform: translate(4%, -6%) scale(0.92) rotate(-8deg); }
  75% { transform: translate(6%, 5%) scale(1.03) rotate(5deg); }
}

@keyframes flow-liquid-3 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(-5%, -4%) scale(1.06); }
  66% { transform: translate(6%, 3%) scale(0.94); }
}

.landing-blur {
  position: absolute;
  z-index: 1;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(10, 14, 20, 0.6) 0%,
    rgba(17, 24, 39, 0.55) 50%,
    rgba(13, 17, 23, 0.65) 100%
  );
  backdrop-filter: blur(70px) saturate(140%);
  -webkit-backdrop-filter: blur(70px) saturate(140%);
}

.landing-grid {
  position: absolute;
  z-index: 1;
  inset: 0;
  opacity: 0.35;
  background-image:
    linear-gradient(var(--landing-bg-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--landing-bg-grid) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
}

.landing-content {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 48px 32px;
  max-width: 420px;
}

.brand {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: var(--landing-brand);
  margin-bottom: 24px;
  transition: color 0.35s ease;
}

.title {
  font-size: 32px;
  font-weight: 600;
  color: var(--landing-title);
  letter-spacing: -0.03em;
  line-height: 1.2;
  margin-bottom: 16px;
  transition: color 0.35s ease;
}

.desc {
  font-size: 15px;
  color: var(--landing-desc);
  line-height: 1.6;
  margin-bottom: 12px;
  transition: color 0.35s ease;
}

.tech {
  font-size: 13px;
  color: var(--landing-tech);
  margin-bottom: 40px;
  transition: color 0.35s ease;
}

.cta {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 28px;
  font-size: 15px;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.35);
}

.cta::before {
  content: "";
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.35),
    transparent
  );
  opacity: 0;
  transition: opacity 0.3s ease;
}

.cta:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(59, 130, 246, 0.5), 0 0 40px rgba(59, 130, 246, 0.2);
}

.cta:hover::before {
  opacity: 1;
  animation: cta-shine 0.9s ease;
}

@keyframes cta-shine {
  0% { left: -100%; }
  100% { left: 100%; }
}

.cta-text {
  position: relative;
  z-index: 1;
}

.cta svg {
  position: relative;
  z-index: 1;
}

.cta:active {
  transform: translateY(0);
}

.credit {
  margin-top: 48px;
  font-size: 12px;
  color: var(--landing-credit);
  transition: color 0.35s ease;
}

.credit a {
  color: var(--accent);
  text-decoration: none;
  margin-left: 6px;
}

.credit a:hover {
  text-decoration: underline;
}
</style>
