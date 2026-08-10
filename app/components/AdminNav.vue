<template>
  <div class="admin-nav">
    <button class="admin-nav-toggle" type="button" @click="toggleNav">
      <span class="admin-nav-icon">☰</span>
      <span class="sr-only">Toggle admin navigation</span>
    </button>

    <div v-if="isOpen" class="admin-nav-overlay" @click="closeNav"></div>
    <aside class="admin-nav-panel" :class="{ open: isOpen }" aria-label="Admin navigation">
      <div class="admin-nav-header">
        <span class="admin-nav-title">Admin</span>
        <button class="admin-nav-close" type="button" @click="closeNav">Close</button>
      </div>
      <nav class="admin-nav-links">
        <a
          v-for="link in links"
          :key="link.href"
          :href="link.href"
          :class="{ active: route.path === link.href }"
          @click="closeNav"
        >
          {{ link.label }}
        </a>
      </nav>
    </aside>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const route = useRoute()
const isOpen = ref(false)

const links = [
  { label: 'Admin Home', href: '/admin' },
  { label: 'Analytics', href: '/admin/analytics' },
  { label: 'Block Maker', href: '/admin/block-maker' },
  { label: 'Settings', href: '/admin/settings' }
]

function toggleNav() {
  isOpen.value = !isOpen.value
}

function closeNav() {
  isOpen.value = false
}

watch(
  () => route.path,
  () => {
    closeNav()
  }
)
</script>

<style scoped>
.admin-nav {
  position: relative;
  z-index: 40;
  display: flex;
  align-items: center;
  padding: 10px 0px;
  margin: 0 0 12px;
}

.admin-nav-toggle {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--cr-line-3);
  background: rgba(17, 22, 28, 0.9);
  color: var(--cr-accent);
  font-size: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.admin-nav-overlay {
  position: fixed;
  inset: 0;
  background: rgba(3, 6, 10, 0.6);
  z-index: 41;
}

.admin-nav-panel {
  position: fixed;
  top: 0;
  left: 0;
  height: 100%;
  width: min(320px, 82vw);
  background: var(--cr-surface-2);
  border-right: 2px solid var(--cr-line-3);
  box-shadow: 12px 0 24px rgba(0, 0, 0, 0.5);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
  z-index: 42;
  display: flex;
  flex-direction: column;
  padding: 18px;
  gap: 18px;
}

.admin-nav-panel.open {
  transform: translateX(0);
}

.admin-nav-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.admin-nav-title {
  font-size: 18px;
  letter-spacing: 2px;
  color: var(--cr-accent);
  font-family: var(--cr-font);
}

.admin-nav-close {
  border: 1px solid var(--cr-line-3);
  background: transparent;
  color: var(--cr-text);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.admin-nav-links {
  display: grid;
  gap: 10px;
}

.admin-nav-links a {
  text-decoration: none;
  color: var(--cr-text);
  border-radius: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  font-family: var(--cr-font);
  letter-spacing: 1px;
}

.admin-nav-links a.active {
  border-color: var(--cr-line-3);
  color: var(--cr-accent);
  background: rgba(159, 224, 255, 0.08);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
