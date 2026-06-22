<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, CircleCheck, Volume2 } from '@lucide/vue'
import type { PaceNote } from '../types'
import { paceCode, paceColor } from '../utils/pace'
import {
  angleDegrees,
  roundaboutExitNumber,
  roundaboutGeometry,
  type IconGeometry,
} from '../utils/paceIconGeometry'

const props = withDefaults(
  defineProps<{
    note: PaceNote | null
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    label?: boolean
    distanceLabel?: string
    spoken?: boolean
    completed?: boolean
  }>(),
  {
    size: 'md',
    label: true,
    distanceLabel: '',
    spoken: false,
    completed: false,
  },
)

const pixelSize = computed(() => {
  if (props.size === 'xs') return 34
  if (props.size === 'sm') return 44
  if (props.size === 'lg') return 72
  if (props.size === 'xl') return 88
  return 58
})

const strokeWidth = computed(() => (props.size === 'xs' ? 5 : props.size === 'sm' ? 6 : 7))
const color = computed(() => paceColor(props.note))
const code = computed(() => paceCode(props.note))
const shape = computed(() => props.note?.iconShape ?? (props.note?.kind === 'corner' ? 'corner' : 'straight'))
const mirrored = computed(() => props.note?.direction === 'left' && shape.value !== 'roundabout')
const roundaboutExit = computed(() => roundaboutExitNumber(code.value))
const arrowScale = computed(() => (shape.value === 'roundabout' ? 0.72 : 1))

const cornerGeometry = computed<IconGeometry>(() => {
  const grade = Math.max(1, Math.min(6, props.note?.severity ?? 6))
  const shapes: Record<number, { c1: [number, number]; c2: [number, number]; end: [number, number] }> = {
    1: { c1: [25, 51], c2: [39, 50], end: [49, 49] },
    2: { c1: [24, 47], c2: [40, 41], end: [49, 38] },
    3: { c1: [22, 43], c2: [39, 32], end: [48, 29] },
    4: { c1: [20, 41], c2: [33, 27], end: [42, 22] },
    5: { c1: [20, 40], c2: [29, 24], end: [35, 18] },
    6: { c1: [20, 39], c2: [24, 25], end: [29, 16] },
  }
  const { c1, c2, end } = shapes[grade]

  return {
    d: `M20 56 C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${end[0]} ${end[1]}`,
    tip: {
      x: end[0],
      y: end[1],
      angle: angleDegrees(c2[0], c2[1], end[0], end[1]),
    },
  }
})

const transform = computed(() => (mirrored.value ? 'translate(64 0) scale(-1 1)' : undefined))
const textSize = computed(() => {
  if (props.size === 'xs') return code.value.length > 3 ? 7 : 9
  if (props.size === 'sm') return code.value.length > 3 ? 8 : 10
  return code.value.length > 3 ? 10 : 12
})
const geometry = computed<IconGeometry>(() => {
  if (shape.value === 'corner') return cornerGeometry.value
  if (shape.value === 'square') {
    return { d: 'M20 56 L20 32 L51 32', tip: { x: 51, y: 32, angle: 0 } }
  }
  if (shape.value === 'hairpin') {
    return { d: 'M20 56 L20 28 C20 12 50 12 50 30 L50 47', tip: { x: 50, y: 47, angle: 90 } }
  }
  if (shape.value === 'acute') {
    return { d: 'M20 56 L20 27 C20 8 56 8 56 30 L56 51', tip: { x: 56, y: 51, angle: 90 } }
  }
  if (shape.value === 'roundabout') {
    return roundaboutGeometry(roundaboutExit.value)
  }
  if (shape.value === 'junction') {
    return { d: 'M20 56 L20 10 M20 35 L50 21', tip: { x: 50, y: 21, angle: angleDegrees(20, 35, 50, 21) } }
  }

  return { d: 'M32 56 L32 15', tip: { x: 32, y: 15, angle: -90 } }
})
const arrowTransform = computed(() =>
  `translate(${geometry.value.tip.x} ${geometry.value.tip.y}) rotate(${geometry.value.tip.angle}) scale(${arrowScale.value})`,
)
</script>

<template>
  <span
    class="pace-call-icon"
    :class="`pace-call-icon--${props.size}`"
    :style="{ '--call-color': color, '--call-stroke': strokeWidth, width: `${pixelSize}px`, height: `${pixelSize}px` }"
  >
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g :transform="transform">
        <path :d="geometry.d" />
        <path
          class="pace-call-icon__arrow-shadow"
          d="M-15.5 -16.6 L15.5 0 L-15.5 16.6 Z"
          :transform="arrowTransform"
        />
        <path class="pace-call-icon__arrow-tip" d="M-13.2 -14 L13.2 0 L-13.2 14 Z" :transform="arrowTransform" />
      </g>
    </svg>
    <span v-if="props.label" class="pace-call-icon__code" :style="{ fontSize: `${textSize}px` }">{{ code }}</span>
    <span v-if="props.distanceLabel" class="pace-call-icon__distance">{{ props.distanceLabel }}</span>
    <span v-if="props.spoken" class="pace-call-icon__activity pace-call-icon__activity--speaking" title="Speaking">
      <Volume2 :size="10" />
    </span>
    <span
      v-else-if="props.completed"
      class="pace-call-icon__activity pace-call-icon__activity--completed"
      title="Told"
    >
      <CircleCheck :size="10" />
    </span>
    <span v-if="props.note?.caution" class="pace-call-icon__caution" title="Caution">
      <CircleAlert :size="11" />
    </span>
  </span>
</template>
