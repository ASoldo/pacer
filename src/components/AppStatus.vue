<script setup lang="ts">
import { BadgeInfo, Download, RefreshCw } from '@lucide/vue'
import { useAppUpdate } from '../composables/useAppUpdate'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const {
  version,
  buildDateLabel,
  shortCommit,
  needRefresh,
  checking,
  registrationReady,
  updateError,
  lastCheckedLabel,
  checkForUpdate,
  applyUpdate,
} = useAppUpdate()
</script>

<template>
  <Card class="border-border bg-card shadow-none" data-testid="app-status">
    <CardHeader class="grid grid-cols-[minmax(0,1fr)_auto] items-start border-b">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">App</p>
        <CardTitle class="mt-1 truncate text-sm font-semibold" data-testid="app-version">v{{ version }}</CardTitle>
      </div>
      <Badge
        :variant="needRefresh ? 'warning' : registrationReady ? 'success' : 'muted'"
        class="h-7 shrink-0 text-[0.66rem] font-semibold"
      >
        {{ needRefresh ? 'UPDATE' : registrationReady ? 'PWA' : 'LOCAL' }}
      </Badge>
    </CardHeader>

    <CardContent>
      <dl class="grid grid-cols-2 gap-2 text-xs">
        <div class="min-w-0 rounded-md border bg-muted/20 p-2">
          <dt class="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Build</dt>
          <dd class="mt-1 truncate font-semibold">{{ buildDateLabel }}</dd>
        </div>
        <div class="min-w-0 rounded-md border bg-muted/20 p-2">
          <dt class="font-semibold uppercase tracking-[0.12em] text-muted-foreground">Commit</dt>
          <dd class="mt-1 truncate font-mono font-semibold">{{ shortCommit }}</dd>
        </div>
      </dl>

      <p class="mt-2 truncate text-xs text-muted-foreground">Checked {{ lastCheckedLabel }}</p>

      <div class="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          :disabled="checking"
          @click="checkForUpdate"
        >
          <RefreshCw :size="15" :class="checking ? 'animate-spin' : ''" />
          {{ checking ? 'Checking' : 'Check' }}
        </Button>
        <Button
          :variant="needRefresh ? 'default' : 'outline'"
          size="sm"
          type="button"
          :disabled="!needRefresh"
          @click="applyUpdate"
        >
          <Download :size="15" />
          Update
        </Button>
      </div>

      <Alert v-if="updateError" variant="destructive" class="mt-2">
        <BadgeInfo :size="15" />
        <AlertDescription>{{ updateError }}</AlertDescription>
      </Alert>
    </CardContent>
  </Card>
</template>
