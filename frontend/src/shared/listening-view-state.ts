import type { Exam, Track } from './api/listening.schemas'

const DEFAULT_EXAM: Exam = 'cet6'
const VIEW_STATE_KEY = 'cet6-browser-state'

export const TRANSLATION_VISIBLE_KEY = 'cet6-translation-visible'

type StoredTrackViewState = {
  audioTime: number
  workspaceScrollTop: number
  sectionNavScrollTop: number
}

type ListeningBrowserState = {
  currentExam: Exam
  currentTrackIds: Record<string, string>
  examTrackListScrollTop: Record<string, number>
  tracks: Record<string, StoredTrackViewState>
}

export function readSavedTrackId(exam: Exam) {
  const state = readBrowserState()
  const savedTrackId = state.currentTrackIds[normalizeExam(exam)]

  return typeof savedTrackId === 'string' && savedTrackId.length > 0
    ? savedTrackId
    : null
}

export function writeCurrentTrack(track: Track) {
  updateBrowserState((state) => {
    state.currentExam = normalizeExam(track.exam)
    state.currentTrackIds[state.currentExam] = track.id
  })
}

export function readSavedTrackAudioTime(track: Track) {
  const state = readBrowserState()
  const trackState = state.tracks[getTrackStateKey(track)]

  return toFiniteNumber(trackState?.audioTime)
}

export function writeTrackAudioTime(track: Track, audioTime: number) {
  updateBrowserState((state) => {
    state.currentExam = normalizeExam(track.exam)
    state.currentTrackIds[state.currentExam] = track.id

    const trackKey = getTrackStateKey(track)
    const nextTrackState = state.tracks[trackKey] ?? createEmptyTrackViewState()
    nextTrackState.audioTime = roundPlaybackTime(audioTime)
    state.tracks[trackKey] = nextTrackState
  })
}

export function readTranslationVisible() {
  return readStoredBoolean(TRANSLATION_VISIBLE_KEY)
}

export function writeTranslationVisible(visible: boolean) {
  writeStoredValue(TRANSLATION_VISIBLE_KEY, String(visible))
}

function readBrowserState(): ListeningBrowserState {
  if (typeof window === 'undefined') {
    return createEmptyBrowserState()
  }

  try {
    const savedState = window.localStorage.getItem(VIEW_STATE_KEY)
    if (!savedState) {
      return createEmptyBrowserState()
    }

    return sanitizeBrowserState(JSON.parse(savedState))
  } catch {
    return createEmptyBrowserState()
  }
}

function updateBrowserState(
  mutateState: (state: ListeningBrowserState) => void,
) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const nextState = readBrowserState()
    mutateState(nextState)
    window.localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(nextState))
  } catch {
    // Ignore storage write failures and keep the in-memory UI responsive.
  }
}

function sanitizeBrowserState(value: unknown): ListeningBrowserState {
  const normalized = createEmptyBrowserState()

  if (!value || typeof value !== 'object') {
    return normalized
  }

  const browserState = value as Partial<ListeningBrowserState> & {
    currentTrackId?: unknown
    trackListScrollTop?: unknown
  }

  if (typeof browserState.currentExam === 'string') {
    normalized.currentExam = normalizeExam(browserState.currentExam)
  }

  if (typeof browserState.currentTrackId === 'string') {
    normalized.currentTrackIds[DEFAULT_EXAM] = browserState.currentTrackId
  }

  if (browserState.currentTrackIds && typeof browserState.currentTrackIds === 'object') {
    Object.entries(browserState.currentTrackIds).forEach(([exam, trackId]) => {
      if (typeof trackId === 'string' && trackId.length > 0) {
        normalized.currentTrackIds[normalizeExam(exam)] = trackId
      }
    })
  }

  if (Number.isFinite(Number(browserState.trackListScrollTop))) {
    normalized.examTrackListScrollTop[DEFAULT_EXAM] = toFiniteNumber(
      browserState.trackListScrollTop,
    )
  }

  if (
    browserState.examTrackListScrollTop &&
    typeof browserState.examTrackListScrollTop === 'object'
  ) {
    Object.entries(browserState.examTrackListScrollTop).forEach(([exam, scrollTop]) => {
      normalized.examTrackListScrollTop[normalizeExam(exam)] = toFiniteNumber(scrollTop)
    })
  }

  if (!browserState.tracks || typeof browserState.tracks !== 'object') {
    return normalized
  }

  Object.entries(browserState.tracks).forEach(([trackKey, trackState]) => {
    if (!trackState || typeof trackState !== 'object') {
      return
    }

    normalized.tracks[trackKey] = {
      audioTime: toFiniteNumber(trackState.audioTime),
      workspaceScrollTop: toFiniteNumber(trackState.workspaceScrollTop),
      sectionNavScrollTop: toFiniteNumber(trackState.sectionNavScrollTop),
    }
  })

  return normalized
}

function createEmptyBrowserState(): ListeningBrowserState {
  return {
    currentExam: DEFAULT_EXAM,
    currentTrackIds: {},
    examTrackListScrollTop: {},
    tracks: {},
  }
}

function createEmptyTrackViewState(): StoredTrackViewState {
  return {
    audioTime: 0,
    workspaceScrollTop: 0,
    sectionNavScrollTop: 0,
  }
}

function getTrackStateKey(track: Track) {
  return `${normalizeExam(track.exam)}:${track.id}`
}

function roundPlaybackTime(value: number) {
  return Math.max(0, Math.round(toFiniteNumber(value) * 10) / 10)
}

function toFiniteNumber(value: unknown, fallbackValue = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallbackValue
}

function normalizeExam(exam: string | undefined): Exam {
  return exam === 'cet4' ? 'cet4' : DEFAULT_EXAM
}

function readStoredBoolean(key: string) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage write failures and keep the in-memory UI responsive.
  }
}
