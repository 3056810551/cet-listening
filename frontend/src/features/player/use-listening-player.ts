import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  Section,
  Track,
  TranscriptLine,
} from '../../shared/api/listening.schemas'

type SeekOptions = {
  preserveLoop?: boolean
}

type UseListeningPlayerArgs = {
  track: Track | null
  lines: TranscriptLine[]
  sections: Section[]
  fallbackDuration: number
}

export function useListeningPlayer({
  track,
  lines,
  sections,
  fallbackDuration,
}: UseListeningPlayerArgs) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const loopFrameRef = useRef<number | null>(null)
  const activeIndexRef = useRef(lines.length ? 0 : -1)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [showTranscript, setShowTranscript] = useState(true)
  const [showTranslation, setShowTranslation] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeIndex, setActiveIndex] = useState(lines.length ? 0 : -1)
  const [userSeeking, setUserSeeking] = useState(false)
  const [seekingTime, setSeekingTime] = useState<number | null>(null)
  const [loopLineId, setLoopLineId] = useState<string | null>(null)
  const [loopSectionId, setLoopSectionId] = useState<string | null>(null)

  const canPlay = Boolean(track?.audio)
  const activeLine = activeIndex >= 0 ? lines[activeIndex] ?? null : null
  const activeSectionId = activeLine?.sectionId ?? null
  const effectiveDuration = duration > 0 ? duration : fallbackDuration
  const visibleTime = seekingTime ?? currentTime
  const progressValue = effectiveDuration > 0
    ? clamp((visibleTime / effectiveDuration) * 1000, 0, 1000)
    : 0

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    audio.playbackRate = playbackRate
  }, [playbackRate])

  const updateActiveLine = useCallback((
    timeOverride?: number,
    options?: { suppressAutoScroll?: boolean },
  ) => {
    if (!lines.length) {
      activeIndexRef.current = -1
      setActiveIndex(-1)
      return
    }

    const audio = audioRef.current
    const sourceTime = typeof timeOverride === 'number' && Number.isFinite(timeOverride)
      ? timeOverride
      : audio?.currentTime ?? 0
    const transcriptTime = clamp(
      sourceTime,
      0,
      getDuration(audio, effectiveDuration) || sourceTime || 0,
    )
    const nextIndex = findActiveLineIndex(lines, transcriptTime)

    if (nextIndex === activeIndexRef.current) {
      return
    }

    activeIndexRef.current = nextIndex
    setActiveIndex(nextIndex)

    if (!autoScroll || options?.suppressAutoScroll) {
      return
    }

    const nextLine = lines[nextIndex]
    if (!nextLine) {
      return
    }

    requestAnimationFrame(() => {
      document
        .getElementById(nextLine.id)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [autoScroll, effectiveDuration, lines])

  const getActiveLoopBounds = useCallback(() => {
    const audio = audioRef.current
    const nextDuration = getDuration(audio, effectiveDuration)

    if (loopLineId) {
      const line = lines.find((item) => item.id === loopLineId)
      return line ? getLineLoopBounds(line, lines, nextDuration) : null
    }

    if (loopSectionId) {
      const section = sections.find((item) => item.id === loopSectionId)
      return section ? getSectionLoopBounds(section, lines, nextDuration) : null
    }

    return null
  }, [effectiveDuration, lines, loopLineId, loopSectionId, sections])

  const clearLoopState = useCallback(() => {
    setLoopLineId(null)
    setLoopSectionId(null)
    stopLoopMonitor(loopFrameRef)
  }, [])

  const enforceLoop = useCallback(() => {
    if ((!loopLineId && !loopSectionId) || userSeeking) {
      return
    }

    const audio = audioRef.current
    if (!audio) {
      return
    }

    const bounds = getActiveLoopBounds()
    if (!bounds || bounds.end <= bounds.start) {
      clearLoopState()
      return
    }

    if (audio.currentTime >= bounds.end) {
      audio.currentTime = bounds.start
      setCurrentTime(bounds.start)
      updateActiveLine(bounds.start)
    }
  }, [
    clearLoopState,
    getActiveLoopBounds,
    loopLineId,
    loopSectionId,
    updateActiveLine,
    userSeeking,
  ])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    const handleLoadedMetadata = () => {
      setDuration(getDuration(audio, fallbackDuration))
      updateActiveLine(audio.currentTime, { suppressAutoScroll: true })
    }

    const handleTimeUpdate = () => {
      if (!userSeeking) {
        setCurrentTime(audio.currentTime)
      }

      updateActiveLine(audio.currentTime)
      enforceLoop()
    }

    const handleSeeked = () => {
      setCurrentTime(audio.currentTime)
      updateActiveLine(audio.currentTime, { suppressAutoScroll: true })
    }

    const handlePlay = () => {
      setIsPlaying(true)
    }

    const handlePause = () => {
      setIsPlaying(false)
    }

    const handleEnded = () => {
      const bounds = getActiveLoopBounds()

      if (!bounds) {
        setIsPlaying(false)
        return
      }

      audio.currentTime = bounds.start
      setCurrentTime(bounds.start)
      void audio.play().catch(() => {})
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('seeked', handleSeeked)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('seeked', handleSeeked)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [enforceLoop, fallbackDuration, getActiveLoopBounds, updateActiveLine, userSeeking])

  useEffect(() => {
    if ((!loopLineId && !loopSectionId) || !isPlaying) {
      stopLoopMonitor(loopFrameRef)
      return
    }

    let cancelled = false

    const tick = () => {
      if (cancelled) {
        return
      }

      enforceLoop()
      loopFrameRef.current = requestAnimationFrame(tick)
    }

    loopFrameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      stopLoopMonitor(loopFrameRef)
    }
  }, [enforceLoop, isPlaying, loopLineId, loopSectionId, userSeeking])

  const togglePlayPause = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !canPlay) {
      return
    }

    if (audio.paused) {
      await audio.play().catch(() => {})
      return
    }

    audio.pause()
  }, [canPlay])

  function setPlaybackRate(nextRate: number) {
    setPlaybackRateState(nextRate)
  }

  const seekBy = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    clearLoopState()
    const nextTime = clamp(
      audio.currentTime + seconds,
      0,
      getDuration(audio, effectiveDuration),
    )
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    updateActiveLine(nextTime, { suppressAutoScroll: true })
  }, [clearLoopState, effectiveDuration, updateActiveLine])

  function beginSeeking() {
    clearLoopState()
    setUserSeeking(true)
  }

  function updateSeeking(nextValue: number) {
    const audio = audioRef.current
    const nextTime = progressToTime(nextValue, getDuration(audio, effectiveDuration))

    setUserSeeking(true)
    setSeekingTime(nextTime)
    setCurrentTime(nextTime)

    if (audio) {
      audio.currentTime = nextTime
    }

    updateActiveLine(nextTime, { suppressAutoScroll: true })
  }

  function commitSeeking(nextValue?: number) {
    if (Number.isFinite(nextValue)) {
      updateSeeking(nextValue ?? 0)
    }

    setUserSeeking(false)
    setSeekingTime(null)
  }

  function seekToLine(line: TranscriptLine, options?: SeekOptions) {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const preserveLoop = options?.preserveLoop ?? shouldPreserveExistingLoop(
      line,
      loopLineId,
      loopSectionId,
    )

    if (!preserveLoop) {
      clearLoopState()
    }

    const nextTime = clamp(
      line.start,
      0,
      getDuration(audio, effectiveDuration) || line.start,
    )
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
    updateActiveLine(nextTime, { suppressAutoScroll: true })
    void audio.play().catch(() => {})
  }

  function toggleLineLoop(line: TranscriptLine) {
    if (loopLineId === line.id) {
      clearLoopState()
      return
    }

    setLoopSectionId(null)
    setLoopLineId(line.id)
    seekToLine(line, { preserveLoop: true })
  }

  function toggleSectionLoop(section: Section) {
    const firstLine = getFirstLineForSection(section, lines)
    if (!firstLine) {
      return
    }

    if (loopSectionId === section.id) {
      clearLoopState()
      return
    }

    setLoopLineId(null)
    setLoopSectionId(section.id)
    seekToLine(firstLine, { preserveLoop: true })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLButtonElement
      ) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        void togglePlayPause()
      }

      if (event.key === 'ArrowLeft') {
        seekBy(-5)
      }

      if (event.key === 'ArrowRight') {
        seekBy(5)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [seekBy, togglePlayPause])

  return {
    activeIndex,
    activeSectionId,
    audioRef,
    autoScroll,
    beginSeeking,
    canPlay,
    commitSeeking,
    currentTime,
    duration: effectiveDuration,
    isPlaying,
    loopLineId,
    loopSectionId,
    playbackRate,
    progressValue,
    seekBy,
    seekToLine,
    setAutoScroll,
    setPlaybackRate,
    setShowTranscript,
    setShowTranslation,
    showTranscript,
    showTranslation,
    toggleLineLoop,
    togglePlayPause,
    toggleSectionLoop,
    updateSeeking,
  }
}

function getFirstLineForSection(section: Section, lines: TranscriptLine[]) {
  return (
    lines.find((line) => line.id === section.firstLineId) ??
    lines.find((line) => line.sectionId === section.id) ??
    null
  )
}

function getLineLoopBounds(
  line: TranscriptLine,
  lines: TranscriptLine[],
  duration: number,
) {
  const start = clamp(line.start, 0, duration || line.start)
  let end = Number(line.end)

  if (!Number.isFinite(end) || end <= start) {
    const nextLine = lines[lines.indexOf(line) + 1]
    end = Number(nextLine?.start)
  }

  if (!Number.isFinite(end) || end <= start) {
    end = start + 1
  }

  return {
    start,
    end: clamp(end, start, duration || end),
  }
}

function getSectionLoopBounds(
  section: Section,
  lines: TranscriptLine[],
  duration: number,
) {
  const sectionLines = lines.filter((line) => line.sectionId === section.id)
  if (!sectionLines.length) {
    return null
  }

  const firstLine = sectionLines[0]
  const lastLine = sectionLines[sectionLines.length - 1]

  if (!firstLine || !lastLine) {
    return null
  }

  const { start } = getLineLoopBounds(firstLine, lines, duration)
  const { end } = getLineLoopBounds(lastLine, lines, duration)

  return end > start ? { start, end } : null
}

function shouldPreserveExistingLoop(
  line: TranscriptLine,
  loopLineId: string | null,
  loopSectionId: string | null,
) {
  if (loopSectionId && line.sectionId === loopSectionId) {
    return true
  }

  return loopLineId === line.id
}

function findActiveLineIndex(lines: TranscriptLine[], time: number) {
  let low = 0
  let high = lines.length - 1
  let best = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const line = lines[mid]

    if (!line) {
      break
    }

    if (time < line.start) {
      high = mid - 1
    } else {
      best = mid
      if (time < line.end) {
        break
      }
      low = mid + 1
    }
  }

  return best
}

function getDuration(audio: HTMLAudioElement | null, fallbackDuration: number): number {
  const duration = audio?.duration

  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    return duration
  }

  return fallbackDuration
}

function progressToTime(value: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0
  }

  return (clamp(value, 0, 1000) / 1000) * duration
}

function stopLoopMonitor(loopFrameRef: { current: number | null }) {
  if (loopFrameRef.current === null) {
    return
  }

  cancelAnimationFrame(loopFrameRef.current)
  loopFrameRef.current = null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
