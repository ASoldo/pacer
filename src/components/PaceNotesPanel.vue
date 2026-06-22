<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus, RotateCcw, Square, Volume2 } from '@lucide/vue'
import PaceCallIcon from './PaceCallIcon.vue'
import { useStageStore } from '../stores/stage'
import type { SpeechVoiceOption } from '../types'
import { formatMeters } from '../utils/geo'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  voices: SpeechVoiceOption[]
  speaking: boolean
  queueLength: number
  supported: boolean
  unlocked: boolean
  lastError: string
  backend: 'browser' | 'piper' | 'espeak-ng'
}>()

const emit = defineEmits<{
  preview: [text: string]
  stop: []
}>()

const stage = useStageStore()
const customText = ref('')
const listEl = ref<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const expandedNoteIds = ref(new Set<string>())
const noteRowHeight = 94
const overscanRows = 8

const selectedNote = computed(() =>
  stage.paceNotes.find((note) => note.id === stage.selectedNoteId),
)
const coDriverStatusLabel = computed(() => {
  if (props.lastError) return 'Error'
  if (props.backend === 'piper') return 'Piper'
  if (props.backend === 'espeak-ng') return 'eSpeak'
  if (!props.supported) return 'Off'
  if (props.speaking) return 'Speaking'
  if (props.unlocked) return 'Ready'
  return 'Tap play'
})
const coDriverBadgeVariant = computed(() => {
  if (props.lastError || !props.supported) return 'destructive'
  if (props.speaking) return 'warning'
  if (props.unlocked || props.backend === 'piper' || props.backend === 'espeak-ng') return 'success'
  return 'muted'
})
const coDriverDotClass = computed(() => {
  if (props.lastError || !props.supported) return 'bg-destructive'
  if (props.speaking) return 'bg-amber-500'
  if (props.unlocked || props.backend === 'piper' || props.backend === 'espeak-ng') return 'bg-emerald-500'
  return 'bg-muted-foreground'
})
const visibleStart = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / noteRowHeight) - overscanRows),
)
const visibleEnd = computed(() =>
  Math.min(
    stage.paceNotes.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / noteRowHeight) + overscanRows,
  ),
)
const visibleNotes = computed(() => stage.paceNotes.slice(visibleStart.value, visibleEnd.value))
const topSpacerHeight = computed(() => visibleStart.value * noteRowHeight)
const bottomSpacerHeight = computed(() =>
  Math.max(0, (stage.paceNotes.length - visibleEnd.value) * noteRowHeight),
)
const callOffsetSlider = computed<number[]>({
  get: () => [stage.speech.callOffsetMeters],
  set: (value) => {
    stage.speech.callOffsetMeters = Number(value[0] ?? stage.speech.callOffsetMeters)
  },
})
const rateSlider = computed<number[]>({
  get: () => [stage.speech.rate],
  set: (value) => {
    stage.speech.rate = Number(value[0] ?? stage.speech.rate)
  },
})
const pitchSlider = computed<number[]>({
  get: () => [stage.speech.pitch],
  set: (value) => {
    stage.speech.pitch = Number(value[0] ?? stage.speech.pitch)
  },
})

function addCustomNote() {
  stage.addCustomNote(customText.value)
  customText.value = ''
}

function formatCallOffset(value: number) {
  if (value === 0) return '0 m'
  return value < 0 ? `${Math.abs(value)} m early` : `${value} m late`
}

function updateViewportHeight() {
  viewportHeight.value = listEl.value?.clientHeight ?? 0
}

function handleListScroll() {
  scrollTop.value = listEl.value?.scrollTop ?? 0
  updateViewportHeight()
}

function scrollNoteIntoView(noteId: string) {
  const index = stage.paceNotes.findIndex((note) => note.id === noteId)
  if (index < 0 || !listEl.value) return

  const targetTop = index * noteRowHeight
  const targetBottom = targetTop + noteRowHeight
  const currentTop = listEl.value.scrollTop
  const currentBottom = currentTop + listEl.value.clientHeight

  if (targetTop >= currentTop && targetBottom <= currentBottom) return

  listEl.value.scrollTo({
    top: Math.max(0, targetTop - listEl.value.clientHeight * 0.34),
    behavior: 'smooth',
  })
}

function handleNoteToggle(noteId: string, event: Event) {
  const target = event.currentTarget as HTMLDetailsElement
  const next = new Set(expandedNoteIds.value)

  if (target.open) {
    next.add(noteId)
    stage.setSelectedNote(noteId)
  } else {
    next.delete(noteId)
  }

  expandedNoteIds.value = next
}

watch(
  () => stage.selectedNoteId,
  async (noteId) => {
    if (!noteId) return
    await nextTick()
    scrollNoteIntoView(noteId)
  },
)

watch(
  () => stage.paceNotes.length,
  async () => {
    expandedNoteIds.value = new Set(
      [...expandedNoteIds.value].filter((noteId) => stage.paceNotes.some((note) => note.id === noteId)),
    )
    await nextTick()
    updateViewportHeight()
  },
)

onMounted(() => {
  updateViewportHeight()
  window.addEventListener('resize', updateViewportHeight)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportHeight)
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-background p-3">
    <div class="grid grid-cols-3 overflow-hidden rounded-md border bg-muted/10">
      <div class="min-w-0 border-r p-2">
        <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</p>
        <p class="text-lg font-semibold">{{ stage.paceNotes.length }}</p>
      </div>
      <div class="min-w-0 border-r p-2">
        <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Offset</p>
        <p class="whitespace-normal text-lg font-semibold leading-tight">{{ formatCallOffset(stage.speech.callOffsetMeters) }}</p>
      </div>
      <div class="min-w-0 p-2">
        <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Queue</p>
        <p class="text-lg font-semibold">{{ props.queueLength }}</p>
      </div>
    </div>

    <Card class="border-border bg-card shadow-none">
      <CardContent class="grid gap-2 p-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <p class="text-xs font-bold">Co-driver</p>
          <Badge :variant="coDriverBadgeVariant" class="gap-1">
            <span class="size-1.5 rounded-full" :class="coDriverDotClass"></span>
            {{ coDriverStatusLabel }}
          </Badge>
        </div>
        <div class="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Preview selected note"
            title="Preview selected note"
            type="button"
            :disabled="!selectedNote"
            @click="selectedNote && emit('preview', selectedNote.text)"
          >
            <Volume2 :size="14" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Stop speech"
            title="Stop speech"
            type="button"
            @click="emit('stop')"
          >
            <Square :size="13" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Reset generated notes"
            title="Reset generated notes"
            type="button"
            :disabled="!stage.route"
            @click="stage.regenerateNotes()"
          >
            <RotateCcw :size="13" />
          </Button>
        </div>
      </div>

      <div class="mt-2 grid gap-2">
        <Alert v-if="props.lastError" variant="destructive">
          <AlertDescription>{{ props.lastError }}</AlertDescription>
        </Alert>

        <div class="grid gap-1.5">
          <Label for="co-driver-voice" class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Voice
          </Label>
          <NativeSelect
            id="co-driver-voice"
            v-model="stage.speech.voiceURI"
            class="w-full"
            title="Co-driver voice"
          >
            <NativeSelectOption value="">System default</NativeSelectOption>
            <NativeSelectOption v-for="voice in props.voices" :key="voice.voiceURI" :value="voice.voiceURI">
              {{ voice.name }} · {{ voice.lang }}
            </NativeSelectOption>
          </NativeSelect>
        </div>

        <div class="grid gap-2">
          <Label class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Call timing
          </Label>
          <Slider
            v-model="callOffsetSlider"
            :max="400"
            :min="-400"
            :step="10"
            aria-label="Co-driver call timing offset"
          />
          <span class="flex items-center justify-between font-mono text-[11px] normal-case tracking-normal text-muted-foreground">
            <span>-400 m</span>
            <span>{{ formatCallOffset(stage.speech.callOffsetMeters) }}</span>
            <span>+400 m</span>
          </span>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Rate
            </Label>
            <Slider
              v-model="rateSlider"
              :max="1.6"
              :min="0.7"
              :step="0.05"
              aria-label="Speech rate"
            />
          </div>
          <div class="grid gap-2">
            <Label class="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Pitch
            </Label>
            <Slider
              v-model="pitchSlider"
              :max="1.4"
              :min="0.5"
              :step="0.05"
              aria-label="Speech pitch"
            />
          </div>
        </div>
      </div>
      </CardContent>
    </Card>

    <div class="grid grid-cols-[1fr_auto] gap-2">
      <Input
        v-model="customText"
        class="min-w-0 text-xs"
        placeholder="Custom note at car"
        title="Custom note at current car position"
        @keydown.enter="addCustomNote"
      />
      <Button
        variant="outline"
        size="icon-lg"
        aria-label="Add custom note"
        title="Add custom note"
        type="button"
        :disabled="!stage.route || customText.trim().length === 0"
        @click="addCustomNote"
      >
        <Plus :size="16" />
      </Button>
    </div>

    <div ref="listEl" class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1" @scroll="handleListScroll">
      <div :style="{ height: `${topSpacerHeight}px` }" />

      <Empty v-if="stage.paceNotes.length === 0" class="border bg-muted/10 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plus />
          </EmptyMedia>
          <EmptyTitle>No pacenotes</EmptyTitle>
          <EmptyDescription>Build a route to generate co-driver calls.</EmptyDescription>
        </EmptyHeader>
      </Empty>

      <details
        v-for="note in visibleNotes"
        :key="note.id"
        :data-note-id="note.id"
        class="pacer-note-details mb-2 rounded-md border"
        :class="
          note.id === stage.selectedNoteId
            ? 'is-selected'
            : ''
        "
        :open="expandedNoteIds.has(note.id)"
        @toggle="handleNoteToggle(note.id, $event)"
      >
        <summary class="min-h-0 cursor-pointer px-2 py-1.5" :title="note.displayCall ?? note.text" @click="stage.setSelectedNote(note.id)">
          <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <PaceCallIcon :note="note" size="sm" />
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <Badge variant="outline" class="font-mono text-[0.62rem]">{{ formatMeters(note.distance) }}</Badge>
                <Badge variant="secondary" class="text-[0.62rem] font-bold uppercase">{{ note.kind }}</Badge>
              </div>
              <p class="mt-1 truncate text-xs font-semibold">
                {{ note.displayCall ?? note.text }}
              </p>
            </div>
          </div>
        </summary>
        <div class="px-2 pb-2">
          <Textarea
            class="h-16 w-full resize-none text-xs font-semibold leading-snug"
            title="Edit pacenote call"
            :model-value="note.displayCall ?? note.text"
            @update:model-value="(value) => stage.updatePaceNote(note.id, String(value))"
          />
        </div>
      </details>

      <div :style="{ height: `${bottomSpacerHeight}px` }" />
    </div>
  </section>
</template>
