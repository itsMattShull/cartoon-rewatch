<template>
  <div class="analytics-page">
    <AdminNav />
    <header class="analytics-header">
      <div>
        <h1>Analytics</h1>
        <p>Track viewers, visits, and returning audience trends.</p>
      </div>
      <div class="analytics-actions">
        <a v-if="!isAuthorized" class="secondary" href="/api/auth/discord/login?redirect=/admin">
          Sign in with Discord
        </a>
        <button v-if="isAuthorized" class="secondary" type="button" @click="loadAnalytics">
          Refresh
        </button>
      </div>
    </header>

    <section v-if="isAuthorized" class="filters">
      <label class="field">
        <span>Range</span>
        <select v-model="selectedRange">
          <option v-for="option in rangeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Aggregation</span>
        <select v-model="selectedInterval">
          <option v-for="option in intervalOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <span class="status">
        {{ isLoading ? 'Loading analytics...' : `Timezone: ${timezone}` }}
      </span>
    </section>
    <p v-if="isAuthorized && loadError" class="error">{{ loadError }}</p>

    <section v-if="isAuthorized" class="summary">
      <article class="summary-card">
        <span class="summary-label">Total Unique Viewers</span>
        <strong class="summary-value">{{ summary.totalUnique }}</strong>
        <span class="summary-sub">Range: {{ summaryRangeLabel }}</span>
      </article>
      <article class="summary-card">
        <span class="summary-label">Returning Viewers</span>
        <strong class="summary-value">{{ summary.returningPct }}%</strong>
        <span class="summary-sub">{{ summary.newUnique }} new viewers</span>
      </article>
      <article class="summary-card">
        <span class="summary-label">Total Visits</span>
        <strong class="summary-value">{{ summary.totalViews }}</strong>
        <span class="summary-sub">Index page visits</span>
      </article>
      <article class="summary-card">
        <span class="summary-label">Channels Tracked</span>
        <strong class="summary-value">{{ channelSummaries.length }}</strong>
        <span class="summary-sub">Unique viewers by channel</span>
      </article>
    </section>

    <section v-if="isAuthorized" class="charts">
      <ClientOnly>
        <div class="chart-card">
          <div class="chart-header">
            <h2>Total Unique Viewers</h2>
            <span class="chart-sub">{{ aggregationLabel }}</span>
          </div>
          <div class="chart-body">
            <canvas ref="uniqueCanvas"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-header">
            <h2>Returning Viewers (%)</h2>
            <span class="chart-sub">{{ aggregationLabel }}</span>
          </div>
          <div class="chart-body">
            <canvas ref="returningCanvas"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-header">
            <h2>Total Visits</h2>
            <span class="chart-sub">{{ aggregationLabel }}</span>
          </div>
          <div class="chart-body">
            <canvas ref="viewsCanvas"></canvas>
          </div>
        </div>
      </ClientOnly>
    </section>

    <section v-if="isAuthorized" class="channels">
      <div class="section-header">
        <h2>Channel Breakdown</h2>
        <span class="status">{{ channelSummaries.length }} channels</span>
      </div>
      <div v-if="!channelSummaries.length" class="empty">No channel analytics yet.</div>
      <div v-else class="channels-table">
        <div class="table-head">
          <span>Channel</span>
          <span>Unique Viewers</span>
          <span>Total Channel Views</span>
        </div>
        <div v-for="channel in channelSummaries" :key="channel.slug" class="table-row">
          <span>{{ channel.name }}</span>
          <span>{{ channel.unique }}</span>
          <span>{{ channel.views }}</span>
        </div>
      </div>
    </section>

    <section v-else class="locked">
      <h2>Sign in required</h2>
      <p>Only approved Discord accounts can access analytics.</p>
      <a class="primary" href="/api/auth/discord/login?redirect=/admin">Sign in with Discord</a>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const { data: authData } = await useFetch('/api/auth/me')
const isAuthorized = computed(() => authData.value?.authenticated && authData.value?.allowed)

const rangeOptions = [
  { value: '1m', label: 'Last 1 Month' },
  { value: '3m', label: 'Last 3 Months' },
  { value: '6m', label: 'Last 6 Months' },
  { value: '12m', label: 'Last 12 Months' }
]
const intervalOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
]

const selectedRange = ref('1m')
const selectedInterval = ref('daily')
const analyticsData = ref(null)
const isLoading = ref(false)
const loadError = ref('')

const summary = computed(() => {
  return (
    analyticsData.value?.summary || {
      totalUnique: 0,
      totalViews: 0,
      returningPct: 0,
      newUnique: 0
    }
  )
})
const channelSummaries = computed(() => analyticsData.value?.channels || [])
const timezone = computed(() => analyticsData.value?.timezone || 'America/Chicago')
const summaryRangeLabel = computed(() => {
  return rangeOptions.find((option) => option.value === selectedRange.value)?.label || 'Range'
})
const aggregationLabel = computed(() => {
  return intervalOptions.find((option) => option.value === selectedInterval.value)?.label || 'Daily'
})

const uniqueCanvas = ref(null)
const returningCanvas = ref(null)
const viewsCanvas = ref(null)
let uniqueChart = null
let returningChart = null
let viewsChart = null
let ChartLibrary = null

async function ensureChartLibrary() {
  if (!ChartLibrary) {
    const module = await import('chart.js/auto')
    ChartLibrary = module.default || module
  }
  return ChartLibrary
}

function buildChartConfig({ labels, data, label, color, yMax }) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          borderColor: color,
          backgroundColor: `${color}33`,
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          pointHoverRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: yMax
        }
      },
      plugins: {
        legend: {
          display: false
        }
      }
    }
  }
}

async function renderCharts() {
  if (!import.meta.client || !analyticsData.value) return
  const labels = analyticsData.value?.series?.labels || []
  const uniqueSeries = analyticsData.value?.series?.unique || []
  const returningSeries = analyticsData.value?.series?.returningPct || []
  const viewsSeries = analyticsData.value?.series?.views || []

  const Chart = await ensureChartLibrary()

  if (uniqueCanvas.value) {
    if (!uniqueChart) {
      uniqueChart = new Chart(
        uniqueCanvas.value,
        buildChartConfig({
          labels,
          data: uniqueSeries,
          label: 'Unique Viewers',
          color: '#f9d98f'
        })
      )
    } else {
      uniqueChart.data.labels = labels
      uniqueChart.data.datasets[0].data = uniqueSeries
      uniqueChart.update()
    }
  }

  if (returningCanvas.value) {
    if (!returningChart) {
      returningChart = new Chart(
        returningCanvas.value,
        buildChartConfig({
          labels,
          data: returningSeries,
          label: 'Returning %',
          color: '#7fe3ff',
          yMax: 100
        })
      )
    } else {
      returningChart.data.labels = labels
      returningChart.data.datasets[0].data = returningSeries
      returningChart.update()
    }
  }

  if (viewsCanvas.value) {
    if (!viewsChart) {
      viewsChart = new Chart(
        viewsCanvas.value,
        buildChartConfig({
          labels,
          data: viewsSeries,
          label: 'Total Visits',
          color: '#f7a8ff'
        })
      )
    } else {
      viewsChart.data.labels = labels
      viewsChart.data.datasets[0].data = viewsSeries
      viewsChart.update()
    }
  }
}

async function loadAnalytics() {
  if (!isAuthorized.value) return
  isLoading.value = true
  loadError.value = ''
  try {
    analyticsData.value = await $fetch('/api/analytics', {
      query: { range: selectedRange.value, interval: selectedInterval.value }
    })
  } catch (error) {
    loadError.value = 'Failed to load analytics.'
    analyticsData.value = null
  } finally {
    isLoading.value = false
  }
}

watch([isAuthorized, selectedRange, selectedInterval], () => {
  if (isAuthorized.value) {
    loadAnalytics()
  }
})

watch(analyticsData, () => {
  renderCharts()
})

onMounted(() => {
  if (isAuthorized.value) {
    loadAnalytics()
  }
})

onBeforeUnmount(() => {
  if (uniqueChart) uniqueChart.destroy()
  if (returningChart) returningChart.destroy()
  if (viewsChart) viewsChart.destroy()
})
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=VT323&family=Orbitron:wght@400;600&display=swap');

:global(html),
:global(body) {
  margin: 0;
  padding: 0;
  background: #070707;
}

:global(*),
:global(*::before),
:global(*::after) {
  box-sizing: border-box;
}

.analytics-page {
  min-height: 100vh;
  padding: clamp(16px, 4vw, 28px);
  background: radial-gradient(circle at top, #2b2e35 0%, #101015 45%, #070707 100%);
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-radius: 14px;
  border: 2px solid #a88c5a;
  background: linear-gradient(90deg, #1f2024, #2f2b20 60%, #3b2b17);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4);
  margin-bottom: 24px;
}

.analytics-header h1 {
  margin: 0 0 6px 0;
  font-size: 26px;
  letter-spacing: 3px;
  color: #f9d98f;
}

.analytics-header p {
  margin: 0;
  color: #cbb78f;
  font-size: 13px;
  letter-spacing: 1px;
}

.analytics-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 160px;
}

.field span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #d7c7a4;
}

.field select {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #a88c5a;
  background: #141518;
  color: #f7f0d8;
  font-family: 'Orbitron', sans-serif;
}

.status {
  font-size: 12px;
  color: #d7c7a4;
}

.error {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 120, 120, 0.6);
  background: rgba(120, 20, 20, 0.35);
  color: #ffb7b7;
  font-size: 12px;
}

.summary {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin-bottom: 24px;
}

.summary-card {
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid #a88c5a;
  background: rgba(17, 18, 22, 0.8);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: #d7c7a4;
}

.summary-value {
  font-size: 28px;
  color: #fdf0c2;
}

.summary-sub {
  font-size: 12px;
  color: #bfa981;
}

.charts {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  margin-bottom: 24px;
}

.chart-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid #a88c5a;
  background: rgba(12, 13, 16, 0.9);
  height: 280px;
}

.chart-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.chart-body canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}

.chart-header h2 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 1.5px;
  color: #f9d98f;
}

.chart-sub {
  font-size: 11px;
  color: #bfa981;
}

.channels {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-header h2 {
  margin: 0;
  font-size: 20px;
  letter-spacing: 2px;
}

.channels-table {
  display: grid;
  border-radius: 12px;
  border: 1px solid #a88c5a;
  overflow: hidden;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
  gap: 12px;
  padding: 12px 14px;
}

.table-head {
  background: #1f2024;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 2px;
  color: #d7c7a4;
}

.table-row {
  border-top: 1px solid rgba(168, 140, 90, 0.3);
  background: rgba(12, 13, 16, 0.85);
}

.empty {
  padding: 18px;
  border-radius: 12px;
  border: 1px dashed rgba(168, 140, 90, 0.5);
  color: #bfa981;
  text-align: center;
}

.locked {
  text-align: center;
  padding: 40px 16px;
  border-radius: 16px;
  border: 1px solid #a88c5a;
  background: rgba(15, 16, 20, 0.8);
}

.locked h2 {
  margin-bottom: 8px;
  color: #f9d98f;
}

.primary,
.secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #a88c5a;
  text-decoration: none;
  font-family: 'Orbitron', sans-serif;
  cursor: pointer;
}

.primary {
  background: #f9d98f;
  color: #1c1b17;
}

.secondary {
  background: #1f2024;
  color: #f7f0d8;
}
</style>
