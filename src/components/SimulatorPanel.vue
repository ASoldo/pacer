<script setup lang="ts">
import { Pause, Play, RotateCcw, StepForward } from '@lucide/vue'
import { computed } from 'vue'
import { useStageStore } from '../stores/stage'
import { formatMeters } from '../utils/geo'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const stage = useStageStore()
const emit = defineEmits<{
  'toggle-running': [running: boolean]
}>()

const progress = computed({
  get: () => stage.simulation.distanceMeters,
  set: (value: number) => stage.setSimulationDistance(Number(value)),
})
const progressSlider = computed<number[]>({
  get: () => [progress.value],
  set: (value) => {
    progress.value = Number(value[0] ?? progress.value)
  },
})

const progressPercent = computed(() =>
  stage.totalDistance === 0 ? 0 : (stage.simulation.distanceMeters / stage.totalDistance) * 100,
)
const speedControl = computed({
  get: () => stage.simulation.speedMode === 'adaptive' ? stage.simulation.targetSpeedKph : stage.simulation.speedKph,
  set: (value: number) => stage.setSimulationSpeed(value),
})
const speedSlider = computed<number[]>({
  get: () => [speedControl.value],
  set: (value) => {
    speedControl.value = Number(value[0] ?? speedControl.value)
  },
})
const ghostTargetSlider = computed<number[]>({
  get: () => [stage.display.ghostTargetKph],
  set: (value) => {
    stage.display.ghostTargetKph = Number(value[0] ?? stage.display.ghostTargetKph)
  },
})
const speedModeLabel = computed(() =>
  stage.simulation.speedMode === 'adaptive'
    ? `${Math.round(stage.simulationTargetSpeedKph)} km/h target`
    : 'fixed pace',
)

function jumpToNextNote() {
  if (!stage.nextNote) return
  stage.setSimulationDistance(Math.max(0, stage.nextNote.distance + stage.speech.callOffsetMeters))
}

function setSpeedMode(value: unknown) {
  if (value === 'fixed' || value === 'adaptive') {
    stage.setSimulationSpeedMode(value)
  }
}
</script>

<template>
  <section class="grid content-start gap-3 overflow-y-auto bg-background p-3">
    <Card class="border-border bg-card shadow-none">
      <CardContent class="grid gap-3 p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Shakedown</p>
            <p class="text-lg font-bold" data-testid="simulation-speed">{{ Math.round(stage.simulation.speedKph) }} km/h</p>
            <p
              class="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-muted-foreground"
              data-testid="simulation-target-speed"
            >
              {{ speedModeLabel }}
            </p>
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Jump to next call"
              title="Jump to next call"
              type="button"
              :disabled="!stage.nextNote"
              @click="jumpToNextNote"
            >
              <StepForward :size="16" />
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Reset simulation"
              title="Reset simulation"
              type="button"
              :disabled="!stage.route"
              @click="stage.resetSimulation()"
            >
              <RotateCcw :size="16" />
            </Button>
            <Button
              size="icon-lg"
              :aria-label="stage.simulation.running ? 'Pause simulation' : 'Play simulation'"
              title="Play or pause"
              type="button"
              :disabled="!stage.route"
              @click="emit('toggle-running', !stage.simulation.running)"
            >
              <Pause v-if="stage.simulation.running" :size="17" />
              <Play v-else :size="17" />
            </Button>
          </div>
        </div>

        <div class="grid gap-2">
          <Progress :model-value="progressPercent" class="h-1.5" />
          <Slider
            v-model="progressSlider"
            data-testid="simulation-distance"
            :min="0"
            :max="stage.totalDistance"
            :step="1"
            aria-label="Simulation distance"
            :disabled="!stage.route"
          />
          <div class="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span>{{ formatMeters(stage.simulation.distanceMeters) }}</span>
            <span>{{ progressPercent.toFixed(1) }}%</span>
            <span>{{ formatMeters(stage.totalDistance) }}</span>
          </div>

          <div class="grid gap-2">
            <Label class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {{ stage.simulation.speedMode === 'adaptive' ? 'Speed target' : 'Speed' }}
            </Label>
            <Slider
              v-model="speedSlider"
              :max="170"
              :min="5"
              :step="1"
              aria-label="Simulation speed"
            />
          </div>

          <ToggleGroup
            type="single"
            :model-value="stage.simulation.speedMode"
            class="grid w-full grid-cols-2 rounded-md bg-muted p-1"
            aria-label="Simulation speed mode"
            @update:model-value="setSpeedMode"
          >
            <ToggleGroupItem
              value="fixed"
              class="w-full justify-center"
              :class="stage.simulation.speedMode === 'fixed' ? 'bg-card text-primary shadow-sm ring-1 ring-border' : 'text-muted-foreground'"
              title="Use fixed simulation speed"
            >
              Fixed
            </ToggleGroupItem>
            <ToggleGroupItem
              value="adaptive"
              class="w-full justify-center"
              :class="stage.simulation.speedMode === 'adaptive' ? 'bg-card text-primary shadow-sm ring-1 ring-border' : 'text-muted-foreground'"
              title="Adapt speed to pacenote context"
              data-testid="simulation-speed-mode-adaptive"
            >
              Adaptive
            </ToggleGroupItem>
          </ToggleGroup>

          <div class="grid gap-2">
            <Label class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Ghost target
            </Label>
            <Slider
              v-model="ghostTargetSlider"
              :max="160"
              :min="30"
              :step="1"
              aria-label="Ghost target speed"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="border-border bg-card shadow-none">
      <CardContent class="grid gap-3 p-3">
        <Label class="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground" title="Show timing overlay">
          <span>Timing</span>
          <Switch v-model:checked="stage.display.showTiming" size="sm" />
        </Label>
        <Label class="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground" title="Show telemetry overlay">
          <span>Telemetry</span>
          <Switch v-model:checked="stage.display.showTelemetry" size="sm" />
        </Label>
        <Label class="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground" title="Show pacenote strip">
          <span>Calls</span>
          <Switch v-model:checked="stage.display.showNoteStrip" size="sm" />
        </Label>
        <div class="flex items-center justify-between gap-3 border-t pt-2 font-mono text-xs font-bold text-muted-foreground">
          <span>Ghost</span>
          <span>{{ Math.round(stage.display.ghostTargetKph) }} km/h</span>
        </div>
        <Label class="flex items-center justify-between gap-3 border-t pt-2 text-xs font-semibold text-muted-foreground" title="Loop circuit simulation">
          <span>Loop circuit simulation</span>
          <Switch v-model:checked="stage.simulation.loop" size="sm" />
        </Label>
      </CardContent>
    </Card>
  </section>
</template>
