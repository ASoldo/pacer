<script setup lang="ts">
defineProps<{
  compact?: boolean
}>()
</script>

<template>
  <span
    class="pacer-logo inline-flex min-w-0 items-center gap-[0.45rem] leading-none text-foreground select-none"
    :class="{ 'pacer-logo--compact': compact }"
    aria-label="Pacer"
  >
    <img class="pacer-logo__mark" src="/pacer-logo.png" alt="" aria-hidden="true" />
    <span class="pacer-logo__word">Pacer</span>
  </span>
</template>
