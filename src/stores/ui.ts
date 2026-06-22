import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

export const editorPanels = ['home', 'garage', 'stage', 'history', 'settings'] as const
export type EditorPanel = (typeof editorPanels)[number]

export const stageSubPanels = ['route', 'map', 'notes', 'shakedown'] as const
export type StageSubPanel = (typeof stageSubPanels)[number]

const uiStorageKey = 'rally-pacenotes.ui.v1'

function isEditorPanel(value: unknown): value is EditorPanel {
  return typeof value === 'string' && editorPanels.includes(value as EditorPanel)
}

function isStageSubPanel(value: unknown): value is StageSubPanel {
  return typeof value === 'string' && stageSubPanels.includes(value as StageSubPanel)
}

function loadUiState() {
  if (typeof localStorage === 'undefined') {
    return {
      editorPanel: 'home' as EditorPanel,
      stageSubPanel: 'route' as StageSubPanel,
    }
  }

  try {
    const stored = JSON.parse(localStorage.getItem(uiStorageKey) ?? '{}') as Record<string, unknown>
    return {
      editorPanel: isEditorPanel(stored.editorPanel) ? stored.editorPanel : 'home',
      stageSubPanel: isStageSubPanel(stored.stageSubPanel) ? stored.stageSubPanel : 'route',
    }
  } catch {
    return {
      editorPanel: 'home' as EditorPanel,
      stageSubPanel: 'route' as StageSubPanel,
    }
  }
}

export const useUiStore = defineStore('ui', () => {
  const initial = loadUiState()
  const editorPanel = ref<EditorPanel>(initial.editorPanel)
  const stageSubPanel = ref<StageSubPanel>(initial.stageSubPanel)

  function setEditorPanel(panel: EditorPanel) {
    editorPanel.value = panel
  }

  function setStageSubPanel(panel: StageSubPanel) {
    stageSubPanel.value = panel
  }

  watch(
    [editorPanel, stageSubPanel],
    ([nextEditorPanel, nextStageSubPanel]) => {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(uiStorageKey, JSON.stringify({
        editorPanel: nextEditorPanel,
        stageSubPanel: nextStageSubPanel,
      }))
    },
    { immediate: true },
  )

  return {
    editorPanel,
    stageSubPanel,
    setEditorPanel,
    setStageSubPanel,
  }
})
