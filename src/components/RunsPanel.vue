<script setup lang="ts">
import { computed } from 'vue'
import { Gauge, History, Trash2, Trophy } from '@lucide/vue'
import { useStageStore } from '../stores/stage'
import { formatMeters } from '../utils/geo'
import { Badge } from '@/components/ui/badge'
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

const stage = useStageStore()
const runs = computed(() => stage.driveRuns)

function formatClock(value: number) {
  const safe = Math.max(0, Math.round(value))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatDate(value: number) {
  if (!value) return 'pending'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
</script>

<template>
  <section class="mx-auto grid w-full max-w-5xl content-start gap-4 overflow-visible bg-background p-4 lg:overflow-auto lg:p-6" data-testid="runs-panel">
    <div class="flex items-center justify-between gap-3 border-b pb-4">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runs</p>
        <h2 class="truncate text-xl font-semibold tracking-tight">Ghosts & history</h2>
      </div>
      <Badge variant="secondary" class="h-8 px-3 font-mono font-semibold">{{ runs.length }}</Badge>
    </div>

    <Card
      class="border-border bg-card shadow-none"
      data-testid="drive-session-status"
    >
      <CardHeader class="grid grid-cols-[minmax(0,1fr)_auto] items-center border-b">
        <div>
          <CardDescription class="uppercase tracking-[0.14em]">Current drive</CardDescription>
          <CardTitle class="mt-1 text-base font-semibold uppercase">{{ stage.driveAttempt.status }}</CardTitle>
        </div>
        <Badge variant="outline" class="h-8 px-3 font-mono font-semibold text-primary">
          {{ formatClock(stage.driveAttempt.elapsedSeconds) }}
        </Badge>
      </CardHeader>
      <CardContent class="grid grid-cols-2 gap-2 text-xs font-medium text-muted-foreground">
        <span>Lap {{ stage.driveAttempt.currentLapIndex || 0 }} / {{ stage.driveAttempt.targetLapCount }}</span>
        <span class="text-right">{{ formatMeters(stage.driveAttempt.unwrappedDistanceMeters) }}</span>
      </CardContent>
    </Card>

    <div class="grid gap-2">
      <Card
        v-for="run in runs"
        :key="run.id"
        size="sm"
        class="border-border bg-card shadow-none"
        data-testid="drive-run-card"
      >
        <CardContent class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <span class="grid size-10 place-items-center rounded-md border bg-muted/30 text-primary">
            <Trophy v-if="run.status === 'finished'" :size="18" />
            <Gauge v-else :size="18" />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold">{{ run.stageName }}</p>
            <p class="truncate text-xs font-medium text-muted-foreground">
              {{ run.vehicleTitle }} &middot; {{ formatDate(run.finishedAt) }}
            </p>
            <p class="mt-1 font-mono text-xs font-semibold text-muted-foreground">
              {{ formatClock(run.elapsedSeconds) }} &middot; {{ formatMeters(run.distanceMeters) }}
              <span v-if="run.routeMode === 'closed-circuit'"> &middot; {{ run.completedLapCount }}/{{ run.targetLapCount }} laps</span>
            </p>
          </div>
          <div class="grid gap-2">
            <Button
              size="sm"
              :variant="stage.selectedGhostRunId === run.id ? 'secondary' : 'outline'"
              type="button"
              @click="stage.selectGhostRun(stage.selectedGhostRunId === run.id ? '' : run.id)"
            >
              Ghost
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete run"
              type="button"
              @click="stage.deleteDriveRun(run.id)"
            >
              <Trash2 :size="13" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Empty
        v-if="runs.length === 0"
        class="min-h-64 border bg-muted/10"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History :size="18" />
          </EmptyMedia>
          <EmptyTitle>No drive history yet</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            Recorded phone drives will appear here after you arm Drive and cross the start marker.
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    </div>
  </section>
</template>
