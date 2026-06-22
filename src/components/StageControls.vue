<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  CircleOff,
  Flag,
  LocateFixed,
  MapPinPlus,
  Milestone,
  RefreshCw,
  Route,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { useStageStore } from '../stores/stage'
import { formatMeters } from '../utils/geo'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const stage = useStageStore()
const circuitLapInput = ref(String(stage.circuitLapCount))
const circuitLapFocused = ref(false)

watch(
  () => stage.circuitLapCount,
  (value) => {
    if (!circuitLapFocused.value) circuitLapInput.value = String(value)
  },
)

function setRouteMode(value: unknown) {
  if (value === 'point-to-point' || value === 'closed-circuit') {
    stage.routeMode = value
  }
}

function setCircuitLapInput(value: string | number) {
  const nextValue = String(value)
  const digits = nextValue.replace(/\D/g, '')
  circuitLapInput.value = digits
  if (digits.length > 0) {
    stage.setCircuitLapCount(Number(digits))
  }
}

function commitCircuitLapInput() {
  circuitLapFocused.value = false
  if (circuitLapInput.value.length === 0) {
    stage.setCircuitLapCount(1)
  }
  circuitLapInput.value = String(stage.circuitLapCount)
}

function addCurrentLocation() {
  if (!navigator.geolocation) {
    stage.routeError = 'Browser location is not available.'
    return
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      stage.addWaypoint({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      })
    },
    (error) => {
      stage.routeError = error.message
    },
    {
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 5_000,
    },
  )
}
</script>

<template>
  <section class="flex h-auto flex-col gap-3 overflow-visible bg-background p-3 lg:h-full lg:overflow-auto">
    <Card class="border-border bg-card shadow-none">
      <CardHeader class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b">
        <div class="min-w-0">
          <Label for="stage-name" class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Stage
          </Label>
          <Input
            id="stage-name"
            v-model="stage.stageName"
            class="mt-1 text-sm font-semibold"
            title="Stage name"
          />
        </div>
        <Button
          variant="outline"
          size="icon-lg"
          class="shrink-0"
          aria-label="Load demo stage"
          title="Load demo stage"
          type="button"
          @click="stage.loadDemo()"
        >
          <Milestone :size="17" />
        </Button>
      </CardHeader>
      <CardContent class="grid gap-3">
        <ToggleGroup
          type="single"
          :model-value="stage.routeMode"
          class="grid w-full grid-cols-2 rounded-md bg-muted p-1"
          @update:model-value="setRouteMode"
        >
          <ToggleGroupItem
            value="point-to-point"
            class="w-full justify-center"
            title="Point-to-point stage route"
            data-testid="route-mode-stage"
          >
            <Flag :size="14" />
            Stage
          </ToggleGroupItem>
          <ToggleGroupItem
            value="closed-circuit"
            class="w-full justify-center"
            title="Closed-circuit route"
            data-testid="route-mode-circuit"
          >
            <CircleOff :size="14" />
            Circuit
          </ToggleGroupItem>
        </ToggleGroup>

        <div class="grid grid-cols-4 gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            class="w-full"
            aria-label="Add current GPS position"
            title="Add current GPS position"
            type="button"
            @click="addCurrentLocation"
          >
            <LocateFixed :size="16" />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            class="w-full"
            aria-label="Reverse direction"
            title="Reverse direction"
            type="button"
            @click="stage.reverseWaypoints()"
          >
            <RotateCcw :size="16" />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            class="w-full"
            aria-label="Clear stage"
            title="Clear stage"
            type="button"
            @click="stage.clearStage()"
          >
            <Trash2 :size="16" />
          </Button>
          <Button
            variant="outline"
            size="icon-lg"
            class="w-full"
            aria-label="Regenerate pacenotes"
            title="Regenerate pacenotes"
            type="button"
            :disabled="!stage.route"
            @click="stage.regenerateNotes()"
          >
            <RefreshCw :size="16" />
          </Button>
        </div>

        <Button
          class="w-full justify-center"
          type="button"
          title="Build route from stage points"
          :disabled="stage.loadingRoute || stage.waypoints.length < 2"
          @click="stage.buildRoute()"
        >
          <Route :size="17" />
          {{ stage.loadingRoute ? 'Building' : 'Build route' }}
        </Button>
      </CardContent>
    </Card>

    <Card
      v-if="stage.routeMode === 'closed-circuit'"
      class="border-border bg-card shadow-none"
      data-testid="circuit-lap-control"
    >
      <CardContent class="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2 p-3">
        <div class="min-w-0">
          <CardTitle class="text-xs font-semibold">Circuit laps</CardTitle>
          <CardDescription class="mt-1 text-[11px]">
            Timing finishes after this many laps.
          </CardDescription>
        </div>
        <Input
          v-model="circuitLapInput"
          class="text-center font-mono font-black"
          inputmode="numeric"
          pattern="[0-9]*"
          title="Circuit lap count"
          type="text"
          data-testid="circuit-lap-input"
          @focus="circuitLapFocused = true"
          @update:model-value="setCircuitLapInput"
          @blur="commitCircuitLapInput"
        />
      </CardContent>
    </Card>

    <Alert v-if="stage.routeError" variant="destructive">
      <AlertDescription>{{ stage.routeError }}</AlertDescription>
    </Alert>

    <Card class="border-border bg-card shadow-none">
      <CardContent class="grid grid-cols-2 divide-x p-0">
        <div class="min-w-0 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Points</p>
          <p class="mt-1 text-sm font-semibold">{{ stage.waypoints.length }}</p>
        </div>
        <div class="min-w-0 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Distance</p>
          <p class="mt-1 truncate text-sm font-semibold">{{ stage.route ? formatMeters(stage.route.distance) : 'No route' }}</p>
        </div>
      </CardContent>
    </Card>

    <div class="flex flex-col gap-2">
      <article
        v-for="point in stage.waypoints"
        :key="point.id"
        class="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border bg-card p-2"
      >
        <MapPinPlus :size="16" class="text-primary" />
        <div class="min-w-0">
          <p class="truncate text-xs font-bold">{{ point.name }}</p>
          <p class="truncate font-mono text-xs text-muted-foreground">
            {{ point.lat.toFixed(5) }}, {{ point.lng.toFixed(5) }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove point"
          title="Remove point"
          type="button"
          @click="stage.removeWaypoint(point.id)"
        >
          <Trash2 :size="13" />
        </Button>
      </article>
      <Empty v-if="stage.waypoints.length === 0" class="border bg-muted/10 py-5">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MapPinPlus />
          </EmptyMedia>
          <EmptyTitle>No points</EmptyTitle>
          <EmptyDescription>Add GPS or map points to build a stage route.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  </section>
</template>
