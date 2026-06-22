<script setup lang="ts">
import { computed } from 'vue'
import {
  Activity,
  Compass,
  Gauge,
  LocateFixed,
  Pause,
  Play,
  Smartphone,
  Square,
} from '@lucide/vue'
import { usePhoneSensors } from '../composables/usePhoneSensors'
import { useStageStore } from '../stores/stage'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const stage = useStageStore()
const phoneSensors = usePhoneSensors()

const sample = computed(() => stage.phoneSensors.sample)
const sensorStatusVariant = computed(() => {
  if (stage.phoneSensors.status === 'listening') return 'success'
  if (stage.phoneSensors.status === 'requesting') return 'warning'
  if (stage.phoneSensors.status === 'error' || stage.phoneSensors.status === 'unsupported') return 'destructive'
  return 'muted'
})
const sensorStatusTone = computed(() => {
  if (stage.phoneSensors.status === 'listening') return 'bg-emerald-500'
  if (stage.phoneSensors.status === 'requesting') return 'bg-amber-500'
  if (stage.phoneSensors.status === 'error' || stage.phoneSensors.status === 'unsupported') return 'bg-destructive'
  return 'bg-muted-foreground'
})
const gpsStatusVariant = computed(() => {
  if (stage.location.status === 'tracking') return 'success'
  if (stage.location.status === 'requesting' || stage.location.status === 'stale') return 'warning'
  if (stage.location.status === 'error' || stage.location.status === 'denied' || stage.location.status === 'unsupported') {
    return 'destructive'
  }
  return 'muted'
})
const gpsStatusTone = computed(() => {
  if (stage.location.status === 'tracking') return 'bg-emerald-500'
  if (stage.location.status === 'requesting' || stage.location.status === 'stale') return 'bg-amber-500'
  if (stage.location.status === 'error' || stage.location.status === 'denied' || stage.location.status === 'unsupported') {
    return 'bg-destructive'
  }
  return 'bg-muted-foreground'
})

function formatG(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0.00 g'
  const prefix = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${prefix}${Math.abs(value).toFixed(2)} g`
}

function formatMeters(value: number) {
  return `${Math.round(value || 0)} m`
}

function formatHeading(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value)} deg`
}

function togglePhoneTelemetry() {
  if (phoneSensors.active.value) {
    phoneSensors.pause()
    return
  }

  void phoneSensors.start()
}
</script>

<template>
  <Card class="border-border bg-card shadow-none" data-testid="phone-telemetry-card">
    <CardHeader class="grid grid-cols-[minmax(0,1fr)_auto] items-center border-b">
      <div class="flex min-w-0 items-center gap-2">
        <span class="grid size-9 shrink-0 place-items-center rounded-md border bg-muted/20 text-foreground">
          <Smartphone :size="16" />
        </span>
        <div class="min-w-0">
          <CardTitle class="truncate text-sm font-semibold">Phone telemetry</CardTitle>
          <CardDescription class="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
            GPS · motion · gyro
          </CardDescription>
        </div>
      </div>
      <Badge :variant="sensorStatusVariant" class="gap-1 text-[0.62rem] font-semibold uppercase" title="Phone sensor status">
        <span class="size-1.5 rounded-full" :class="sensorStatusTone"></span>
        {{ stage.phoneSensors.status }}
      </Badge>
    </CardHeader>

    <CardContent>
      <div class="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          :title="phoneSensors.active.value ? 'Pause phone sensors' : 'Start phone sensors'"
          type="button"
          @click="togglePhoneTelemetry"
        >
          <Pause v-if="phoneSensors.active.value" :size="16" />
          <Play v-else :size="16" />
          {{ phoneSensors.active.value ? 'Pause' : 'Start' }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          title="Stop phone sensors"
          type="button"
          :disabled="!phoneSensors.active.value"
          @click="phoneSensors.stop()"
        >
          <Square :size="14" />
          Stop
        </Button>
      </div>

      <Alert v-if="stage.phoneSensors.error" variant="destructive" class="mt-3">
        <AlertDescription>{{ stage.phoneSensors.error }}</AlertDescription>
      </Alert>

      <div class="mt-3 grid grid-cols-2 overflow-hidden rounded-md border bg-muted/10">
        <div class="min-w-0 border-b border-r p-3">
          <p class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <LocateFixed :size="12" />
            GPS
          </p>
          <p class="mt-1 text-sm font-semibold">{{ formatMeters(stage.location.accuracyMeters) }}</p>
          <p class="mt-2">
            <Badge :variant="gpsStatusVariant" class="gap-1 text-[0.62rem] font-semibold uppercase" title="GPS status">
              <span class="size-1.5 rounded-full" :class="gpsStatusTone"></span>
              {{ stage.location.status }}
            </Badge>
          </p>
        </div>
        <div class="min-w-0 border-b p-3">
          <p class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Gauge :size="12" />
            Speed
          </p>
          <p class="mt-1 text-sm font-semibold">{{ Math.round(stage.activeSpeedKph) }} km/h</p>
          <p class="mt-1 truncate text-[10px] text-muted-foreground">{{ formatMeters(stage.location.routeErrorMeters) }} route</p>
        </div>
        <div class="min-w-0 border-r p-3">
          <p class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Activity :size="12" />
            Lat G
          </p>
          <p class="mt-1 text-sm font-semibold">{{ formatG(sample?.lateralG) }}</p>
          <p class="mt-1 truncate text-[10px] text-muted-foreground">{{ formatG(sample?.verticalG) }} vert</p>
        </div>
        <div class="min-w-0 p-3">
          <p class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Compass :size="12" />
            Long G
          </p>
          <p class="mt-1 text-sm font-semibold">{{ formatG(sample?.longitudinalG) }}</p>
          <p class="mt-1 truncate text-[10px] text-muted-foreground">{{ formatHeading(sample?.orientationHeading ?? stage.location.heading) }}</p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
