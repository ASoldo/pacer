<script setup lang="ts">
import { computed } from 'vue'
import { Moon, Sun } from '@lucide/vue'
import AppStatus from './AppStatus.vue'
import PhoneTelemetryCard from './PhoneTelemetryCard.vue'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const props = defineProps<{
  theme: string
}>()

const emit = defineEmits<{
  'set-theme': [theme: string]
}>()

const darkMode = computed({
  get: () => props.theme === 'dark',
  set: (checked: boolean) => emit('set-theme', checked ? 'dark' : 'light'),
})

function setThemeValue(value: unknown) {
  if (value === 'light' || value === 'dark') emit('set-theme', value)
}
</script>

<template>
  <section class="mx-auto grid w-full max-w-5xl content-start gap-4 overflow-visible bg-background p-4 lg:overflow-auto lg:p-6" data-testid="settings-panel">
    <Card class="border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle class="text-sm font-semibold">Appearance</CardTitle>
        <CardDescription>Theme controls for editor and service park screens.</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-3">
        <div class="flex items-center justify-between gap-4 rounded-md border bg-muted/20 p-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="grid h-9 w-9 place-items-center rounded-md border bg-background text-muted-foreground">
              <Moon v-if="darkMode" :size="17" />
              <Sun v-else :size="17" />
            </div>
            <div class="min-w-0">
              <Label class="text-sm font-medium" for="dark-mode-switch">Dark mode</Label>
              <p class="truncate text-xs text-muted-foreground">
                {{ darkMode ? 'Dark neutral cockpit UI' : 'Light neutral editor UI' }}
              </p>
            </div>
          </div>
          <Switch id="dark-mode-switch" v-model:checked="darkMode" aria-label="Toggle dark mode" />
        </div>

        <ToggleGroup
          type="single"
          :model-value="props.theme"
          variant="outline"
          class="grid w-full grid-cols-2"
          @update:model-value="setThemeValue"
        >
          <ToggleGroupItem
            value="light"
            class="h-9 w-full justify-center"
            aria-label="Use light theme"
          >
            <Sun :size="16" />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem
            value="dark"
            class="h-9 w-full justify-center"
            aria-label="Use dark theme"
          >
            <Moon :size="16" />
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
    <PhoneTelemetryCard />
    <AppStatus />
  </section>
</template>
