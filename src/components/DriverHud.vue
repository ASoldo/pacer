<script setup lang="ts">
import { computed } from 'vue'
import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  Compass,
  Flag,
  Gauge,
  LocateFixed,
  Maximize2,
  Megaphone,
  MegaphoneOff,
  Minimize2,
  Navigation,
  Pause,
  Timer,
  Volume2,
} from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import PaceCallIcon from './PaceCallIcon.vue'
import VehicleSignal from './VehicleSignal.vue'
import type {
  DriveAttemptStatus,
  DriveSource,
  LocationPermissionState,
  LocationTrackingStatus,
  MapOrientationMode,
  PaceNote,
  VehicleTelemetry,
} from '../types'
import { formatMeters } from '../utils/geo'
import { paceCode, paceColor, paceDisplay } from '../utils/pace'

const props = defineProps<{
  currentNote: PaceNote | null
  previousNote: PaceNote | null
  followingNote: PaceNote | null
  noteWindow: PaceNote[]
  distanceToCall: number
  activeDistanceMeters: number
  totalDistanceMeters: number
  speedKph: number
  elapsedSeconds: number
  estimatedRemainingSeconds: number
  ghostDeltaSeconds: number
  ghostTargetSeconds: number
  driveSource: DriveSource
  attemptStatus: DriveAttemptStatus
  currentLap: number
  targetLapCount: number
  locationRunning: boolean
  locationStatus: LocationTrackingStatus
  locationPermission: LocationPermissionState
  locationAccuracyMeters: number
  locationRouteErrorMeters: number
  locationError: string
  telemetry: VehicleTelemetry
  showTiming: boolean
  showTelemetry: boolean
  showNoteStrip: boolean
  mapOrientationMode: MapOrientationMode
  running: boolean
  driveMode: boolean
  speaking: boolean
  speechError: string
  spokenNoteIds: string[]
  completedNoteIds: string[]
}>()

const emit = defineEmits<{
  'toggle-drive': []
  'toggle-live-drive': []
  'toggle-map-orientation': []
  speak: []
}>()

function compactText(note: PaceNote | null) {
  return paceDisplay(note)
}

function currentCallText(note: PaceNote | null) {
  const call = compactText(note)
  const distance = Math.max(0, props.distanceToCall)
  if (!note || note.kind === 'finish' || distance < 8) return call
  return `${formatMeters(distance)} ${call}`
}

function formatClock(value: number) {
  const safe = Math.max(0, Math.round(value))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatDelta(value: number) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${prefix}${Math.abs(value).toFixed(1)}`
}

function formatHudDelta(value: number) {
  return formatDelta(Math.round(value * 5) / 5)
}

function formatSigned(value: number, fractionDigits = 2) {
  const prefix = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${prefix}${Math.abs(value).toFixed(fractionDigits)}`
}

function formatCompactMeters(value: number | undefined) {
  const safe = Math.max(0, Math.round(value ?? 0))
  if (safe >= 1000) return `${(safe / 1000).toFixed(safe >= 9950 ? 0 : 1)} km`
  return `${safe} m`
}

function arcPoint(radius: number, angleDegrees: number) {
  const angleRadians = (angleDegrees * Math.PI) / 180
  return {
    x: 50 + radius * Math.cos(angleRadians),
    y: 50 + radius * Math.sin(angleRadians),
  }
}

function gaugeArcPath(radius: number, ratio = 1) {
  const startAngle = 135
  const sweepAngle = 270 * Math.min(Math.max(ratio, 0), 1)
  if (Math.abs(sweepAngle) <= 0.01) return ''

  const start = arcPoint(radius, startAngle)
  const end = arcPoint(radius, startAngle + sweepAngle)
  const largeArc = Math.abs(sweepAngle) > 180 ? 1 : 0
  const sweepFlag = sweepAngle > 0 ? 1 : 0
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`
}

const currentColor = computed(() => paceColor(props.currentNote))
const activeSymbol = computed(() => paceCode(props.currentNote))
const elapsedBadgeText = computed(() => formatClock(props.elapsedSeconds))
const ghostBadgeText = computed(() => formatHudDelta(props.ghostDeltaSeconds))
const progressSectionCount = 10
const hasStageProgress = computed(() => Number.isFinite(props.totalDistanceMeters) && props.totalDistanceMeters > 0)
const driverProgressRatio = computed(() =>
  props.totalDistanceMeters > 0
    ? Math.min(Math.max(props.activeDistanceMeters / props.totalDistanceMeters, 0), 1)
    : 0,
)
const ghostProgressRatio = computed(() =>
  props.ghostTargetSeconds > 0
    ? Math.min(Math.max(props.elapsedSeconds / props.ghostTargetSeconds, 0), 1)
    : driverProgressRatio.value,
)
const progressDeltaClass = computed(() => (props.ghostDeltaSeconds <= 0 ? 'is-good' : 'is-late'))
const progressSections = computed(() =>
  Array.from({ length: progressSectionCount }, (_, index) => {
    const sectionStart = index / progressSectionCount
    const sectionProgress = (index + 1) / progressSectionCount
    const current =
      index === progressSectionCount - 1
        ? driverProgressRatio.value >= sectionStart && driverProgressRatio.value <= sectionProgress
        : driverProgressRatio.value >= sectionStart && driverProgressRatio.value < sectionProgress
    return {
      id: index,
      active: driverProgressRatio.value >= sectionProgress,
      current,
    }
  }),
)
const driverProgressStyle = computed(() => ({ '--progress-x': `${driverProgressRatio.value * 100}%` }))
const ghostProgressStyle = computed(() => ({ '--progress-x': `${ghostProgressRatio.value * 100}%` }))
const timelineNotes = computed(() => {
  const current = props.currentNote
  const currentDistance = current?.distance ?? -1

  if (current?.kind === 'finish') return [current]

  const upcoming = props.noteWindow.filter((note) => note.id !== current?.id && note.distance > currentDistance)
  const notes = current ? [current, ...upcoming] : props.noteWindow
  return notes.slice(0, 6)
})
const timelineRailKey = computed(() => props.currentNote?.id ?? timelineNotes.value.map((note) => note.id).join('-'))
const spokenPendingIds = computed(() => new Set(props.spokenNoteIds))
const completedSpeechIds = computed(() => new Set(props.completedNoteIds))
const gpsAccuracyMeters = computed(() => props.telemetry.accuracyMeters ?? props.locationAccuracyMeters)
const gpsAccuracyText = computed(() => {
  const value = gpsAccuracyMeters.value
  if (!Number.isFinite(value) || value <= 0) return props.locationStatus === 'tracking' ? 'GPS' : 'GPS --'
  return formatCompactMeters(value)
})
const timelineGradient = computed(() => {
  const notes = timelineNotes.value
  if (notes.length === 0) return 'rgba(148, 163, 184, 0.24)'
  if (notes.length === 1) return paceColor(notes[0])

  const stops: string[] = []
  notes.forEach((note, index) => {
    const color = paceColor(note)
    const start = Math.max(0, ((index - 0.18) / (notes.length - 1)) * 100)
    const end = Math.min(100, ((index + 0.18) / (notes.length - 1)) * 100)
    stops.push(`${color} ${start.toFixed(1)}%`, `${color} ${end.toFixed(1)}%`)
  })

  return `linear-gradient(90deg, ${stops.join(', ')})`
})
const displaySpeedKph = computed(() => props.telemetry.speedKph ?? props.speedKph)
const speedDisplayText = computed(() => Math.round(displaySpeedKph.value).toString().padStart(3, '0'))
const speedRatio = computed(() => Math.min(Math.max(displaySpeedKph.value / 180, 0), 1))
const gpsQualityRatio = computed(() => {
  const value = gpsAccuracyMeters.value
  if (!Number.isFinite(value) || value <= 0) return props.locationStatus === 'tracking' ? 1 : 0
  return 1 - Math.min(Math.max((value - 5) / 95, 0), 1)
})
const speedTrackPath = computed(() => gaugeArcPath(45, 1))
const gpsTrackPath = computed(() => gaugeArcPath(36, 1))
const speedArcPath = computed(() => gaugeArcPath(45, speedRatio.value))
const gpsArcPath = computed(() => gaugeArcPath(36, gpsQualityRatio.value))
const lateralG = computed(() => props.telemetry.lateralG ?? 0)
const longitudinalG = computed(() => props.telemetry.longitudinalG ?? 0)
const lateralGPositiveStyle = computed(() => ({ width: `${Math.min(Math.max(lateralG.value, 0) / 1.2, 1) * 50}%` }))
const lateralGNegativeStyle = computed(() => ({ width: `${Math.min(Math.max(-lateralG.value, 0) / 1.2, 1) * 50}%` }))
const longitudinalGPositiveStyle = computed(() => ({ width: `${Math.min(Math.max(longitudinalG.value, 0) / 1.2, 1) * 50}%` }))
const longitudinalGNegativeStyle = computed(() => ({ width: `${Math.min(Math.max(-longitudinalG.value, 0) / 1.2, 1) * 50}%` }))
const locationStatusTitle = computed(() => {
  if (props.locationError) return props.locationError
  if (props.locationStatus === 'tracking') {
    const routeError = props.locationRouteErrorMeters ? `, ${Math.round(props.locationRouteErrorMeters)} m from route` : ''
    return `GPS tracking, accuracy ${Math.round(props.locationAccuracyMeters || 0)} m${routeError}`
  }
  if (props.locationStatus === 'requesting') return 'Requesting location permission and GPS fix'
  if (props.locationStatus === 'stale') return 'GPS fix is stale'
  if (props.locationStatus === 'idle') return 'GPS drive ready'
  return 'GPS drive'
})
const driveStatusVariant = computed(() => {
  if (props.running || props.attemptStatus === 'running') return 'success'
  if (props.attemptStatus === 'armed') return 'warning'
  if (props.attemptStatus === 'finished') return 'info'
  if (props.attemptStatus === 'aborted') return 'destructive'
  return 'muted'
})
const locationStatusVariant = computed(() => {
  if (props.locationStatus === 'tracking') return 'success'
  if (props.locationStatus === 'requesting' || props.locationStatus === 'stale') return 'warning'
  if (props.locationStatus === 'error' || props.locationStatus === 'denied' || props.locationStatus === 'unsupported') {
    return 'destructive'
  }
  return 'muted'
})
const speechStatusVariant = computed(() => {
  if (props.speechError || props.currentNote?.caution) return 'destructive'
  return props.speaking ? 'success' : 'muted'
})
const speechStatusLabel = computed(() => {
  if (props.speechError) return 'Speech error'
  if (props.currentNote?.caution) return 'Caution'
  return props.speaking ? 'Speaking' : 'Standby'
})
const speechStatusTitle = computed(() => {
  if (props.speechError) return props.speechError
  if (props.currentNote?.caution) return 'Caution'
  return props.speaking ? 'Speaking' : 'Standby'
})
const ghostDeltaVariant = computed(() => (props.ghostDeltaSeconds <= 0 ? 'success' : 'destructive'))
const driveStatusLabel = computed(() => {
  if (props.running || props.attemptStatus === 'running') return 'Recording'
  if (props.attemptStatus === 'armed') return 'Armed'
  if (props.attemptStatus === 'finished') return 'Finished'
  if (props.attemptStatus === 'aborted') return 'Stopped'
  return 'Ready'
})
const locationStatusLabel = computed(() => {
  if (props.locationStatus === 'tracking') return 'GPS'
  if (props.locationStatus === 'requesting') return 'GPS fix'
  if (props.locationStatus === 'stale') return 'Stale'
  if (props.locationStatus === 'denied') return 'Denied'
  if (props.locationStatus === 'unsupported') return 'No GPS'
  if (props.locationStatus === 'error') return 'Error'
  return 'Idle'
})
const liveDriveButtonTitle = computed(() =>
  props.locationRunning ? 'Stop GPS drive' : 'Arm GPS drive',
)
const attemptStatusTitle = computed(() => {
  if (props.attemptStatus === 'armed') return 'Armed, timing starts at the start marker'
  if (props.attemptStatus === 'running') return 'Recording drive'
  if (props.attemptStatus === 'finished') return 'Drive finished'
  if (props.attemptStatus === 'aborted') return 'Drive aborted'
  return 'Drive idle'
})
const attemptStatusLabel = computed(() => {
  if (props.attemptStatus === 'armed') return 'ARM'
  if (props.attemptStatus === 'running') return props.targetLapCount > 1 ? `L${props.currentLap}` : 'REC'
  if (props.attemptStatus === 'finished') return 'DONE'
  if (props.attemptStatus === 'aborted') return 'STOP'
  return activeSymbol.value
})

function isSpokenPending(note: PaceNote) {
  return spokenPendingIds.value.has(note.id)
}

function isSpeechCompleted(note: PaceNote) {
  return completedSpeechIds.value.has(note.id)
}

function isCurrentTimelineNote(note: PaceNote) {
  return note.id === props.currentNote?.id
}

function timelineIconSize(note: PaceNote): 'sm' | 'md' {
  return isCurrentTimelineNote(note) ? 'md' : 'sm'
}

</script>

<template>
  <div
    class="wrc-driver-hud pointer-events-none absolute inset-0 z-[1000] text-foreground"
    :class="{ 'is-drive': props.driveMode, 'is-editor': !props.driveMode }"
    :data-spoken-count="props.spokenNoteIds.length"
    :data-spoken-ids="props.spokenNoteIds.join(',')"
    :data-completed-count="props.completedNoteIds.length"
    :data-completed-ids="props.completedNoteIds.join(',')"
    data-testid="driver-hud"
  >
    <Card
      size="sm"
      class="wrc-call-board pointer-events-auto border-border/80 bg-card/90 text-card-foreground shadow-xl backdrop-blur"
    >
      <CardContent class="grid gap-2 p-3">
      <div class="wrc-call-board__header">
        <Transition name="wrc-call-text" mode="out-in">
          <p :key="props.currentNote?.id ?? 'ready'" class="wrc-current-call__text">
            {{ currentCallText(props.currentNote) }}
          </p>
        </Transition>
      </div>

      <div v-if="props.showNoteStrip" class="wrc-call-strip-viewport">
        <ol
          :key="timelineRailKey"
          class="wrc-call-strip"
          :style="{ '--timeline-gradient': timelineGradient }"
          data-testid="call-strip"
        >
          <li
            v-for="note in timelineNotes"
            :key="note.id"
            :class="{ 'is-current': isCurrentTimelineNote(note) }"
            :data-note-id="note.id"
            :data-note-kind="note.kind"
          >
            <span
              class="wrc-timeline-wrap"
              :class="{
                'is-current': isCurrentTimelineNote(note),
              }"
            >
              <button
                class="wrc-timeline-node"
                :class="{
                  'is-active': isCurrentTimelineNote(note),
                  'is-spoken': isSpokenPending(note),
                  'is-completed': isSpeechCompleted(note),
                  'wrc-timeline-node--current': isCurrentTimelineNote(note),
                }"
                :title="`${note.distanceCall ?? 'now'}, ${compactText(note)}`"
                type="button"
              >
                <PaceCallIcon
                  :note="note"
                  :size="timelineIconSize(note)"
                  :label="false"
                  :spoken="isSpokenPending(note)"
                  :completed="isSpeechCompleted(note)"
                />
              </button>
            </span>
          </li>
        </ol>
      </div>

      <div class="wrc-call-board__status">
        <div
          class="flex max-w-full flex-wrap items-center justify-start gap-1.5"
          aria-label="Driver state"
          data-testid="driver-state-strip"
        >
          <Badge
            as="span"
            variant="outline"
            class="h-6 rounded-md px-2 font-mono text-[0.65rem] font-black uppercase tracking-[0.12em] text-slate-950"
            :style="{ borderColor: currentColor, backgroundColor: currentColor }"
          >
            {{ attemptStatusLabel }}
          </Badge>
          <Badge
            as="span"
            :variant="driveStatusVariant"
            class="h-6 gap-1.5 rounded-md px-2 text-[0.65rem] font-semibold"
            :title="attemptStatusTitle"
          >
            <CircleCheck v-if="props.running" :size="14" />
            <CirclePause v-else :size="14" />
            <span>{{ driveStatusLabel }}</span>
          </Badge>
          <Badge
            as="span"
            :variant="locationStatusVariant"
            class="h-6 gap-1.5 rounded-md px-2 text-[0.65rem] font-semibold"
            :title="locationStatusTitle"
          >
            <LocateFixed :size="14" />
            <span>{{ locationStatusLabel }}</span>
          </Badge>
          <Badge
            as="span"
            variant="muted"
            class="h-6 gap-1.5 rounded-md px-2 text-[0.65rem] font-semibold"
            :title="props.mapOrientationMode === 'heading-up' ? 'Heading up' : 'North up'"
          >
            <Navigation v-if="props.mapOrientationMode === 'heading-up'" :size="14" />
            <Compass v-else :size="14" />
            <span>{{ props.mapOrientationMode === 'heading-up' ? 'Heading' : 'North' }}</span>
          </Badge>
          <Badge
            as="span"
            :variant="speechStatusVariant"
            class="h-6 gap-1.5 rounded-md px-2 text-[0.65rem] font-semibold"
            :title="speechStatusTitle"
          >
            <CircleAlert v-if="props.speechError || props.currentNote?.caution" :size="14" />
            <Megaphone v-else-if="props.speaking" :size="14" />
            <MegaphoneOff v-else :size="14" />
            <span>{{ speechStatusLabel }}</span>
          </Badge>
        </div>
      </div>

      <aside
        v-if="hasStageProgress"
        class="wrc-stage-progress pointer-events-none"
        :class="progressDeltaClass"
        aria-label="Stage progress against ghost"
        data-testid="drive-progress-rail"
      >
        <div class="wrc-stage-progress__rail">
          <span
            v-for="section in progressSections"
            :key="section.id"
            class="wrc-stage-progress__section"
            :class="{ 'is-active': section.active, 'is-current': section.current }"
          />
          <span
            class="wrc-stage-progress__marker wrc-stage-progress__marker--ghost"
            :style="ghostProgressStyle"
            aria-hidden="true"
          >
            <span class="wrc-stage-progress__ghost-dot" />
          </span>
          <span
            class="wrc-stage-progress__marker wrc-stage-progress__marker--driver"
            :style="driverProgressStyle"
            aria-hidden="true"
          >
            <Navigation :size="11" />
          </span>
        </div>
      </aside>
      </CardContent>
    </Card>

    <section class="wrc-bottom-panel pointer-events-auto">
      <VehicleSignal fab />
      <Card
        size="sm"
        class="wrc-drive-deck border-border/80 bg-card text-card-foreground shadow-xl"
      >
        <CardContent class="grid gap-3 p-3">
        <div class="wrc-phone-cluster" aria-label="GPS telemetry cluster">
          <div class="wrc-telemetry-stack">
            <Badge
              v-if="props.showTiming"
              as="span"
              variant="outline"
              class="wrc-cluster-readout !border-border !bg-card !text-card-foreground"
              data-testid="drive-elapsed-badge"
            >
              <Timer :size="14" />
              <span class="tabular-nums">{{ elapsedBadgeText }}</span>
            </Badge>
            <section class="wrc-phone-meter" aria-label="Lateral g-force">
              <div class="wrc-phone-meter__label">
                <span>Lat G</span>
                <b>{{ formatSigned(lateralG) }}</b>
              </div>
              <div class="wrc-g-track">
                <i class="is-negative" :style="lateralGNegativeStyle" />
                <i class="is-positive" :style="lateralGPositiveStyle" />
              </div>
            </section>
          </div>

          <section
            class="wrc-speed-dial wrc-speed-dial--compact"
            title="GPS speed and signal accuracy"
            aria-label="GPS speed"
          >
            <svg
              class="wrc-speed-dial__arcs"
              viewBox="0 0 100 100"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="wrc-speed-gradient" x1="16" y1="88" x2="86" y2="12" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#35a7ff" />
                  <stop offset="52%" stop-color="#1d4ed8" />
                  <stop offset="100%" stop-color="#ef4444" />
                </linearGradient>
                <linearGradient id="wrc-gps-gradient" x1="18" y1="82" x2="82" y2="18" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#14b8a6" />
                  <stop offset="100%" stop-color="#22c55e" />
                </linearGradient>
              </defs>
              <path class="wrc-speed-dial__arc-track wrc-speed-dial__arc-track--speed" :d="speedTrackPath" />
              <path
                class="wrc-speed-dial__arc-progress wrc-speed-dial__arc-progress--speed"
                :d="speedArcPath"
                :opacity="speedRatio > 0.01 ? 1 : 0"
              />
              <path class="wrc-speed-dial__arc-track wrc-speed-dial__arc-track--gps" :d="gpsTrackPath" />
              <path
                class="wrc-speed-dial__arc-progress wrc-speed-dial__arc-progress--gps"
                :d="gpsArcPath"
                :opacity="gpsQualityRatio > 0.01 ? 1 : 0"
              />
            </svg>
            <div class="wrc-speed-dial__inner">
              <span class="wrc-speed-dial__readout">
                <span class="wrc-speed-dial__speed-line">
                  <span class="wrc-speed-dial__speed">{{ speedDisplayText }}</span>
                </span>
                <span class="wrc-speed-dial__unit">km/h</span>
                <span class="wrc-speed-dial__rpm">{{ gpsAccuracyText }}</span>
              </span>
            </div>
          </section>

          <div class="wrc-telemetry-stack">
            <Badge
              v-if="props.showTiming"
              as="span"
              variant="outline"
              :class="[
                'wrc-cluster-readout !border-border !bg-card',
                ghostDeltaVariant === 'success' ? '!text-emerald-400' : '!text-destructive',
              ]"
              data-testid="drive-ghost-badge"
            >
              <Gauge :size="14" />
              <span class="tabular-nums" :aria-label="ghostBadgeText">{{ ghostBadgeText }}</span>
            </Badge>
            <section class="wrc-phone-meter" aria-label="Longitudinal g-force">
              <div class="wrc-phone-meter__label">
                <span>Long G</span>
                <b>{{ formatSigned(longitudinalG) }}</b>
              </div>
              <div class="wrc-g-track">
                <i class="is-negative" :style="longitudinalGNegativeStyle" />
                <i class="is-positive" :style="longitudinalGPositiveStyle" />
              </div>
            </section>
          </div>

        </div>

        <div class="wrc-control-grid">
          <Button
            class="h-10 w-full shadow-sm"
            variant="default"
            :title="liveDriveButtonTitle"
            type="button"
            data-testid="recording-toggle"
            @click="emit('toggle-live-drive')"
          >
            <Pause v-if="props.locationRunning" :size="21" />
            <Flag v-else :size="21" />
          </Button>
          <Button
            class="h-10 w-full"
            :variant="props.mapOrientationMode === 'heading-up' ? 'secondary' : 'outline'"
            title="Toggle map orientation"
            type="button"
            data-testid="drive-orientation-toggle"
            @click="emit('toggle-map-orientation')"
          >
            <Navigation v-if="props.mapOrientationMode === 'heading-up'" :size="21" />
            <Compass v-else :size="21" />
          </Button>
          <Button
            variant="outline"
            class="h-10 w-full"
            title="Speak current note"
            type="button"
            data-testid="drive-speak-current"
            @click="emit('speak')"
          >
            <Volume2 :size="21" />
          </Button>
          <Button
            variant="outline"
            class="h-10 w-full"
            title="Toggle drive view"
            type="button"
            data-testid="drive-exit"
            @click="emit('toggle-drive')"
          >
            <Minimize2 v-if="props.driveMode" :size="21" />
            <Maximize2 v-else :size="21" />
          </Button>
        </div>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
