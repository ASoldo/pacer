<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  CarFront,
  Download,
  Flag,
  Gauge,
  History,
  Home,
  ListChecks,
  Menu,
  Navigation,
  RefreshCw,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  X,
} from '@lucide/vue'
import { useMediaQuery, useOnline, useRafFn } from '@vueuse/core'
import DriverHud from './components/DriverHud.vue'
import HomePanel from './components/HomePanel.vue'
import MapCanvas from './components/MapCanvas.vue'
import PacerLogo from './components/PacerLogo.vue'
import PaceNotesPanel from './components/PaceNotesPanel.vue'
import RunsPanel from './components/RunsPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import SimulatorPanel from './components/SimulatorPanel.vue'
import StageControls from './components/StageControls.vue'
import VehicleGarage from './components/VehicleGarage.vue'
import VehicleSignal from './components/VehicleSignal.vue'
import { useAppUpdate } from './composables/useAppUpdate'
import { useObdSerial } from './composables/useObdSerial'
import { usePhoneSensors } from './composables/usePhoneSensors'
import { useScreenWakeLock } from './composables/useScreenWakeLock'
import { useSpeech } from './composables/useSpeech'
import { useStageStore } from './stores/stage'
import { useUiStore, type EditorPanel, type StageSubPanel } from './stores/ui'
import type { LatLng, PaceNote } from './types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const stage = useStageStore()
const ui = useUiStore()
const { editorPanel, stageSubPanel } = storeToRefs(ui)
const DriveMapLibre = defineAsyncComponent(() => import('./components/DriveMapLibre.vue'))
const speech = useSpeech()
const obd = useObdSerial()
const phoneSensors = usePhoneSensors()
const screenWakeLock = useScreenWakeLock()
const {
  version: appVersion,
  buildDateLabel: appBuildDateLabel,
  latestVersion: appLatestVersion,
  needRefresh,
  checking: appCheckingForUpdate,
  checkForUpdate: checkAppUpdate,
  applyUpdate: applyAppUpdate,
  dismissUpdate: dismissAppUpdate,
} = useAppUpdate()
const online = useOnline()
const desktopLayout = useMediaQuery('(min-width: 1024px)')
const phoneLayout = useMediaQuery('(max-width: 639px), (max-height: 520px)')
const drawerLayout = computed(() => !desktopLayout.value && !phoneLayout.value)
const theme = ref(localStorage.getItem('rally-theme') ?? 'dark')
const spokenNoteIds = ref<Set<string>>(new Set())
const completedSpeechNoteIds = ref<Set<string>>(new Set())
const queuedSpeechNoteIds = ref<Set<string>>(new Set())
const spokenNoteIdList = computed(() => [...spokenNoteIds.value])
const completedSpeechNoteIdList = computed(() => [...completedSpeechNoteIds.value])
const driveMode = ref(false)
const appMenuOpen = ref(false)
const screenWakeLockActive = screenWakeLock.active
const screenWakeLockStatus = screenWakeLock.status
let gpsWatchId: number | null = null
let permissionStatus: PermissionStatus | null = null
let nextSpeechNoteIndex = 0
let lastPreparedSpeechBucket = -1
const speechRetryCounts = new Map<string, number>()
const speechRetryTimers = new Map<string, number>()

const currentNote = computed(() => stage.nextNote ?? null)
const followingNote = computed(() => stage.followingNote ?? null)
const distanceToCall = computed(() =>
  stage.nextNote ? Math.max(0, stage.nextNote.distance - stage.activeDistanceMeters) : 0,
)
const editorSections = computed(() => [
  { id: 'home' as const, label: 'Home', icon: Home },
  { id: 'garage' as const, label: 'Garage', icon: CarFront },
  { id: 'stage' as const, label: 'Stage', icon: Flag },
  { id: 'history' as const, label: 'Debrief', icon: History },
  { id: 'settings' as const, label: 'Settings', icon: SlidersHorizontal },
])
const stageSections = computed(() => [
  { id: 'route' as const, label: 'Route', shortLabel: 'Route', icon: Flag },
  { id: 'map' as const, label: 'Map', shortLabel: 'Map', icon: Navigation },
  { id: 'notes' as const, label: 'Co-driver', shortLabel: 'Calls', icon: ListChecks },
  { id: 'shakedown' as const, label: 'Shakedown', shortLabel: 'Shake', icon: Gauge },
])
const visibleStageSections = computed(() =>
  desktopLayout.value
    ? stageSections.value.filter((section) => section.id !== 'map')
    : stageSections.value,
)

function setTheme(nextTheme: string) {
  theme.value = nextTheme
}

function addPoint(point: LatLng) {
  stage.addWaypoint(point)
}

function noteTriggerDistance(note: PaceNote) {
  return Math.min(Math.max(note.distance + stage.speech.callOffsetMeters, 0), stage.totalDistance)
}

function resetSpeechTracking() {
  spokenNoteIds.value = new Set()
  completedSpeechNoteIds.value = new Set()
  queuedSpeechNoteIds.value = new Set()
  nextSpeechNoteIndex = 0
  lastPreparedSpeechBucket = -1
  speechRetryCounts.clear()
  speechRetryTimers.forEach((timer) => window.clearTimeout(timer))
  speechRetryTimers.clear()
}

function isSpeechQueued(note: PaceNote) {
  return queuedSpeechNoteIds.value.has(note.id)
}

function triggerDueNotes(currentDistance: number, previousDistance: number) {
  if (currentDistance < previousDistance) {
    resetSpeechTracking()
  }

  if (!stage.activeDriveRunning) return

  const notes = stage.paceNotes
  let firstDueIndex = -1
  let index = Math.max(0, Math.min(nextSpeechNoteIndex, notes.length))
  const startDistance = Math.max(0, previousDistance - 0.25)
  const endDistance = Math.min(stage.totalDistance, currentDistance + 0.25)

  while (index < notes.length) {
    const note = notes[index]
    if (isSpeechQueued(note)) {
      index += 1
      continue
    }

    const triggerDistance = noteTriggerDistance(note)
    if (triggerDistance < startDistance) {
      index += 1
      continue
    }

    if (triggerDistance > endDistance) break

    if (firstDueIndex < 0) firstDueIndex = index
    index += 1
  }

  nextSpeechNoteIndex = index

  if (firstDueIndex >= 0) speakNotesNow(callPackageFromIndex(firstDueIndex))
  prepareUpcomingSpeech(currentDistance)
}

function markSpoken(noteId: string) {
  if (completedSpeechNoteIds.value.has(noteId)) {
    const nextCompleted = new Set(completedSpeechNoteIds.value)
    nextCompleted.delete(noteId)
    completedSpeechNoteIds.value = nextCompleted
  }
  spokenNoteIds.value = new Set([noteId])
}

function completeSpoken(noteId?: string) {
  if (noteId) {
    completedSpeechNoteIds.value = new Set([...completedSpeechNoteIds.value, noteId])
  }

  if (!noteId || spokenNoteIds.value.has(noteId)) {
    spokenNoteIds.value = new Set()
  }
}

function markSpeechQueued(notes: PaceNote[]) {
  queuedSpeechNoteIds.value = new Set([
    ...queuedSpeechNoteIds.value,
    ...notes.map((note) => note.id),
  ])
}

function removeSpeechQueued(noteId: string) {
  if (!queuedSpeechNoteIds.value.has(noteId)) return
  const nextQueued = new Set(queuedSpeechNoteIds.value)
  nextQueued.delete(noteId)
  queuedSpeechNoteIds.value = nextQueued
}

function handleSpeechStart(note: PaceNote) {
  speechRetryCounts.delete(note.id)
  markSpeechQueued([note])
  markSpoken(note.id)
  stage.setSelectedNote(note.id)
}

function retrySpeechNote(note: PaceNote) {
  if (!stage.activeDriveRunning) return
  if (completedSpeechNoteIds.value.has(note.id) || isSpeechQueued(note)) return
  if (note.kind !== 'finish' && note.distance < stage.activeDistanceMeters - 120) return

  speakNotesNow([note])
}

function handleSpeechError(note: PaceNote) {
  removeSpeechQueued(note.id)
  completeSpoken(note.id)

  const retryCount = speechRetryCounts.get(note.id) ?? 0
  if (retryCount >= 1 || !stage.activeDriveRunning) return

  speechRetryCounts.set(note.id, retryCount + 1)
  const existingTimer = speechRetryTimers.get(note.id)
  if (existingTimer) window.clearTimeout(existingTimer)

  const timer = window.setTimeout(() => {
    speechRetryTimers.delete(note.id)
    retrySpeechNote(note)
  }, 450)
  speechRetryTimers.set(note.id, timer)
}

function speakNoteNow(note = currentNote.value) {
  if (!note) return
  const spoken = speech.speakNow(note.text, stage.speech, {
    onStart: () => handleSpeechStart(note),
    onEnd: () => completeSpoken(note.id),
    onError: () => handleSpeechError(note),
  })
  if (spoken) {
    markSpeechQueued([note])
    stage.setSelectedNote(note.id)
  }
}

function noteSpeechText(note: PaceNote) {
  const displayCall = (note.displayCall ?? note.text).trim()
  const distanceCall = note.distanceCall?.trim()

  if (!distanceCall) return displayCall
  if (distanceCall === 'into') return `into ${displayCall}`
  if (distanceCall.endsWith(' into')) return `${distanceCall.replace(' into', '')}, into ${displayCall}`
  return `${distanceCall}, ${displayCall}`
}

function callPackageFromIndex(firstIndex: number) {
  const first = stage.paceNotes[firstIndex]
  if (!first) return []

  const packageDistance = Math.max(170, Math.abs(stage.speech.callOffsetMeters) * 1.35)
  const notes: PaceNote[] = []

  for (let index = firstIndex; index < stage.paceNotes.length && notes.length < 3; index += 1) {
    const note = stage.paceNotes[index]
    if (isSpeechQueued(note)) continue
    if (note.distance < first.distance) continue
    if (note.distance - first.distance > packageDistance) break
    notes.push(note)
  }

  return notes
}

function speakNotesNow(notes: PaceNote[]) {
  if (notes.length === 0) return
  const spoken = speech.speakDriveSequence(
    notes.map((note) => ({
      text: noteSpeechText(note),
      onStart: () => handleSpeechStart(note),
      onEnd: () => completeSpoken(note.id),
      onError: () => handleSpeechError(note),
    })),
    stage.speech,
  )
  if (!spoken) return

  markSpeechQueued(notes)
  stage.setSelectedNote(notes[0].id)
}

function prepareUpcomingSpeech(currentDistance: number) {
  const bucket = Math.floor(currentDistance / 35)
  if (bucket === lastPreparedSpeechBucket) return
  lastPreparedSpeechBucket = bucket

  const notes = stage.paceNotes
  const horizonMeters = currentDistance + Math.max(220, (stage.activeSpeedKph / 3.6) * 5.5)
  let prepared = 0

  for (
    let index = Math.max(0, Math.min(nextSpeechNoteIndex, notes.length));
    index < notes.length && prepared < 2;
    index += 1
  ) {
    const note = notes[index]
    if (isSpeechQueued(note)) continue

    const triggerDistance = noteTriggerDistance(note)
    if (triggerDistance < currentDistance - 1) continue
    if (triggerDistance > horizonMeters) break

    const notesToPrepare = callPackageFromIndex(index)
    if (notesToPrepare.length === 0) continue

    notesToPrepare.forEach((note) => {
      speech.prepare(noteSpeechText(note), stage.speech)
    })
    prepared += 1
    index += notesToPrepare.length - 1
  }
}

function speakCurrentWindow() {
  const lookAheadMeters = Math.max(45, (stage.activeSpeedKph / 3.6) * 2.5)
  const due = stage.paceNotes.filter(
    (note) =>
      !isSpeechQueued(note) &&
      note.distance >= stage.activeDistanceMeters &&
      noteTriggerDistance(note) >= stage.activeDistanceMeters &&
      noteTriggerDistance(note) - stage.activeDistanceMeters <= lookAheadMeters,
  )

  const sorted = due.sort((a, b) => a.distance - b.distance)
  const first = sorted[0] ?? stage.nextNote
  if (!first || isSpeechQueued(first)) return

  speakNotesNow(sorted.length > 0 ? sorted : [first])
  prepareUpcomingSpeech(stage.activeDistanceMeters)
}

function toggleSimulation(running: boolean) {
  if (running) {
    if (!stage.route) return
    stopGpsWatch()
    phoneSensors.stop()
    stage.setSimulationRunning(true)
    openDriveCockpit()
    speakCurrentWindow()
    return
  }

  stage.setSimulationRunning(false)
}

function stopGpsWatch() {
  if (gpsWatchId === null) return
  navigator.geolocation.clearWatch(gpsWatchId)
  gpsWatchId = null
}

function gpsErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return 'Location permission is denied.'
  if (error.code === error.POSITION_UNAVAILABLE) return 'Location is unavailable. Check GPS and browser location services.'
  if (error.code === error.TIMEOUT) return 'Location fix timed out. Waiting for GPS.'
  return error.message || 'Location tracking failed.'
}

function handleGpsPosition(position: GeolocationPosition) {
  stage.applyGpsPosition({
    point: {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    },
    accuracyMeters: position.coords.accuracy,
    heading: position.coords.heading,
    speedMetersPerSecond: position.coords.speed,
    timestamp: position.timestamp,
  })
}

function handleGpsError(error: GeolocationPositionError) {
  const status = error.code === error.PERMISSION_DENIED ? 'denied' : 'error'
  stage.setGpsError(gpsErrorMessage(error), status)
  if (error.code === error.PERMISSION_DENIED) stopGpsWatch()
}

function startGpsDrive() {
  if (!stage.route) {
    stage.routeError = 'Build a route before starting GPS drive.'
    return
  }

  if (!('geolocation' in navigator)) {
    stage.setLocationPermission('unsupported')
    return
  }

  if (!window.isSecureContext) {
    stage.setGpsError('Location requires HTTPS or localhost.', 'error')
    return
  }

  stopGpsWatch()
  resetSpeechTracking()
  speech.cancel()
  speech.unlock()
  stage.startGpsDrive()
  void phoneSensors.start()
  gpsWatchId = navigator.geolocation.watchPosition(
    handleGpsPosition,
    handleGpsError,
    {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 10_000,
    },
  )
}

function stopGpsDrive() {
  stopGpsWatch()
  phoneSensors.stop()
  stage.stopGpsDrive()
}

function toggleGpsDrive() {
  if (stage.location.running) {
    stopGpsDrive()
    return
  }

  startGpsDrive()
}

function toggleMapOrientation() {
  stage.display.mapOrientationMode =
    stage.display.mapOrientationMode === 'north-up' ? 'heading-up' : 'north-up'
}

function selectEditorPanel(panel: EditorPanel) {
  ui.setEditorPanel(panel)
  if (panel === 'stage' && desktopLayout.value && stageSubPanel.value === 'map') {
    ui.setStageSubPanel('route')
  }
  appMenuOpen.value = false
}

function selectEditorPanelValue(value: string | number) {
  const panel = String(value) as EditorPanel
  selectEditorPanel(panel)
}

function selectStageSubPanel(panel: StageSubPanel) {
  ui.setEditorPanel('stage')
  ui.setStageSubPanel(desktopLayout.value && panel === 'map' ? 'route' : panel)
  appMenuOpen.value = false
}

function selectStageSubPanelValue(value: string | number) {
  const panel = String(value) as StageSubPanel
  selectStageSubPanel(panel)
}

function openDriveCockpit() {
  setDriveMode(true)
  appMenuOpen.value = false
}

function setDriveMode(enabled: boolean) {
  driveMode.value = enabled
  if (enabled) {
    void screenWakeLock.request()
    return
  }

  void screenWakeLock.release()
}

function toggleDriveMode() {
  setDriveMode(!driveMode.value)
}

function goHome() {
  setDriveMode(false)
  selectEditorPanel('home')
}

function applyLaunchShortcut() {
  const shortcut = new URLSearchParams(window.location.search).get('shortcut')
  if (!shortcut) return

  if (shortcut === 'drive') {
    ui.setEditorPanel('stage')
    ui.setStageSubPanel(desktopLayout.value ? 'route' : 'map')
    setDriveMode(true)
  }

  if (shortcut === 'stage') {
    ui.setEditorPanel('stage')
    ui.setStageSubPanel(desktopLayout.value ? 'route' : 'map')
  }
}

useRafFn(({ delta }) => {
  stage.advanceSimulation(delta / 1000)
  stage.advanceGpsDrive(delta / 1000)
})

onMounted(async () => {
  applyLaunchShortcut()

  if (!('geolocation' in navigator)) {
    stage.setLocationPermission('unsupported')
    return
  }

  if (!('permissions' in navigator)) return

  try {
    permissionStatus = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    stage.setLocationPermission(permissionStatus.state)
    permissionStatus.onchange = () => stage.setLocationPermission(permissionStatus?.state ?? 'unknown')
  } catch {
    stage.setLocationPermission('unknown')
  }
})

onBeforeUnmount(() => {
  stopGpsWatch()
  phoneSensors.stop()
  screenWakeLock.stop()
  obd.disconnect()
  if (permissionStatus) permissionStatus.onchange = null
})

watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value
    document.documentElement.classList.toggle('dark', value === 'dark')
    localStorage.setItem('rally-theme', value)
  },
  { immediate: true },
)

watch(
  () => stage.activeDistanceMeters,
  (current, previous = 0) => triggerDueNotes(current, previous),
)

watch(
  () => stage.nextNote?.id,
  (noteId) => {
    if (stage.activeDriveRunning && noteId) stage.setSelectedNote(noteId)
  },
)

watch(
  () => stage.driveAttempt.status,
  (status, previous) => {
    if (status === 'running' && previous !== 'running') speakCurrentWindow()
  },
)

watch(
  () => stage.route,
  (route) => {
    resetSpeechTracking()
    speech.cancel()
    stopGpsDrive()
    if (route && !desktopLayout.value && !driveMode.value) {
      ui.setEditorPanel('stage')
      ui.setStageSubPanel('map')
    }
  },
)

watch(drawerLayout, (enabled) => {
  if (!enabled) appMenuOpen.value = false
})

watch(desktopLayout, (enabled) => {
  if (enabled && stageSubPanel.value === 'map') {
    ui.setStageSubPanel('route')
  }
})
</script>

<template>
  <main
    class="grid h-svh w-full min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden bg-background text-foreground"
    :class="driveMode ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'"
    :data-screen-wake-lock-active="String(screenWakeLockActive)"
    :data-screen-wake-lock-status="screenWakeLockStatus"
    data-testid="app-shell"
  >
    <header
      v-if="!driveMode"
      class="relative z-[9200] grid min-h-[3.25rem] grid-cols-[minmax(2.75rem,1fr)_minmax(0,auto)_minmax(2.75rem,1fr)] items-center gap-3 border-b bg-background/95 px-2 py-1.5 shadow-sm lg:grid-cols-[minmax(12rem,1fr)_minmax(0,auto)_minmax(12rem,1fr)] lg:px-4"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          v-if="desktopLayout"
          type="button"
          class="inline-flex min-w-0 rounded-md p-1 -ml-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Go to home"
          title="Home"
          @click="goHome"
        >
          <PacerLogo />
        </button>
        <Sheet v-if="drawerLayout" v-model:open="appMenuOpen">
          <SheetTrigger as-child>
            <Button
              variant="outline"
              size="icon-lg"
              aria-controls="app-navigation-drawer-panel"
              :aria-expanded="appMenuOpen"
              aria-label="Open navigation"
              title="Open navigation"
              data-testid="mobile-menu-button"
            >
              <Menu :size="19" />
            </Button>
          </SheetTrigger>
          <SheetContent
            id="app-navigation-drawer-panel"
            side="left"
            class="w-[22.5rem] max-w-[calc(100vw_-_2.5rem)] border-border bg-background p-4"
            data-testid="mobile-app-drawer"
          >
            <SheetHeader class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 space-y-0 text-left">
              <button
                type="button"
                class="inline-flex min-w-0 rounded-md p-1 -ml-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Go to home"
                title="Home"
                @click="goHome"
              >
                <PacerLogo />
              </button>
              <SheetClose as-child>
                <Button variant="ghost" size="icon-sm" aria-label="Close navigation" title="Close navigation">
                  <X :size="16" />
                </Button>
              </SheetClose>
              <SheetTitle class="sr-only">Navigation</SheetTitle>
              <SheetDescription class="sr-only">Switch app sections and open the drive cockpit.</SheetDescription>
            </SheetHeader>

            <VehicleSignal compact class="w-full" />
            <Separator />

            <nav class="grid gap-1" aria-label="Main navigation">
              <Button
                v-for="section in editorSections"
                :key="section.id"
                :variant="editorPanel === section.id ? 'secondary' : 'ghost'"
                class="h-9 justify-start"
                type="button"
                :aria-current="editorPanel === section.id ? 'page' : undefined"
                @click="selectEditorPanel(section.id)"
              >
                <component :is="section.icon" :size="18" />
                <span>{{ section.label }}</span>
              </Button>
            </nav>

            <Button
              class="w-full"
              type="button"
              :disabled="!stage.route"
              @click="openDriveCockpit"
            >
              <Navigation :size="18" />
              Drive Cockpit
            </Button>

            <SheetFooter class="mt-auto flex-row items-center justify-between gap-2 border-t pt-3">
              <Badge variant="outline">v{{ appVersion }}</Badge>
              <Badge :variant="online ? 'success' : 'destructive'">
                {{ online ? 'Online' : 'Offline' }}
              </Badge>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <div class="flex min-w-0 items-center justify-center gap-2">
        <button
          v-if="!desktopLayout"
          type="button"
          class="inline-flex min-w-0 rounded-md p-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Go to home"
          title="Home"
          @click="goHome"
        >
          <PacerLogo />
        </button>
        <Tabs
          :model-value="editorPanel"
          class="hidden min-w-0 lg:flex"
          data-testid="desktop-editor-tabs"
          @update:model-value="selectEditorPanelValue"
        >
          <TabsList variant="line" class="h-10">
            <TabsTrigger
              v-for="section in editorSections"
              :key="section.id"
              :value="section.id"
              class="h-9 flex-none px-3 text-xs font-semibold"
              :aria-label="section.label"
              :title="section.label"
            >
              <component :is="section.icon" :size="15" />
              <span>{{ section.label }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div class="flex min-w-0 items-center justify-end">
        <ButtonGroup class="hidden sm:flex">
          <Button
            :variant="needRefresh ? 'default' : 'outline'"
            size="lg"
            class="h-9 px-3 font-semibold"
            :disabled="appCheckingForUpdate && !needRefresh"
            :title="`App v${appVersion} · ${appBuildDateLabel}`"
            type="button"
            data-testid="header-app-version"
            @click="needRefresh ? applyAppUpdate() : checkAppUpdate()"
          >
            <Download v-if="needRefresh" :size="15" />
            <RefreshCw v-else :size="15" :class="appCheckingForUpdate ? 'animate-spin' : ''" />
            v{{ appVersion }}
          </Button>
          <ButtonGroupText class="hidden h-9 gap-2 bg-background px-3 sm:flex">
            <Wifi v-if="online" :size="15" class="text-emerald-500" />
            <WifiOff v-else :size="15" class="text-destructive" />
            {{ online ? 'Online' : 'Offline' }}
          </ButtonGroupText>
        </ButtonGroup>
      </div>
    </header>

    <div
      v-if="driveMode"
      class="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden"
      data-testid="workspace"
    >
      <section class="relative min-h-0 overflow-hidden bg-slate-300" data-testid="map-stage">
        <DriveMapLibre
          :active-distance="stage.activeDistanceMeters"
          :car="stage.activeCar"
          :follow-car="stage.activeDriveRunning || driveMode"
          :ghost-car="stage.ghostCar"
          :ghost-distance="stage.ghostDistanceMeters"
          :orientation-mode="stage.display.mapOrientationMode"
          :drive-running="stage.activeDriveRunning"
          :pace-notes="stage.paceNotes"
          :route="stage.route"
          :weather-samples="stage.routeWeatherSamples"
          :selected-note-id="stage.selectedNoteId"
          :show-note-markers="true"
        />

        <DriverHud
          :current-note="currentNote"
          :distance-to-call="distanceToCall"
          :active-distance-meters="stage.activeDistanceMeters"
          :total-distance-meters="stage.totalDistance"
          :drive-source="stage.driveSource"
          :attempt-status="stage.driveAttempt.status"
          :current-lap="stage.driveAttempt.currentLapIndex"
          :target-lap-count="stage.driveAttempt.targetLapCount"
          :drive-mode="driveMode"
          :elapsed-seconds="stage.activeElapsedSeconds"
          :estimated-remaining-seconds="stage.estimatedRemainingSeconds"
          :following-note="followingNote"
          :ghost-delta-seconds="stage.ghostDeltaSeconds"
          :ghost-target-seconds="stage.ghostTargetSeconds"
          :location-accuracy-meters="stage.location.accuracyMeters"
          :location-error="stage.location.error"
          :location-permission="stage.location.permission"
          :location-route-error-meters="stage.location.routeErrorMeters"
          :location-running="stage.location.running"
          :location-status="stage.location.status"
          :note-window="stage.noteWindow"
          :previous-note="stage.previousNote"
          :running="stage.activeDriveRunning"
          :show-note-strip="stage.display.showNoteStrip"
          :show-telemetry="stage.display.showTelemetry"
          :show-timing="stage.display.showTiming"
          :map-orientation-mode="stage.display.mapOrientationMode"
          :speech-error="speech.lastError.value"
          :speaking="speech.speaking.value"
          :completed-note-ids="completedSpeechNoteIdList"
          :current-weather="stage.activeWeather"
          :spoken-note-ids="spokenNoteIdList"
          :speed-kph="stage.activeSpeedKph"
          :telemetry="stage.telemetry"
          :upcoming-weather-alert="stage.upcomingWeatherAlert"
          :weather-error="stage.routeWeatherError"
          :weather-loading="stage.routeWeatherLoading"
          @speak="speakNoteNow()"
          @toggle-drive="toggleDriveMode"
          @toggle-live-drive="toggleGpsDrive"
          @toggle-map-orientation="toggleMapOrientation"
        />
      </section>
    </div>

    <div
      v-else-if="desktopLayout"
      class="grid min-h-0 min-w-0 overflow-hidden"
      :class="editorPanel === 'stage'
        ? 'grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]'
        : 'grid-cols-[minmax(0,1fr)]'"
      data-testid="workspace"
    >
      <section
        v-if="editorPanel === 'home'"
        class="col-span-full min-h-0 overflow-y-auto bg-background"
      >
        <HomePanel
          @drive="openDriveCockpit"
          @garage="selectEditorPanel('garage')"
          @runs="selectEditorPanel('history')"
          @stage="selectStageSubPanel('route')"
          @shakedown="selectStageSubPanel('shakedown')"
        />
      </section>
      <section
        v-else-if="editorPanel === 'garage'"
        class="col-span-full min-h-0 overflow-y-auto bg-background p-4"
        data-testid="garage-panel"
      >
        <VehicleGarage />
      </section>
      <section
        v-else-if="editorPanel === 'history'"
        class="col-span-full min-h-0 overflow-y-auto bg-background"
      >
        <RunsPanel />
      </section>
      <section
        v-else-if="editorPanel === 'settings'"
        class="col-span-full min-h-0 overflow-y-auto bg-background"
      >
        <SettingsPanel :theme="theme" @set-theme="setTheme" />
      </section>

      <aside
        v-else
        class="min-h-0 overflow-hidden border-r border-border bg-card"
        data-testid="setup-panel"
      >
        <div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <Tabs
            :model-value="stageSubPanel"
            class="m-3 mb-0 pb-3"
            @update:model-value="selectStageSubPanelValue"
          >
            <TabsList
              class="grid h-10 w-full"
              :class="desktopLayout ? 'grid-cols-3' : 'grid-cols-4'"
              data-testid="stage-subnav"
            >
              <TabsTrigger
                v-for="section in visibleStageSections"
                :key="section.id"
                :value="section.id"
                class="h-9 min-w-0 gap-1"
                :aria-label="section.label"
              >
                <component :is="section.icon" :size="15" />
                <span>{{ section.shortLabel }}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <StageControls v-if="stageSubPanel === 'route' || stageSubPanel === 'map'" />
          <PaceNotesPanel
            v-else-if="stageSubPanel === 'notes'"
            :last-error="speech.lastError.value"
            :backend="speech.backend.value"
            :queue-length="speech.queueLength.value"
            :speaking="speech.speaking.value"
            :supported="speech.supported"
            :unlocked="speech.unlocked.value"
            :voices="speech.voices.value"
            @preview="(text) => speech.speakNow(text, stage.speech)"
            @stop="speech.cancel"
          />
          <SimulatorPanel v-else @toggle-running="toggleSimulation" />
        </div>
      </aside>

      <section v-if="editorPanel === 'stage'" class="relative min-h-0 overflow-hidden bg-slate-300" data-testid="map-stage">
        <MapCanvas
          :active-distance="stage.activeDistanceMeters"
          :car="stage.activeCar"
          :follow-car="stage.activeDriveRunning || driveMode"
          :ghost-car="stage.ghostCar"
          :orientation-mode="stage.display.mapOrientationMode"
          :drive-mode="driveMode"
          :drive-running="stage.activeDriveRunning"
          :pace-notes="stage.paceNotes"
          :route="stage.route"
          :route-mode="stage.routeMode"
          :selected-note-id="stage.selectedNoteId"
          :show-note-markers="true"
          :waypoints="stage.waypoints"
          @map-click="addPoint"
          @select-note="stage.setSelectedNote"
        />

        <VehicleSignal compact class="vehicle-signal--map" />
        <Button
          class="drive-map-cta h-10 gap-2 px-4 text-sm font-semibold shadow-xl"
          type="button"
          data-testid="drive-fab"
          :disabled="!stage.route"
          @click="setDriveMode(true)"
        >
          <span class="material-symbols-outlined drive-map-cta__icon" aria-hidden="true">sports_motorsports</span>
          Drive
        </Button>
      </section>

    </div>

    <div
      v-else
      class="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-background"
      :class="phoneLayout ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : ''"
      data-testid="workspace"
    >
      <section class="min-h-0 min-w-0 overflow-hidden">
        <section v-if="editorPanel === 'home'" class="h-full overflow-y-auto bg-background">
          <HomePanel
            @drive="openDriveCockpit"
            @garage="selectEditorPanel('garage')"
            @runs="selectEditorPanel('history')"
            @stage="selectStageSubPanel('route')"
            @shakedown="selectStageSubPanel('shakedown')"
          />
        </section>

        <section
          v-else-if="editorPanel === 'stage'"
          class="grid h-full min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-background"
          data-testid="stage-workspace"
        >
          <div class="border-b border-border bg-card p-2">
            <Tabs
              :model-value="stageSubPanel"
              class="stage-subnav overflow-x-auto pb-2"
              @update:model-value="selectStageSubPanelValue"
            >
              <TabsList
                class="grid h-9 w-full min-w-max grid-cols-4"
                data-testid="stage-subnav"
              >
                <TabsTrigger
                  v-for="section in visibleStageSections"
                  :key="section.id"
                  :value="section.id"
                  class="min-w-16 gap-1"
                  :aria-label="section.label"
                >
                  <component :is="section.icon" :size="15" />
                  <span class="stage-subnav__label">{{ section.shortLabel }}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div v-if="stageSubPanel === 'route'" class="min-h-0 overflow-y-auto" data-testid="setup-panel">
            <StageControls />
          </div>

          <section
            v-else-if="stageSubPanel === 'map'"
            class="relative h-full min-h-0 overflow-hidden bg-slate-300"
            data-testid="map-stage"
          >
            <MapCanvas
              :active-distance="stage.activeDistanceMeters"
              :car="stage.activeCar"
              :follow-car="stage.activeDriveRunning || driveMode"
              :ghost-car="stage.ghostCar"
              :orientation-mode="stage.display.mapOrientationMode"
              :drive-mode="driveMode"
              :drive-running="stage.activeDriveRunning"
              :pace-notes="stage.paceNotes"
              :route="stage.route"
              :route-mode="stage.routeMode"
              :selected-note-id="stage.selectedNoteId"
              :show-note-markers="true"
              :waypoints="stage.waypoints"
              @map-click="addPoint"
              @select-note="stage.setSelectedNote"
            />
            <VehicleSignal compact class="vehicle-signal--map" />
            <Button
              class="drive-map-cta h-10 gap-2 px-4 text-sm font-semibold shadow-xl"
              type="button"
              data-testid="drive-fab"
              :disabled="!stage.route"
              @click="setDriveMode(true)"
            >
              <span class="material-symbols-outlined drive-map-cta__icon" aria-hidden="true">sports_motorsports</span>
              Drive
            </Button>
          </section>

          <section
            v-else-if="stageSubPanel === 'notes'"
            class="h-full min-h-0 overflow-hidden bg-background"
            data-testid="notes-panel"
          >
            <PaceNotesPanel
              :last-error="speech.lastError.value"
              :backend="speech.backend.value"
              :queue-length="speech.queueLength.value"
              :speaking="speech.speaking.value"
              :supported="speech.supported"
              :unlocked="speech.unlocked.value"
              :voices="speech.voices.value"
              @preview="(text) => speech.speakNow(text, stage.speech)"
              @stop="speech.cancel"
            />
          </section>

          <section
            v-else
            class="h-full overflow-y-auto bg-background"
            data-testid="simulator-panel"
          >
            <SimulatorPanel @toggle-running="toggleSimulation" />
          </section>
        </section>

        <section v-else-if="editorPanel === 'garage'" class="h-full overflow-y-auto bg-background p-4" data-testid="garage-panel">
          <VehicleGarage />
        </section>

        <section v-else-if="editorPanel === 'settings'" class="h-full overflow-y-auto bg-background">
          <SettingsPanel :theme="theme" @set-theme="setTheme" />
        </section>

        <section v-else class="h-full overflow-y-auto bg-background">
          <RunsPanel />
        </section>
      </section>
    </div>

    <Tabs
      v-if="!driveMode && phoneLayout"
      :model-value="editorPanel"
      class="fixed inset-x-0 bottom-0 z-[9000] border-t bg-background/95 p-1 pb-[calc(0.35rem+env(safe-area-inset-bottom))] backdrop-blur"
      aria-label="Primary sections"
      data-testid="mobile-editor-dock"
      @update:model-value="selectEditorPanelValue"
    >
      <TabsList class="grid h-12 w-full grid-cols-5 bg-transparent p-0">
        <TabsTrigger
          v-for="section in editorSections"
          :key="section.id"
          :value="section.id"
          class="grid h-11 grid-rows-[auto_auto] gap-0.5 px-1 py-1"
          :aria-label="section.label"
          :title="section.label"
        >
          <component :is="section.icon" :size="17" />
          <span class="max-w-16 truncate text-[0.62rem] leading-none">{{ section.label }}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <section
      v-if="needRefresh"
      class="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-[10000] grid place-items-center px-3 lg:bottom-4"
    >
      <div
        class="pointer-events-auto flex w-[28rem] max-w-[calc(100vw_-_1.5rem)] items-center gap-3 rounded-lg border border-primary/60 bg-card p-3 text-card-foreground shadow-xl"
        data-testid="pwa-update-banner"
      >
        <Download :size="20" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-black">Update available</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Reload to switch from v{{ appVersion }} to v{{ appLatestVersion }}.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Button size="sm" type="button" @click="applyAppUpdate">
            <Download :size="15" />
            Update
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Dismiss"
            type="button"
            @click="dismissAppUpdate"
          >
            <X :size="16" />
          </Button>
        </div>
      </div>
    </section>
  </main>
</template>
