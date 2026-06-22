import type { PaceNote } from '../types'

export function paceColor(note: PaceNote | null | undefined) {
  if (!note) return '#94a3b8'
  if (note.kind === 'start') return '#22c55e'
  if (note.kind === 'finish') return '#38bdf8'
  if (note.caution || note.iconShape === 'acute' || note.iconShape === 'hairpin' || note.severity <= 2) return '#ef4444'
  if (note.iconShape === 'square' || note.severity <= 4) return '#f59e0b'
  return '#22c55e'
}

export function paceCode(note: PaceNote | null | undefined) {
  if (!note) return '...'
  return note.callCode ?? note.symbol ?? String(note.severity)
}

export function paceDisplay(note: PaceNote | null | undefined) {
  if (!note) return 'ready'
  return note.displayCall ?? note.text
}
