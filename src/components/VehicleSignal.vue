<script setup lang="ts">
import { computed } from 'vue'
import { CarFront } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useStageStore } from '../stores/stage'
import { vehicleVisualUrl } from '../services/vehicleVisuals'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  compact?: boolean
  fab?: boolean
}>()

const stage = useStageStore()
const vehicleAvatarUrl = computed(() => vehicleVisualUrl(stage.vehicle, 'avatarUrl'))
const vehicleSubtitle = computed(() => stage.vehicle.chassis || stage.vehicle.generation || 'profile pending')
const statusLabel = computed(() => {
  if (stage.driveAttempt.status === 'running') return 'recording'
  if (stage.driveAttempt.status === 'armed') return 'armed'
  if (stage.obdTelemetry.status === 'streaming') return 'obd'
  if (stage.location.running) return 'gps'
  return stage.vehicle.decodeConfidence === 'confirmed' ? 'ready' : 'garage'
})
const statusToneClass = computed(() => `is-${statusLabel.value}`)
const statusBadgeVariant = computed(() => {
  if (['recording', 'obd', 'gps', 'ready'].includes(statusLabel.value)) return 'success'
  if (statusLabel.value === 'armed') return 'warning'
  return 'muted'
})
const gpsDetail = computed(() => {
  const accuracy = Math.round(stage.location.accuracyMeters || 0)
  const suffix = accuracy > 0 ? ` · ${accuracy} m` : ''
  return `${stage.location.status}${suffix}`
})
</script>

<template>
  <DropdownMenu v-if="props.fab" :modal="false">
    <DropdownMenuTrigger as-child>
      <Button
        v-bind="$attrs"
        variant="outline"
        size="icon-lg"
        class="vehicle-signal vehicle-signal--drive"
        :aria-label="`${stage.vehicleTitle}, ${statusLabel}`"
        :title="`${stage.vehicleTitle} · ${statusLabel}`"
        type="button"
        data-testid="drive-context-car"
      >
        <span class="vehicle-signal__avatar vehicle-signal__avatar--fab">
          <img
            v-if="vehicleAvatarUrl"
            :src="vehicleAvatarUrl"
            :alt="stage.vehicleTitle"
            data-testid="selected-car-avatar"
          />
          <CarFront v-else :size="18" />
        </span>
        <span class="vehicle-signal__status-dot" :class="statusToneClass" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      side="top"
      align="start"
      class="w-72 p-2"
      data-testid="drive-context-menu"
    >
      <DropdownMenuLabel class="grid gap-2 px-2 py-2 text-foreground">
        <span class="flex min-w-0 items-center gap-2">
          <span class="vehicle-signal__avatar vehicle-signal__avatar--menu">
            <img
              v-if="vehicleAvatarUrl"
              :src="vehicleAvatarUrl"
              :alt="stage.vehicleTitle"
            />
            <CarFront v-else :size="18" />
          </span>
          <span class="grid min-w-0 gap-0.5">
            <strong class="truncate text-sm font-semibold">{{ stage.vehicleTitle }}</strong>
            <small class="truncate text-xs text-muted-foreground">{{ vehicleSubtitle }}</small>
          </span>
          <Badge :variant="statusBadgeVariant" class="ml-auto uppercase">{{ statusLabel }}</Badge>
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div class="grid gap-2 px-2 py-2 text-xs">
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">Profile</span>
          <span class="truncate font-medium">{{ stage.vehicle.decodeConfidence }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">GPS</span>
          <span class="truncate font-medium">{{ gpsDetail }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="text-muted-foreground">OBD2</span>
          <span class="truncate font-medium">{{ stage.obdTelemetry.status }}</span>
        </div>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>

  <aside
    v-else
    v-bind="$attrs"
    class="vehicle-signal"
    :class="{ 'vehicle-signal--compact': props.compact }"
    :aria-label="`${stage.vehicleTitle}, ${statusLabel}`"
    :title="`${stage.vehicleTitle} · ${statusLabel}`"
    data-testid="selected-car-card"
  >
    <span class="vehicle-signal__avatar">
      <img
        v-if="vehicleAvatarUrl"
        :src="vehicleAvatarUrl"
        :alt="stage.vehicleTitle"
        data-testid="selected-car-avatar"
      />
      <CarFront v-else :size="18" />
    </span>
    <span class="vehicle-signal__body">
      <strong data-testid="selected-car-title">{{ stage.vehicleTitle }}</strong>
      <small>{{ vehicleSubtitle }}</small>
    </span>
    <b>{{ statusLabel }}</b>
  </aside>
</template>
