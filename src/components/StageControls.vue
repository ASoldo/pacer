<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSortable } from '@vueuse/integrations/useSortable'
import L from 'leaflet'
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleOff,
  Flag,
  GripVertical,
  LocateFixed,
  MapPinPlus,
  Milestone,
  Pencil,
  RefreshCw,
  Route,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Trophy,
  X,
} from '@lucide/vue'
import { useStageStore } from '../stores/stage'
import { reverseLocation, searchLocations } from '../services/geocoding'
import type { LatLng, LocationSearchResult, StagePoint } from '../types'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const stage = useStageStore()
const circuitLapInput = ref(String(stage.circuitLapCount))
const circuitLapFocused = ref(false)
const locationQuery = ref('')
const pinpointTitle = ref('')
const pinpointQuery = ref('')
const pinpointSearchResults = ref<LocationSearchResult[]>([])
const pinpointSearchLoading = ref(false)
const pinpointSearchError = ref('')
const pinpointSearchOpen = ref(false)
const selectedSavedRouteId = ref('')
const selectedChampionshipId = ref('')
const championshipName = ref('Custom Championship')
const pointListEl = ref<HTMLElement | null>(null)
const pinpointMapEl = ref<HTMLElement | null>(null)
const draggedPointId = ref('')
const selectedSavedRoute = computed(() =>
  stage.savedRoutes.find((entry) => entry.id === selectedSavedRouteId.value) ?? null,
)
const savedRouteMenuLabel = computed(() => selectedSavedRoute.value?.name ?? 'Saved stages')
const savedChampionships = computed(() => stage.savedChampionships ?? [])
const selectedChampionship = computed(() =>
  savedChampionships.value.find((entry) => entry.id === selectedChampionshipId.value) ?? null,
)
const championshipMenuLabel = computed(() => selectedChampionship.value?.name ?? 'Championships')
let searchTimer: number | null = null
let pinpointSearchTimer: number | null = null
let pinpointSearchRequestId = 0
let pinpointReverseRequestId = 0
let suppressNextPinpointSearch = false
let pinpointMap: L.Map | null = null
let pinpointTileLayer: L.TileLayer | null = null
let pinpointMarker: L.Marker | null = null
let pinpointResizeFrame = 0
const tileUrl =
  import.meta.env.VITE_MAP_TILE_URL ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const tileAttribution =
  import.meta.env.VITE_MAP_ATTRIBUTION ??
  '&copy; OpenStreetMap contributors'
const tileMaxZoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM ?? 19)
const tileSubdomains = (import.meta.env.VITE_MAP_SUBDOMAINS ?? '').split('')

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

watch(pinpointQuery, (query) => {
  if (suppressNextPinpointSearch) {
    suppressNextPinpointSearch = false
    if (pinpointSearchTimer !== null) window.clearTimeout(pinpointSearchTimer)
    pinpointSearchTimer = null
    return
  }

  if (pinpointSearchTimer !== null) window.clearTimeout(pinpointSearchTimer)
  pinpointSearchTimer = window.setTimeout(() => {
    pinpointSearchTimer = null
    void searchPinpointLocations(query)
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
  if (outcome === 'manual') {
    pinpointTitle.value = ''
    setPinpointQuery(stage.pendingManualWaypointName, false)
    schedulePinpointMapSync()
  }
}

function editWaypoint(point: StagePoint) {
  const seed = routeLabelLocationSeed(point.name)
  stage.beginPendingManualWaypoint(point.name, { lat: point.lat, lng: point.lng }, point.id)
  pinpointTitle.value = point.name
  setPinpointQuery(seed, false)
  schedulePinpointMapSync()
  void seedPinpointQueryFromCoordinates(point, point.id)
}

function routeLabelLocationSeed(name: string) {
  return name.match(/^(Start \/ Finish|Start|Finish|Split \d+):\s*(.+)$/)?.[2]?.trim() ?? ''
}

function setPinpointQuery(value: string, search = true) {
  const changed = pinpointQuery.value !== value
  if (!search && changed) suppressNextPinpointSearch = true
  pinpointQuery.value = value
  if (!search) clearPinpointSearchResults()
  if (!changed) suppressNextPinpointSearch = false
}

function clearPinpointSearchResults() {
  if (pinpointSearchTimer !== null) window.clearTimeout(pinpointSearchTimer)
  pinpointSearchTimer = null
  pinpointSearchRequestId += 1
  pinpointSearchResults.value = []
  pinpointSearchLoading.value = false
  pinpointSearchError.value = ''
  pinpointSearchOpen.value = false
}

async function searchPinpointLocations(query: string) {
  const trimmed = query.trim()
  pinpointSearchError.value = ''

  if (!stage.pendingManualWaypointName || trimmed.length < 3) {
    clearPinpointSearchResults()
    return
  }

  pinpointSearchLoading.value = true
  pinpointSearchOpen.value = true
  const requestId = ++pinpointSearchRequestId

  try {
    const results = await searchLocations(trimmed)
    if (requestId !== pinpointSearchRequestId) return
    pinpointSearchResults.value = results
  } catch (error) {
    if (requestId !== pinpointSearchRequestId) return
    pinpointSearchResults.value = []
    pinpointSearchError.value = error instanceof Error ? error.message : 'Location search failed.'
  } finally {
    if (requestId === pinpointSearchRequestId) pinpointSearchLoading.value = false
  }
}

async function seedPinpointQueryFromCoordinates(point: StagePoint, pointId: string) {
  const requestId = ++pinpointReverseRequestId
  const startedWithQuery = pinpointQuery.value

  try {
    const result = await reverseLocation({ lat: point.lat, lng: point.lng })
    if (requestId !== pinpointReverseRequestId) return
    if (stage.pendingManualWaypointId !== pointId) return
    if (pinpointQuery.value !== startedWithQuery) return

    const nextName = (result?.query || result?.label || result?.name || '').trim()
    if (!nextName) return

    setPinpointQuery(nextName, false)
    stage.setPendingManualWaypointName(nextName)
  } catch {
    if (requestId === pinpointReverseRequestId && stage.pendingManualWaypointId === pointId && !startedWithQuery) {
      setPinpointQuery('', false)
    }
  }
}

function applyPinpointSearchResult(resultId: string) {
  const result = pinpointSearchResults.value.find((item) => item.id === resultId)
  if (!result) return

  const nextName = result.query || result.name
  setPinpointQuery(nextName, false)
  stage.setPendingManualWaypointName(nextName)
  setPinpoint({ lat: result.lat, lng: result.lng })
}

function saveRouteSnapshot() {
  const savedRouteId = stage.saveCurrentRoute(selectedSavedRouteId.value)
  if (savedRouteId) selectedSavedRouteId.value = savedRouteId
}

function selectSavedRoute(routeId: string) {
  selectedSavedRouteId.value = routeId
  loadSavedRoute(routeId)
}

function loadSavedRoute(routeId: string) {
  if (!routeId) return
  stage.loadSavedRoute(routeId)
}

function deleteSelectedSavedRoute() {
  const routeId = selectedSavedRouteId.value
  if (!routeId) return
  stage.removeSavedRoute(routeId)
  selectedSavedRouteId.value = ''
  if (selectedChampionship.value?.stageRouteIds.includes(routeId)) selectedChampionshipId.value = ''
}

function savedRouteLabel(savedRouteId: string) {
  const savedRoute = stage.savedRoutes.find((entry) => entry.id === savedRouteId)
  if (!savedRoute) return 'Saved routes'
  const routeStatus = savedRoute.route
    ? `${formatMeters(savedRoute.route.distance)} drive-ready`
    : `${savedRoute.waypoints.length} points draft`
  return `${savedRoute.name} - ${routeStatus}`
}

function savedRouteStatus(savedRouteId: string) {
  const savedRoute = stage.savedRoutes.find((entry) => entry.id === savedRouteId)
  if (!savedRoute) return ''
  return savedRoute.route
    ? `${formatMeters(savedRoute.route.distance)} - drive-ready`
    : `${savedRoute.waypoints.length} points - build before drive`
}

function saveChampionshipSnapshot() {
  const routeIds = stage.savedRoutes.map((entry) => entry.id)
  const championshipId = stage.saveChampionship(championshipName.value, routeIds, selectedChampionshipId.value)
  if (championshipId) selectedChampionshipId.value = championshipId
}

function selectChampionship(championshipId: string) {
  const championship = savedChampionships.value.find((entry) => entry.id === championshipId)
  if (!championship) return

  selectedChampionshipId.value = championship.id
  championshipName.value = championship.name
  const firstRouteId = championship.stageRouteIds.find((routeId) =>
    stage.savedRoutes.some((entry) => entry.id === routeId),
  )
  if (firstRouteId) selectSavedRoute(firstRouteId)
}

function deleteSelectedChampionship() {
  const championshipId = selectedChampionshipId.value
  if (!championshipId) return
  stage.removeChampionship(championshipId)
  selectedChampionshipId.value = ''
}

function championshipStatus(championshipId: string) {
  const championship = savedChampionships.value.find((entry) => entry.id === championshipId)
  if (!championship) return ''
  const validStages = championship.stageRouteIds.filter((routeId) =>
    stage.savedRoutes.some((entry) => entry.id === routeId),
  ).length
  return `${validStages} ${validStages === 1 ? 'stage' : 'stages'}`
}

function setPinpoint(point: LatLng) {
  stage.setPendingManualWaypointPoint(point)
  pinpointMarker?.setLatLng([point.lat, point.lng])
}

function schedulePinpointMapSync() {
  if (pinpointResizeFrame) window.cancelAnimationFrame(pinpointResizeFrame)
  pinpointResizeFrame = window.requestAnimationFrame(() => {
    pinpointResizeFrame = 0
    syncPinpointMap()
  })
}

function syncPinpointMap() {
  const point = stage.pendingManualWaypointPoint
  if (!pinpointMapEl.value || !point) return

  if (!pinpointMap) {
    pinpointMap = L.map(pinpointMapEl.value, {
      attributionControl: false,
      zoomControl: false,
    }).setView([point.lat, point.lng], Math.min(17, tileMaxZoom))

    pinpointTileLayer = L.tileLayer(tileUrl, {
      maxZoom: tileMaxZoom,
      keepBuffer: 3,
      detectRetina: false,
      subdomains: tileSubdomains,
      attribution: tileAttribution,
    }).addTo(pinpointMap)

    pinpointMap.on('click', (event) => {
      setPinpoint({ lat: event.latlng.lat, lng: event.latlng.lng })
    })
  }

  if (pinpointTileLayer && !pinpointMap.hasLayer(pinpointTileLayer)) {
    pinpointTileLayer.addTo(pinpointMap)
  }

  if (!pinpointMarker) {
    pinpointMarker = L.marker([point.lat, point.lng], {
      draggable: true,
      icon: L.divIcon({
        className: 'route-pinpoint-marker',
        iconSize: [38, 38],
        iconAnchor: [19, 31],
        html: '<span></span>',
      }),
    }).addTo(pinpointMap)
    pinpointMarker.on('dragend', () => {
      const next = pinpointMarker?.getLatLng()
      if (!next) return
      setPinpoint({ lat: next.lat, lng: next.lng })
    })
  } else {
    pinpointMarker.setLatLng([point.lat, point.lng])
  }

  pinpointMap.setView([point.lat, point.lng], Math.max(pinpointMap.getZoom(), Math.min(17, tileMaxZoom)), {
    animate: false,
  })
  pinpointMap.invalidateSize({ pan: false })
}

function confirmPendingManualWaypoint() {
  const point = stage.pendingManualWaypointPoint
  if (!point) return
  const nextName = pinpointQuery.value.trim()
  if (nextName) stage.setPendingManualWaypointName(nextName)
  if (stage.placePendingManualWaypoint(point)) {
    pinpointReverseRequestId += 1
    pinpointTitle.value = ''
    setPinpointQuery('', false)
  }
}

function cancelPendingManualWaypoint() {
  pinpointReverseRequestId += 1
  stage.cancelPendingManualWaypoint()
  pinpointTitle.value = ''
  setPinpointQuery('', false)
}

function destroyPinpointMap() {
  pinpointReverseRequestId += 1
  if (pinpointResizeFrame) window.cancelAnimationFrame(pinpointResizeFrame)
  if (pinpointSearchTimer !== null) window.clearTimeout(pinpointSearchTimer)
  pinpointResizeFrame = 0
  pinpointSearchTimer = null
  pinpointMap?.remove()
  pinpointMap = null
  pinpointTileLayer = null
  pinpointMarker = null
}

useSortable(pointListEl, stage.waypoints, {
  animation: 150,
  chosenClass: 'waypoint-sortable-chosen',
  dragClass: 'waypoint-sortable-drag',
  draggable: '[data-point-id]',
  fallbackOnBody: true,
  ghostClass: 'waypoint-sortable-ghost',
  handle: '[data-point-drag-handle]',
  swapThreshold: 0.65,
  delay: 90,
  delayOnTouchOnly: true,
  touchStartThreshold: 4,
  onStart(event) {
    draggedPointId.value = (event.item as HTMLElement).dataset.pointId ?? ''
  },
  onEnd() {
    draggedPointId.value = ''
  },
  onUpdate(event) {
    const pointId = (event.item as HTMLElement).dataset.pointId ?? ''
    if (!pointId || typeof event.newIndex !== 'number') return

    stage.moveWaypointToIndex(pointId, event.newIndex)
  },
})

watch(
  () => [
    stage.pendingManualWaypointName,
    stage.pendingManualWaypointPoint?.lat ?? 0,
    stage.pendingManualWaypointPoint?.lng ?? 0,
  ],
  () => {
    if (!stage.pendingManualWaypointName || !stage.pendingManualWaypointPoint) {
      destroyPinpointMap()
      return
    }

    void nextTick(schedulePinpointMapSync)
  },
  { flush: 'post' },
)

onBeforeUnmount(destroyPinpointMap)
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
              Pinpoint
              <b class="text-amber-300">{{ stage.pendingManualWaypointName }}</b>.
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 shrink-0 px-2 text-amber-200 hover:text-amber-100"
              type="button"
              @click="cancelPendingManualWaypoint"
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
                    v-if="result.precision !== 'address'"
                    class="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-amber-400"
                  >
                    pinpoint
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

        <div class="grid gap-2 rounded-md border bg-muted/10 p-2">
          <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <DropdownMenu :modal="false">
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  class="min-w-0 justify-between px-3 text-left"
                  type="button"
                  aria-label="Saved stages"
                  title="Saved stages"
                  data-testid="saved-stage-trigger"
                >
                  <span class="truncate">{{ savedRouteMenuLabel }}</span>
                  <ChevronDown :size="14" class="shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" class="max-h-72 p-1" data-testid="saved-stage-menu">
                <DropdownMenuLabel class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Stage library
                </DropdownMenuLabel>
                <DropdownMenuItem
                  v-if="stage.savedRoutes.length === 0"
                  disabled
                  class="text-xs text-muted-foreground"
                >
                  No saved stages
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-for="savedRoute in stage.savedRoutes"
                  :key="savedRoute.id"
                  class="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 py-2"
                  @select.prevent="selectSavedRoute(savedRoute.id)"
                >
                  <span class="min-w-0">
                    <b class="block truncate text-xs text-foreground">{{ savedRoute.name }}</b>
                    <span class="block truncate text-[11px] text-muted-foreground">
                      {{ savedRouteStatus(savedRoute.id) }}
                    </span>
                  </span>
                  <Check v-if="selectedSavedRouteId === savedRoute.id" :size="14" class="text-primary" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  :disabled="stage.waypoints.length < 2"
                  class="gap-2 text-xs font-semibold"
                  @select.prevent="saveRouteSnapshot"
                >
                  <Save :size="13" />
                  Save current stage
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              class="justify-center px-3"
              :disabled="stage.waypoints.length < 2"
              aria-label="Save current stage"
              title="Save current stage"
              @click="saveRouteSnapshot"
            >
              <Save :size="13" />
              Save
            </Button>
          </div>
          <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <p class="min-w-0 truncate text-[11px] text-muted-foreground">
              {{ selectedSavedRouteId ? savedRouteLabel(selectedSavedRouteId) : 'Save point drafts or built stages for later recce and drive setup.' }}
            </p>
            <Button
              variant="outline"
              size="icon-sm"
              type="button"
              :disabled="!selectedSavedRouteId"
              aria-label="Delete saved route"
              title="Delete saved route"
              @click="deleteSelectedSavedRoute"
            >
              <Trash2 :size="13" />
            </Button>
          </div>

          <div class="grid gap-2 border-t pt-2">
            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                v-model="championshipName"
                class="h-8 text-xs font-semibold"
                autocomplete="off"
                title="Championship name"
                placeholder="Championship name"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                class="h-8 gap-1.5 px-2 text-xs"
                :disabled="stage.savedRoutes.length === 0"
                aria-label="Save championship"
                title="Save championship from saved stages"
                @click="saveChampionshipSnapshot"
              >
                <Trophy :size="13" />
                Save
              </Button>
            </div>
            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <DropdownMenu :modal="false">
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    class="h-8 min-w-0 justify-between px-3 text-left text-xs"
                    type="button"
                    aria-label="Saved championships"
                    title="Saved championships"
                    data-testid="saved-championship-trigger"
                  >
                    <span class="truncate">{{ championshipMenuLabel }}</span>
                    <ChevronDown :size="14" class="shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="bottom" class="max-h-72 p-1" data-testid="saved-championship-menu">
                  <DropdownMenuLabel class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Custom championships
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-if="savedChampionships.length === 0"
                    disabled
                    class="text-xs text-muted-foreground"
                  >
                    No championships
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-for="championship in savedChampionships"
                    :key="championship.id"
                    class="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 py-2"
                    @select.prevent="selectChampionship(championship.id)"
                  >
                    <span class="min-w-0">
                      <b class="block truncate text-xs text-foreground">{{ championship.name }}</b>
                      <span class="block truncate text-[11px] text-muted-foreground">
                        {{ championshipStatus(championship.id) }}
                      </span>
                    </span>
                    <Check v-if="selectedChampionshipId === championship.id" :size="14" class="text-primary" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="icon-sm"
                type="button"
                :disabled="!selectedChampionshipId"
                aria-label="Delete championship"
                title="Delete championship"
                @click="deleteSelectedChampionship"
              >
                <Trash2 :size="13" />
              </Button>
            </div>
          </div>
        </div>
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

    <div ref="pointListEl" class="flex flex-col gap-2">
      <article
        v-for="(point, index) in stage.waypoints"
        :key="point.id"
        :data-point-id="point.id"
        class="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-1.5 rounded-md border bg-card p-2 transition"
        :class="draggedPointId === point.id ? 'opacity-45 ring-1 ring-primary/40' : 'hover:bg-muted/35'"
      >
        <button
          class="grid h-8 w-6 touch-none cursor-grab select-none place-items-center rounded text-muted-foreground active:cursor-grabbing"
          type="button"
          title="Drag to reorder point"
          aria-label="Drag to reorder point"
          data-point-drag-handle
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
          aria-label="Edit point"
          title="Edit point"
          type="button"
          @click="editWaypoint(point)"
        >
          <Pencil :size="13" />
        </Button>
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

    <Teleport to="body">
      <div
        v-if="stage.pendingManualWaypointName && stage.pendingManualWaypointPoint"
        class="fixed inset-0 z-[9500] grid place-items-center bg-background/55 p-3 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-pinpoint-title"
        data-testid="route-pinpoint-dialog"
      >
        <section class="grid w-[min(24rem,calc(100vw_-_1.5rem))] gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-2xl">
          <header class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div class="min-w-0">
              <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {{ stage.pendingManualWaypointId ? 'Edit point' : 'Pinpoint point' }}
              </p>
              <p id="route-pinpoint-title" class="truncate text-sm font-black">
                {{ pinpointTitle || stage.pendingManualWaypointName }}
              </p>
              <p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {{ stage.pendingManualWaypointPoint.lat.toFixed(5) }},
                {{ stage.pendingManualWaypointPoint.lng.toFixed(5) }}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label="Cancel pinpoint"
              title="Cancel pinpoint"
              @click="cancelPendingManualWaypoint"
            >
              <X :size="14" />
            </Button>
          </header>
          <div class="grid gap-2">
            <Label for="route-pinpoint-search" class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Search
            </Label>
            <div class="relative">
              <Search
                :size="15"
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="route-pinpoint-search"
                v-model="pinpointQuery"
                class="pl-8"
                autocomplete="off"
                placeholder="Street, number, place"
                title="Search for point location"
                data-testid="route-pinpoint-search"
                @keydown.enter.prevent="pinpointSearchResults[0] && applyPinpointSearchResult(pinpointSearchResults[0].id)"
              />
            </div>
            <div
              v-if="pinpointSearchOpen || pinpointSearchLoading || pinpointSearchError"
              class="grid max-h-32 gap-1 overflow-y-auto"
              data-testid="route-pinpoint-results"
            >
              <button
                v-for="result in pinpointSearchResults"
                :key="result.id"
                class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 rounded-md border bg-background/80 p-2 text-left text-xs transition hover:bg-muted/60"
                type="button"
                :title="result.label"
                @click="applyPinpointSearchResult(result.id)"
              >
                <MapPinPlus :size="15" class="text-primary" />
                <span class="min-w-0">
                  <b class="flex min-w-0 items-center gap-1.5 text-foreground">
                    <span class="truncate">{{ result.name }}</span>
                    <small
                      v-if="result.precision !== 'address'"
                      class="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-amber-400"
                    >
                      pinpoint
                    </small>
                  </b>
                  <span class="block truncate text-muted-foreground">{{ result.label }}</span>
                </span>
              </button>
              <p v-if="pinpointSearchLoading" class="px-1 text-xs text-muted-foreground">Searching</p>
              <p v-else-if="pinpointSearchError" class="px-1 text-xs text-destructive">{{ pinpointSearchError }}</p>
              <p v-else-if="pinpointQuery.trim().length >= 3 && pinpointSearchResults.length === 0" class="px-1 text-xs text-muted-foreground">
                No results
              </p>
            </div>
          </div>
          <div
            ref="pinpointMapEl"
            class="h-56 overflow-hidden rounded-md border bg-muted"
            data-testid="route-pinpoint-map"
          />
          <div class="grid grid-cols-2 gap-2">
            <Button variant="outline" type="button" @click="cancelPendingManualWaypoint">
              Cancel
            </Button>
            <Button type="button" @click="confirmPendingManualWaypoint">
              <Check :size="15" />
              Confirm
            </Button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.waypoint-sortable-ghost {
  opacity: 0.35;
}

.waypoint-sortable-chosen {
  border-color: hsl(var(--primary) / 0.65);
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.35);
}

.waypoint-sortable-drag {
  opacity: 0.95;
}

:global(.route-pinpoint-marker) {
  display: grid;
  place-items: center;
  pointer-events: auto !important;
  z-index: 1000 !important;
}

:global(.route-pinpoint-marker span) {
  position: relative;
  display: block;
  width: 28px;
  height: 28px;
  border: 2px solid hsl(var(--background));
  border-radius: 999px 999px 999px 0;
  background: #22c55e;
  box-shadow: 0 0 0 3px hsl(var(--background) / 0.75), 0 0 0 7px rgb(34 197 94 / 0.28), 0 12px 24px hsl(0 0% 0% / 0.48);
  transform: rotate(-45deg);
}

:global(.route-pinpoint-marker span::after) {
  position: absolute;
  inset: 7px;
  border-radius: 999px;
  background: hsl(var(--background));
  content: '';
}
</style>
