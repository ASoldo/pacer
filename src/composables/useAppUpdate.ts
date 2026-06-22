import { computed, ref } from 'vue'
import { registerSW } from 'virtual:pwa-register'

const version = __APP_VERSION__
const buildStamp = __BUILD_STAMP__
const buildCommit = __BUILD_COMMIT__
const needRefresh = ref(false)
const offlineReady = ref(false)
const checking = ref(false)
const registrationReady = ref(false)
const updateError = ref<string | null>(null)
const lastCheckedAt = ref<number | null>(null)
const latestVersion = ref(version)
const latestBuildStamp = ref(buildStamp)

let registered = false
let updateServiceWorker: ReturnType<typeof registerSW> | null = null
let serviceWorkerRegistration: ServiceWorkerRegistration | undefined
let updateTimer: number | null = null
let listeningForVisibility = false

function formatDateTime(value: string | number | null) {
  if (!value) return 'Not checked'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const buildDateLabel = computed(() => formatDateTime(buildStamp))
const lastCheckedLabel = computed(() => formatDateTime(lastCheckedAt.value))
const shortCommit = computed(() => (buildCommit.length > 12 ? buildCommit.slice(0, 12) : buildCommit))

function setUpdateReady() {
  needRefresh.value = true
  offlineReady.value = false
  updateError.value = null
}

function updateErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'Update check failed.'
}

async function checkLiveVersion() {
  const response = await fetch(`/version.json?ts=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  })
  if (!response.ok) return

  const payload = (await response.json()) as {
    version?: string
    buildStamp?: string
  }
  if (!payload.version) return

  latestVersion.value = payload.version
  latestBuildStamp.value = payload.buildStamp ?? ''
  if (payload.version !== version || (payload.buildStamp && payload.buildStamp !== buildStamp)) {
    setUpdateReady()
  }
}

async function checkForUpdate() {
  if (checking.value) return

  checking.value = true
  updateError.value = null
  try {
    await checkLiveVersion()
    await serviceWorkerRegistration?.update()
    lastCheckedAt.value = Date.now()
  } catch (error) {
    updateError.value = updateErrorMessage(error)
  } finally {
    checking.value = false
  }
}

async function applyUpdate() {
  updateError.value = null
  try {
    if (updateServiceWorker) {
      await updateServiceWorker(true)
    }
    window.location.reload()
  } catch (error) {
    updateError.value = updateErrorMessage(error)
  }
}

function dismissUpdate() {
  needRefresh.value = false
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void checkForUpdate()
}

function startUpdateChecks() {
  if (!serviceWorkerRegistration) return

  if (updateTimer === null) {
    updateTimer = window.setInterval(() => {
      void checkForUpdate()
    }, 60_000)
  }

  if (!listeningForVisibility) {
    listeningForVisibility = true
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
}

function unregisterDevelopmentWorkers() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister()
    })
  })
}

function registerAppServiceWorker() {
  if (registered) return
  registered = true

  if (!import.meta.env.PROD) {
    unregisterDevelopmentWorkers()
    return
  }

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: setUpdateReady,
    onNeedReload: () => window.location.reload(),
    onOfflineReady: () => {
      offlineReady.value = true
    },
    onRegisteredSW: (_swUrl, registration) => {
      serviceWorkerRegistration = registration
      registrationReady.value = Boolean(registration)
      startUpdateChecks()
      void checkForUpdate()
    },
    onRegisterError: (error) => {
      updateError.value = updateErrorMessage(error)
    },
  })
}

export function useAppUpdate() {
  return {
    version,
    buildStamp,
    buildDateLabel,
    buildCommit,
    shortCommit,
    latestVersion,
    latestBuildStamp,
    needRefresh,
    offlineReady,
    checking,
    registrationReady,
    updateError,
    lastCheckedAt,
    lastCheckedLabel,
    checkForUpdate,
    applyUpdate,
    dismissUpdate,
    registerAppServiceWorker,
  }
}
