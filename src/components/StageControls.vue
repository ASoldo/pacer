<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  ChevronDown,
  ChevronUp,
  CircleOff,
  Flag,
  GripVertical,
  LocateFixed,
  MapPinPlus,
  Milestone,
  RefreshCw,
  Route,
  RotateCcw,
  Search,
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
const emit = defineEmits<{
  'manual-place': []
}>()
const circuitLapInput = ref(String(stage.circuitLapCount))
const circuitLapFocused = ref(false)
const locationQuery = ref('')
const draggedPointId = ref('')
let searchTimer: number | null = null

watch(
  () => stage.circuitLapCount,
  (value) => {
    if (!circuitLapFocused.value) circuitLapInput.value = String(value)
  },
)

watch(locationQuery, (query) => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    searchTimer = null
    void stage.searchRouteLocations(query)
  }, 320)
})

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

function addSearchResult(resultId: string) {
  const result = stage.locationSearchResults.find((item) => item.id === resultId)
  if (!result) return

  const outcome = stage.addSearchResultWaypoint(result)
  locationQuery.value = ''
  if (outcome === 'manual') emit('manual-place')
}

function startPointDrag(pointId: string, event: DragEvent) {
  draggedPointId.value = pointId
  event.dataTransfer?.setData('text/plain', pointId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dropPoint(targetPointId: string, event: DragEvent) {
  event.preventDefault()
  const sourcePointId = event.dataTransfer?.getData('text/plain') || draggedPointId.value
  draggedPointId.value = ''
  if (!sourcePointId) return
  stage.moveWaypointBefore(sourcePointId, targetPointId)
}

function endPointDrag() {
  draggedPointId.value = ''
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
        <Alert v-if="stage.pendingManualWaypointName" class="border-amber-500/35 bg-amber-500/10">
          <AlertDescription class="flex items-center justify-between gap-2 text-xs text-amber-100">
            <span class="min-w-0">
              Pick the exact map point for
              <b class="text-amber-300">{{ stage.pendingManualWaypointName }}</b>.
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 shrink-0 px-2 text-amber-200 hover:text-amber-100"
              type="button"
              @click="stage.cancelPendingManualWaypoint()"
            >
              Cancel
            </Button>
          </AlertDescription>
        </Alert>

        <ToggleGroup
          type="single"
          :model-value="stage.routeMode"
          class="grid w-full grid-cols-2 rounded-md bg-muted p-1"
          @update:model-value="setRouteMode"
        >
          <ToggleGroupItem
            value="point-to-point"
            class="w-full justify-center"
            :class="stage.routeMode === 'point-to-point' ? 'bg-card text-primary shadow-sm ring-1 ring-border' : 'text-muted-foreground'"
            title="Point-to-point stage route"
            data-testid="route-mode-stage"
          >
            <Flag :size="14" />
            Stage
          </ToggleGroupItem>
          <ToggleGroupItem
            value="closed-circuit"
            class="w-full justify-center"
            :class="stage.routeMode === 'closed-circuit' ? 'bg-card text-primary shadow-sm ring-1 ring-border' : 'text-muted-foreground'"
            title="Closed-circuit route"
            data-testid="route-mode-circuit"
          >
            <CircleOff :size="14" />
            Circuit
          </ToggleGroupItem>
        </ToggleGroup>

        <div class="grid gap-2">
          <Label for="route-location-search" class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Search points
          </Label>
          <div class="relative">
            <Search
              :size="15"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="route-location-search"
              v-model="locationQuery"
              class="pl-8"
              autocomplete="off"
              placeholder="Street, place, junction"
              title="Search for route point"
              data-testid="route-location-search"
              @keydown.enter.prevent="stage.locationSearchResults[0] && addSearchResult(stage.locationSearchResults[0].id)"
            />
          </div>
          <div
            v-if="locationQuery.trim().length >= 3 || stage.locationSearchLoading || stage.locationSearchError"
            class="grid gap-1"
            data-testid="route-location-results"
          >
            <button
              v-for="result in stage.locationSearchResults"
              :key="result.id"
              class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 rounded-md border bg-card p-2 text-left text-xs transition hover:bg-muted/60"
              type="button"
              :title="result.label"
              @click="addSearchResult(result.id)"
            >
              <MapPinPlus :size="15" class="text-primary" />
              <span class="min-w-0">
                <b class="flex min-w-0 items-center gap-1.5 text-foreground">
                  <span class="truncate">{{ result.name }}</span>
                  <small
                    v-if="result.precision !== 'address' && /\\d/.test(result.query)"
                    class="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-amber-400"
                  >
                    approx.
                  </small>
                </b>
                <span class="block truncate text-muted-foreground">{{ result.label }}</span>
              </span>
            </button>
            <p v-if="stage.locationSearchLoading" class="px-1 text-xs text-muted-foreground">Searching</p>
            <p v-else-if="stage.locationSearchError" class="px-1 text-xs text-destructive">{{ stage.locationSearchError }}</p>
            <p v-else-if="locationQuery.trim().length >= 3 && stage.locationSearchResults.length === 0" class="px-1 text-xs text-muted-foreground">
              No results
            </p>
          </div>
        </div>

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
        v-for="(point, index) in stage.waypoints"
        :key="point.id"
        class="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-1.5 rounded-md border bg-card p-2 transition"
        :class="draggedPointId === point.id ? 'opacity-45' : 'hover:bg-muted/35'"
        draggable="true"
        @dragstart="startPointDrag(point.id, $event)"
        @dragend="endPointDrag"
        @dragover.prevent
        @drop="dropPoint(point.id, $event)"
      >
        <button
          class="grid h-8 w-6 cursor-grab place-items-center rounded text-muted-foreground active:cursor-grabbing"
          type="button"
          title="Drag to reorder point"
          aria-label="Drag to reorder point"
          draggable="true"
          @dragstart="startPointDrag(point.id, $event)"
        >
          <GripVertical :size="15" />
        </button>
        <div class="min-w-0">
          <Input
            :model-value="point.name"
            class="h-7 border-transparent bg-transparent px-0 text-xs font-bold shadow-none focus-visible:border-border focus-visible:px-2"
            title="Point name"
            @update:model-value="(value) => stage.renameWaypoint(point.id, String(value))"
          />
          <p class="truncate font-mono text-xs text-muted-foreground">
            {{ point.lat.toFixed(5) }}, {{ point.lng.toFixed(5) }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move point up"
          title="Move point up"
          type="button"
          :disabled="index === 0"
          @click="stage.moveWaypoint(point.id, -1)"
        >
          <ChevronUp :size="13" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move point down"
          title="Move point down"
          type="button"
          :disabled="index === stage.waypoints.length - 1"
          @click="stage.moveWaypoint(point.id, 1)"
        >
          <ChevronDown :size="13" />
        </Button>
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
