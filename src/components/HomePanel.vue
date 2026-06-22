<script setup lang="ts">
import { computed } from 'vue'
import {
  CarFront,
  Flag,
  Gauge,
  History,
  Map,
} from '@lucide/vue'
import { useStageStore } from '../stores/stage'
import { formatMeters } from '../utils/geo'
import { vehicleVisualUrl } from '../services/vehicleVisuals'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const emit = defineEmits<{
  drive: []
  garage: []
  stage: []
  runs: []
  shakedown: []
}>()

const stage = useStageStore()
const vehicleAvatarUrl = computed(() => vehicleVisualUrl(stage.vehicle, 'avatarUrl'))
const routeLabel = computed(() => stage.route ? formatMeters(stage.route.distance) : 'No route')
const readinessItems = computed(() => [
  {
    id: 'vehicle',
    label: 'Vehicle',
    value: stage.vehicle.decodeConfidence === 'confirmed' ? 'Confirmed' : 'Pending',
    active: stage.vehicle.decodeConfidence === 'confirmed',
  },
  {
    id: 'route',
    label: 'Route',
    value: stage.route ? routeLabel.value : 'Pending',
    active: Boolean(stage.route),
  },
  {
    id: 'notes',
    label: 'Co-driver',
    value: stage.paceNotes.length ? `${stage.paceNotes.length}` : 'Pending',
    active: stage.paceNotes.length > 0,
  },
])
</script>

<template>
  <section class="mx-auto grid w-full max-w-7xl content-start gap-4 overflow-visible bg-background p-4 lg:overflow-auto lg:p-6" data-testid="home-panel">
    <div class="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card class="border-border bg-card shadow-none">
        <CardHeader class="grid gap-4 border-b md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div class="min-w-0">
            <CardDescription class="uppercase tracking-[0.14em]">Stage operations</CardDescription>
            <CardTitle class="mt-2 truncate text-2xl font-semibold tracking-tight md:text-3xl">
              {{ stage.stageName }}
            </CardTitle>
            <CardDescription class="mt-2 max-w-prose">
              Confirm the car, route, co-driver calls, and shakedown state before opening the cockpit.
            </CardDescription>
          </div>
          <div class="flex flex-wrap items-center gap-2 md:justify-end">
            <Badge :variant="stage.route ? 'success' : 'warning'">
              {{ stage.route ? 'Route ready' : 'Route pending' }}
            </Badge>
            <Button
              type="button"
              class="gap-2"
              :disabled="!stage.route"
              data-testid="home-drive-button"
              @click="emit('drive')"
            >
              <span class="material-symbols-outlined drive-map-cta__icon" aria-hidden="true">sports_motorsports</span>
              Drive
            </Button>
          </div>
        </CardHeader>
        <CardContent class="grid gap-3 md:grid-cols-3">
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mode</span>
            <strong class="mt-1 block truncate text-sm font-semibold text-foreground">
              {{ stage.routeMode === 'closed-circuit' ? 'Circuit' : 'Stage' }}
            </strong>
          </div>
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Route</span>
            <strong class="mt-1 block truncate text-sm font-semibold text-foreground">{{ routeLabel }}</strong>
          </div>
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runs</span>
            <strong class="mt-1 block truncate text-sm font-semibold text-foreground">{{ stage.driveRuns.length }}</strong>
          </div>
        </CardContent>
      </Card>

      <Card class="border-border bg-card shadow-none">
        <CardHeader class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b">
          <Avatar size="lg">
            <AvatarImage v-if="vehicleAvatarUrl" :src="vehicleAvatarUrl" :alt="stage.vehicleTitle" />
            <AvatarFallback>
              <CarFront :size="18" />
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0 overflow-hidden">
            <CardDescription class="truncate uppercase tracking-[0.14em]">Driver profile</CardDescription>
            <CardTitle class="truncate text-base font-semibold">Rootster</CardTitle>
          </div>
        </CardHeader>
        <CardContent class="grid gap-2">
          <div class="min-w-0 overflow-hidden rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Car</span>
            <strong class="mt-1 block max-w-full truncate text-sm">{{ stage.vehicleTitle }}</strong>
          </div>
          <div class="min-w-0 overflow-hidden rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Setup</span>
            <strong class="mt-1 block truncate text-sm">{{ stage.vehicle.modifications.length }} mods</strong>
          </div>
        </CardContent>
        <CardFooter class="border-t">
          <Button variant="ghost" class="w-full justify-center" type="button" @click="emit('garage')">
            <CarFront :size="16" />
            Garage
          </Button>
        </CardFooter>
      </Card>
    </div>

    <div class="grid items-start gap-3 md:grid-cols-3">
      <Card size="sm" class="border-border bg-card shadow-none">
        <CardHeader class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b">
          <div class="grid h-10 w-10 place-items-center rounded-md border bg-muted/30 text-foreground">
            <Flag :size="22" />
          </div>
          <div class="min-w-0">
            <CardDescription class="truncate text-[0.68rem] uppercase tracking-[0.14em]">Active Stage</CardDescription>
            <CardTitle class="truncate text-sm font-semibold">{{ stage.stageName }}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div class="grid overflow-hidden rounded-md border">
          <div
            v-for="item in readinessItems"
            :key="item.id"
            class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2 last:border-b-0"
            :class="{ 'is-active': item.active }"
          >
            <span class="size-1.5 rounded-full" :class="item.active ? 'bg-emerald-500' : 'bg-amber-500'"></span>
            <span class="truncate text-xs font-medium">{{ item.label }}</span>
            <Badge :variant="item.active ? 'success' : 'muted'" class="text-[0.62rem]">
              {{ item.value }}
            </Badge>
          </div>
          </div>
        </CardContent>
        <CardFooter class="border-t">
          <Button variant="ghost" class="w-full justify-center" type="button" @click="emit('stage')">
          <Map :size="16" />
          Stage Builder
          </Button>
        </CardFooter>
      </Card>

      <Card size="sm" class="border-border bg-card shadow-none">
        <CardHeader class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b">
          <div class="grid h-10 w-10 place-items-center rounded-md border bg-muted/30 text-foreground">
            <Gauge :size="22" />
          </div>
          <div class="min-w-0">
            <CardDescription class="truncate text-[0.68rem] uppercase tracking-[0.14em]">Shakedown</CardDescription>
            <CardTitle class="truncate text-sm font-semibold">{{ stage.simulation.speedMode === 'adaptive' ? 'Adaptive pace' : 'Fixed pace' }}</CardTitle>
          </div>
        </CardHeader>
        <CardContent class="grid gap-2">
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Speed</span>
            <strong class="mt-1 block truncate text-sm">{{ stage.simulation.speedMode === 'adaptive' ? stage.simulation.targetSpeedKph : stage.simulation.speedKph }} km/h</strong>
          </div>
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ghost</span>
            <strong class="mt-1 block truncate text-sm">{{ stage.display.ghostTargetKph }} km/h</strong>
          </div>
        </CardContent>
        <CardFooter class="border-t">
          <Button variant="ghost" class="w-full justify-center" type="button" @click="emit('shakedown')">
          <Gauge :size="16" />
          Shakedown
          </Button>
        </CardFooter>
      </Card>

      <Card size="sm" class="border-border bg-card shadow-none">
        <CardHeader class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b">
          <div class="grid h-10 w-10 place-items-center rounded-md border bg-muted/30 text-foreground">
            <History :size="22" />
          </div>
          <div class="min-w-0">
            <CardDescription class="truncate text-[0.68rem] uppercase tracking-[0.14em]">Debrief</CardDescription>
            <CardTitle class="truncate text-sm font-semibold">{{ stage.currentDriveRun?.stageName ?? 'No ghost selected' }}</CardTitle>
          </div>
        </CardHeader>
        <CardContent class="grid gap-2">
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runs</span>
            <strong class="mt-1 block truncate text-sm">{{ stage.driveRuns.length }}</strong>
          </div>
          <div class="rounded-md border bg-muted/20 p-3">
            <span class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</span>
            <strong class="mt-1 block truncate text-sm">{{ stage.driveAttempt.status }}</strong>
          </div>
        </CardContent>
        <CardFooter class="border-t">
          <Button variant="ghost" class="w-full justify-center" type="button" @click="emit('runs')">
          <History :size="16" />
          Debrief
          </Button>
        </CardFooter>
      </Card>
    </div>
  </section>
</template>
