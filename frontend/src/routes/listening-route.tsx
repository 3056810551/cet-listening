import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Link, useLoaderData } from 'react-router-dom'

import { useListeningPlayer } from '../features/player/use-listening-player'
import { getExamPath, getTrackPath } from '../shared/api/listening.api'
import { normalizeAssetPath } from '../shared/api/http'
import type {
  Exam,
  Section,
  TranscriptLine,
} from '../shared/api/listening.schemas'
import type { ListeningRouteData } from './listening-loader'
import '../styles/listening-shell.css'

const EXAM_LABELS: Record<Exam, string> = {
  cet4: 'CET-4',
  cet6: 'CET-6',
}

const EXAM_ORDER: Exam[] = ['cet6', 'cet4']
const TRACK_SORT_KEY = 'cet6-track-sort-direction'
const PLAYER_PINNED_KEY = 'cet6-player-pinned'
const PLAYER_POSITION_KEY = 'cet6-player-position'
const LEFT_COLLAPSED_KEY = 'cet6-left-sidebar-collapsed'
const RIGHT_COLLAPSED_KEY = 'cet6-right-sidebar-collapsed'
const LEFT_WIDTH_KEY = 'cet6-left-sidebar-width'
const RIGHT_WIDTH_KEY = 'cet6-right-sidebar-width'
const COMPACT_BREAKPOINT = 860

type SortDirection = 'asc' | 'desc'
type SidebarSide = 'left' | 'right'
type PlayerPosition = {
  left: number
  top: number
}
type PlayerBounds = {
  width: number
  height: number
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return '00:00'
  }

  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ListeningRoute() {
  const data = useLoaderData() as ListeningRouteData
  const routeKey = data.currentTrack?.id ?? data.exam

  return <ListeningRouteContent key={routeKey} data={data} />
}

function ListeningRouteContent({ data }: { data: ListeningRouteData }) {
  const timings = data.trackBundle?.timings ?? null
  const lines = timings?.lines ?? []
  const sections = timings?.sections ?? []
  const playerRef = useRef<HTMLElement>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(() =>
    readStoredSortDirection(),
  )
  const [leftCollapsed, setLeftCollapsed] = useState(() =>
    readStoredBoolean(LEFT_COLLAPSED_KEY),
  )
  const [rightCollapsed, setRightCollapsed] = useState(() =>
    readStoredBoolean(RIGHT_COLLAPSED_KEY),
  )
  const [playerPinned, setPlayerPinned] = useState(() =>
    readStoredBoolean(PLAYER_PINNED_KEY),
  )
  const [leftWidth, setLeftWidth] = useState(() =>
    readStoredSidebarWidth('left'),
  )
  const [rightWidth, setRightWidth] = useState(() =>
    readStoredSidebarWidth('right'),
  )
  const [activeResizer, setActiveResizer] = useState<SidebarSide | null>(null)
  const [playerDragging, setPlayerDragging] = useState(false)
  const [playerPosition, setPlayerPosition] = useState<PlayerPosition | null>(() =>
    readStoredPlayerPosition(),
  )
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    readIsCompactLayout(),
  )
  const {
    activeIndex,
    activeSectionId,
    audioRef,
    autoScroll,
    beginSeeking,
    canPlay,
    commitSeeking,
    currentTime,
    duration,
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
  } = useListeningPlayer({
    track: data.currentTrack,
    lines,
    sections,
    fallbackDuration: timings?.duration ?? 0,
  })
  const orderedCatalog = [...data.examCatalog].sort(
    (left, right) =>
      compareTrackIds(left.id, right.id) * (sortDirection === 'desc' ? -1 : 1),
  )
  const shellClassName = [
    'shell',
    leftCollapsed ? 'left-collapsed' : '',
    rightCollapsed ? 'right-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const durationLabel = formatTime(duration)
  const currentTimeLabel = formatTime(currentTime)
  const leftResizerClassName = [
    'resizer',
    'left-resizer',
    activeResizer === 'left' ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const rightResizerClassName = [
    'resizer',
    'right-resizer',
    activeResizer === 'right' ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const playerClassName = [
    'now-playing',
    playerPinned ? 'pinned' : '',
    !playerPinned && !isCompactLayout ? 'draggable' : '',
    playerDragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const playerStyle: CSSProperties | undefined = !isCompactLayout && playerPosition
    ? {
        left: `${playerPosition.left}px`,
        top: `${playerPosition.top}px`,
        right: 'auto',
        bottom: 'auto',
        transform: 'none',
      }
    : undefined
  const audioSrc = data.currentTrack?.audio
    ? normalizeAssetPath(data.currentTrack.audio)
    : null
  const trackMeta = getTrackMeta(data, lines.length)

  useEffect(() => {
    writeStoredValue(TRACK_SORT_KEY, sortDirection)
  }, [sortDirection])

  useEffect(() => {
    writeStoredValue(LEFT_COLLAPSED_KEY, String(leftCollapsed))
  }, [leftCollapsed])

  useEffect(() => {
    writeStoredValue(RIGHT_COLLAPSED_KEY, String(rightCollapsed))
  }, [rightCollapsed])

  useEffect(() => {
    writeStoredValue(PLAYER_PINNED_KEY, String(playerPinned))
  }, [playerPinned])

  useEffect(() => {
    setRootSidebarWidth('left', leftWidth)
  }, [leftWidth])

  useEffect(() => {
    setRootSidebarWidth('right', rightWidth)
  }, [rightWidth])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined
    }

    document.body.classList.toggle('resizing', activeResizer !== null)

    return () => {
      document.body.classList.remove('resizing')
    }
  }, [activeResizer])

  useEffect(() => {
    const handleResize = () => {
      const compactLayout = readIsCompactLayout()
      setIsCompactLayout(compactLayout)
      setPlayerPosition((value) => {
        if (!value || compactLayout) {
          return value
        }

        const playerElement = playerRef.current
        if (!playerElement) {
          return value
        }

        const nextPosition = clampPlayerPosition(value, {
          width: playerElement.offsetWidth,
          height: playerElement.offsetHeight,
        })

        if (isSamePlayerPosition(value, nextPosition)) {
          return value
        }

        saveStoredPlayerPosition(nextPosition)
        return nextPosition
      })
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!playerPosition || isCompactLayout) {
      return
    }

    const playerElement = playerRef.current
    if (!playerElement) {
      return
    }

    const nextPosition = clampPlayerPosition(playerPosition, {
      width: playerElement.offsetWidth,
      height: playerElement.offsetHeight,
    })

    if (isSamePlayerPosition(playerPosition, nextPosition)) {
      return
    }

    setPlayerPosition(nextPosition)
    saveStoredPlayerPosition(nextPosition)
  }, [isCompactLayout, playerPosition])

  function handlePlayerPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      isCompactLayout ||
      playerPinned ||
      event.button !== 0 ||
      (event.target instanceof Element &&
        event.target.closest('button, input, label'))
    ) {
      return
    }

    const playerElement = event.currentTarget
    const pointerId = event.pointerId
    const rect = playerElement.getBoundingClientRect()
    const bounds = {
      width: rect.width,
      height: rect.height,
    }
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = rect.left
    const startTop = rect.top
    let nextPosition = clampPlayerPosition(
      {
        left: startLeft,
        top: startTop,
      },
      bounds,
    )

    event.preventDefault()
    playerElement.setPointerCapture(pointerId)
    setPlayerDragging(true)

    const movePlayer = (moveEvent: PointerEvent) => {
      nextPosition = clampPlayerPosition(
        {
          left: startLeft + moveEvent.clientX - startX,
          top: startTop + moveEvent.clientY - startY,
        },
        bounds,
      )

      setPlayerPosition((value) =>
        isSamePlayerPosition(value, nextPosition) ? value : nextPosition,
      )
    }

    const stopDrag = () => {
      if (playerElement.hasPointerCapture(pointerId)) {
        playerElement.releasePointerCapture(pointerId)
      }

      setPlayerDragging(false)
      saveStoredPlayerPosition(nextPosition)
      playerElement.removeEventListener('pointermove', movePlayer)
      playerElement.removeEventListener('pointerup', stopDrag)
      playerElement.removeEventListener('pointercancel', stopDrag)
    }

    playerElement.addEventListener('pointermove', movePlayer)
    playerElement.addEventListener('pointerup', stopDrag)
    playerElement.addEventListener('pointercancel', stopDrag)
  }

  function handleSidebarResizeStart(
    side: SidebarSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      isCompactLayout ||
      event.button !== 0 ||
      (side === 'left' && leftCollapsed) ||
      (side === 'right' && rightCollapsed)
    ) {
      return
    }

    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = side === 'left' ? leftWidth : rightWidth
    let nextWidth = startWidth

    event.preventDefault()
    handle.setPointerCapture(pointerId)
    setActiveResizer(side)

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX
      nextWidth = clampSidebarWidth(
        side,
        side === 'left' ? startWidth + delta : startWidth - delta,
      )

      if (side === 'left') {
        setLeftWidth((value) => (value === nextWidth ? value : nextWidth))
        return
      }

      setRightWidth((value) => (value === nextWidth ? value : nextWidth))
    }

    const stopResize = () => {
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }

      setActiveResizer((value) => (value === side ? null : value))
      writeStoredValue(getSidebarWidthStorageKey(side), String(nextWidth))
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', stopResize)
      handle.removeEventListener('pointercancel', stopResize)
    }

    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', stopResize)
    handle.addEventListener('pointercancel', stopResize)
  }

  return (
    <div className={shellClassName}>
      <aside className="catalog" aria-label="听力列表">
        <div className="side-header">
          <span>听力列表</span>
          <div className="side-actions">
            <button
              id="sortTrackList"
              className="side-order-toggle"
              type="button"
              title={sortDirection === 'desc' ? '切换为顺序显示' : '切换为逆序显示'}
              aria-label={sortDirection === 'desc' ? '切换为顺序显示' : '切换为逆序显示'}
              onClick={() => {
                setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))
              }}
            >
              {sortDirection === 'desc' ? '逆序' : '顺序'}
            </button>
            <button
              id="hideLeftSidebar"
              className="side-toggle"
              type="button"
              title="隐藏左侧栏"
              aria-label="隐藏左侧栏"
              onClick={() => {
                setLeftCollapsed(true)
              }}
            >
              -
            </button>
          </div>
        </div>

        <nav className="exam-tabs" aria-label="考试类型">
          {EXAM_ORDER.map((exam) => (
            <Link
              key={exam}
              className={`exam-tab ${data.exam === exam ? 'active' : ''}`}
              to={getExamPath(exam)}
            >
              {EXAM_LABELS[exam]}
            </Link>
          ))}
        </nav>

        <nav className="track-list" aria-label="听力年份列表">
          {orderedCatalog.length ? (
            orderedCatalog.map((track) => (
              <Link
                key={track.id}
                className={[
                  'track-list-item',
                  data.currentTrack?.id === track.id ? 'active' : '',
                  track.available ? '' : 'unavailable',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={track.available ? track.title : '该听力尚未生成时间轴'}
                to={getTrackPath(track.exam, track.id)}
              >
                {track.title}
              </Link>
            ))
          ) : (
            <div className="empty-state">当前还没有这个考试的听力材料。</div>
          )}
        </nav>
      </aside>

      <div
        className={leftResizerClassName}
        role="separator"
        aria-orientation="vertical"
        aria-label="左侧栏分隔条"
        onPointerDown={(event) => {
          handleSidebarResizeStart('left', event)
        }}
      />

      <main className="player">
        <section
          ref={playerRef}
          className={playerClassName}
          aria-label="播放器"
          style={playerStyle}
          onPointerDown={handlePlayerPointerDown}
        >
          <button
            id="pinPlayer"
            className="pin-player"
            type="button"
            title={playerPinned ? '取消固定播放器' : '固定播放器'}
            aria-label={playerPinned ? '取消固定播放器' : '固定播放器'}
            aria-pressed={playerPinned}
            onClick={() => {
              setPlayerPinned((value) => !value)
            }}
          >
            <span className="pin-icon" aria-hidden="true" />
          </button>

          <div className="progress-row">
            <span id="currentTime">{currentTimeLabel}</span>
            <input
              id="progress"
              className="progress"
              type="range"
              min="0"
              max="1000"
              value={progressValue}
              disabled={!canPlay}
              aria-label="播放进度"
              onPointerDown={() => {
                beginSeeking()
              }}
              onInput={(event) => {
                updateSeeking(Number(event.currentTarget.value))
              }}
              onChange={(event) => {
                commitSeeking(Number(event.currentTarget.value))
              }}
              onPointerUp={() => {
                commitSeeking()
              }}
              onPointerCancel={() => {
                commitSeeking()
              }}
            />
            <span id="duration">{durationLabel}</span>
          </div>

          <div className="controls" aria-label="播放控制">
            <button
              id="backBtn"
              className="icon-btn seek-btn seek-back"
              type="button"
              title="后退 5 秒"
              aria-label="后退 5 秒"
              disabled={!canPlay}
              onClick={() => {
                seekBy(-5)
              }}
            >
              <span className="seek-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" focusable="false">
                  <path d="M11 7 5 12l6 5v-4h6a8 8 0 1 1-7.1 4.3" />
                  <text x="16" y="22">
                    5
                  </text>
                </svg>
              </span>
            </button>

            <button
              id="playBtn"
              className="play-btn"
              type="button"
              title="播放或暂停"
              aria-label="播放或暂停"
              disabled={!canPlay}
              onClick={() => {
                void togglePlayPause()
              }}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            <button
              id="forwardBtn"
              className="icon-btn seek-btn seek-forward"
              type="button"
              title="前进 5 秒"
              aria-label="前进 5 秒"
              disabled={!canPlay}
              onClick={() => {
                seekBy(5)
              }}
            >
              <span className="seek-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" focusable="false">
                  <path d="M21 7l6 5-6 5v-4h-6a8 8 0 1 0 7.1 4.3" />
                  <text x="16" y="22">
                    5
                  </text>
                </svg>
              </span>
            </button>

            <div className="segmented" aria-label="播放速度">
              {[1, 1.25, 1.5].map((speed) => (
                <button
                  key={speed}
                  className={`speed ${playbackRate === speed ? 'active' : ''}`}
                  type="button"
                  disabled={!canPlay}
                  onClick={() => {
                    setPlaybackRate(speed)
                  }}
                >
                  {speed}x
                </button>
              ))}
            </div>

            <label className="toggle">
              <input
                id="autoScroll"
                type="checkbox"
                checked={autoScroll}
                onChange={() => {
                  setAutoScroll((value) => !value)
                }}
              />
              <span>自动滚动</span>
            </label>

            <label className="switch-control">
              <input
                id="transcriptVisible"
                type="checkbox"
                role="switch"
                checked={showTranscript}
                aria-label="显示听力原文"
                onChange={() => {
                  setShowTranscript((value) => !value)
                }}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>显示原文</span>
            </label>

            <label className="switch-control">
              <input
                id="translationVisible"
                type="checkbox"
                role="switch"
                checked={showTranslation}
                aria-label="显示中文翻译"
                onChange={() => {
                  setShowTranslation((value) => !value)
                }}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>显示翻译</span>
            </label>
          </div>

          <audio ref={audioRef} preload="metadata" src={audioSrc ?? undefined} />
        </section>

        <section className="workspace" hidden={!showTranscript} aria-label="听力原文">
          <div className="transcript" aria-live="polite">
            {!data.currentTrack ? (
              <div className="empty-state">当前还没有这个考试的可用内容。</div>
            ) : !data.currentTrack.available || !timings ? (
              <div className="empty-state">
                {data.currentTrack.title}
                {' '}
                已经在目录中，但当前数据集还没有准备好结构化原文。
              </div>
            ) : !lines.length ? (
              <div className="empty-state">原文数据为空。</div>
            ) : (
              sections.map((section) => (
                <Fragment key={section.id}>
                  <div className="section-heading">{section.title}</div>
                  {lines
                    .filter((line) => line.sectionId === section.id)
                    .map((line) => {
                      const lineIndex = lines.indexOf(line)

                      return (
                        <div
                          key={line.id}
                          id={line.id}
                          className={[
                            'line',
                            line.type,
                            lineIndex === activeIndex ? 'active' : '',
                            activeIndex > lineIndex ? 'passed' : '',
                            loopLineId === line.id ? 'looping' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className="line-time">{formatTime(line.start)}</span>
                          <span className="line-text">
                            <span className="line-original">
                              {line.speaker ? (
                                <span className="speaker">{line.speaker}</span>
                              ) : null}
                              {line.text}
                            </span>
                            {showTranslation && line.translation ? (
                              <span className="line-translation">{line.translation}</span>
                            ) : null}
                          </span>
                          <span className="line-actions">
                            <button
                              className="line-play"
                              type="button"
                              title="播放这一句"
                              aria-label={`播放：${line.text}`}
                              disabled={!canPlay}
                              onClick={() => {
                                seekToLine(line)
                              }}
                            >
                              <span className="line-play-icon" aria-hidden="true" />
                            </button>
                            <button
                              className={`line-play line-loop ${loopLineId === line.id ? 'active' : ''}`}
                              type="button"
                              title="循环播放这一句"
                              aria-label={`循环播放：${line.text}`}
                              aria-pressed={loopLineId === line.id}
                              disabled={!canPlay}
                              onClick={() => {
                                toggleLineLoop(line)
                              }}
                            >
                              <span className="line-loop-icon" aria-hidden="true" />
                            </button>
                          </span>
                        </div>
                      )
                    })}
                </Fragment>
              ))
            )}
          </div>
        </section>
      </main>

      <div
        className={rightResizerClassName}
        role="separator"
        aria-orientation="vertical"
        aria-label="右侧栏分隔条"
        onPointerDown={(event) => {
          handleSidebarResizeStart('right', event)
        }}
      />

      <aside className="details" aria-label="当前听力">
        <div className="side-header">
          <span>当前听力</span>
          <button
            id="hideRightSidebar"
            className="side-toggle"
            type="button"
            title="隐藏右侧栏"
            aria-label="隐藏右侧栏"
            onClick={() => {
              setRightCollapsed(true)
            }}
          >
            -
          </button>
        </div>

        <div className="track-card">
          <span className="track-label">当前音频</span>
          <strong id="trackName">
            {data.currentTrack?.title ?? EXAM_LABELS[data.exam]}
          </strong>
          <span id="trackMeta">{trackMeta}</span>
        </div>

        <nav className="section-nav" aria-label="段落导航">
          {sections.length ? (
            sections.map((section) => {
              const firstLine = getFirstLineForSection(section, lines)

              return (
                <div
                  key={section.id}
                  className={[
                    'section-nav-item',
                    activeSectionId === section.id ? 'active' : '',
                    loopSectionId === section.id ? 'looping' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    className="section-jump"
                    type="button"
                    onClick={() => {
                      if (!firstLine) {
                        return
                      }

                      document
                        .getElementById(firstLine.id)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                  >
                    {section.title}
                  </button>
                  <span className="section-actions">
                    <button
                      className="line-play section-action"
                      type="button"
                      title="播放这一段"
                      aria-label={`播放：${section.title}`}
                      disabled={!canPlay || !firstLine}
                      onClick={() => {
                        if (!firstLine) {
                          return
                        }

                        seekToLine(firstLine)
                        document
                          .getElementById(firstLine.id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }}
                    >
                      <span className="line-play-icon" aria-hidden="true" />
                    </button>
                    <button
                      className={`line-play line-loop section-action ${loopSectionId === section.id ? 'active' : ''}`}
                      type="button"
                      title="循环播放这一段"
                      aria-label={`循环播放：${section.title}`}
                      aria-pressed={loopSectionId === section.id}
                      disabled={!canPlay || !firstLine}
                      onClick={() => {
                        if (!firstLine) {
                          return
                        }

                        toggleSectionLoop(section)
                        document
                          .getElementById(firstLine.id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }}
                    >
                      <span className="line-loop-icon" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )
            })
          ) : (
            <div className="empty-state">段落导航会在数据就绪后显示。</div>
          )}
        </nav>
      </aside>

      <button
        id="showLeftSidebar"
        className="restore-sidebar restore-left"
        type="button"
        title="显示左侧栏"
        aria-label="显示左侧栏"
        onClick={() => {
          setLeftCollapsed(false)
        }}
      >
        +
      </button>
      <button
        id="showRightSidebar"
        className="restore-sidebar restore-right"
        type="button"
        title="显示右侧栏"
        aria-label="显示右侧栏"
        onClick={() => {
          setRightCollapsed(false)
        }}
      >
        +
      </button>
    </div>
  )
}

function getTrackMeta(data: ListeningRouteData, lineCount: number) {
  if (!data.currentTrack) {
    return '暂无内容'
  }

  if (!data.currentTrack.available) {
    return '该资源尚未生成时间轴'
  }

  if (!data.trackBundle?.timings) {
    return '正在加载...'
  }

  return `${lineCount} 行原文 · 已加载时间轴`
}

function getFirstLineForSection(section: Section, lines: TranscriptLine[]) {
  return (
    lines.find((line) => line.id === section.firstLineId) ??
    lines.find((line) => line.sectionId === section.id) ??
    null
  )
}

function compareTrackIds(left: string, right: string) {
  const leftParts = parseTrackId(left)
  const rightParts = parseTrackId(right)

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }

  return String(left).localeCompare(String(right))
}

function parseTrackId(trackId: string) {
  const match = String(trackId).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  return match ? match.slice(1).map(Number) : [9999, 99, 99]
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

function readStoredSortDirection(): SortDirection {
  if (typeof window === 'undefined') {
    return 'asc'
  }

  try {
    return window.localStorage.getItem(TRACK_SORT_KEY) === 'desc' ? 'desc' : 'asc'
  } catch {
    return 'asc'
  }
}

function readStoredSidebarWidth(side: SidebarSide) {
  return clampSidebarWidth(
    side,
    readStoredNumber(getSidebarWidthStorageKey(side), getDefaultSidebarWidth(side)),
  )
}

function readStoredPlayerPosition(): PlayerPosition | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const value = window.localStorage.getItem(PLAYER_POSITION_KEY)
    if (!value) {
      return null
    }

    const parsed = JSON.parse(value) as Partial<PlayerPosition>
    const left = Number(parsed.left)
    const top = Number(parsed.top)

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      removeStoredValue(PLAYER_POSITION_KEY)
      return null
    }

    return {
      left: Math.round(left),
      top: Math.round(top),
    }
  } catch {
    removeStoredValue(PLAYER_POSITION_KEY)
    return null
  }
}

function readStoredNumber(key: string, fallbackValue: number) {
  if (typeof window === 'undefined') {
    return fallbackValue
  }

  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) ? value : fallbackValue
  } catch {
    return fallbackValue
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

function removeStoredValue(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage removal failures and keep the in-memory UI responsive.
  }
}

function saveStoredPlayerPosition(position: PlayerPosition) {
  writeStoredValue(PLAYER_POSITION_KEY, JSON.stringify(position))
}

function readIsCompactLayout() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.innerWidth <= COMPACT_BREAKPOINT
}

function getSidebarWidthStorageKey(side: SidebarSide) {
  return side === 'left' ? LEFT_WIDTH_KEY : RIGHT_WIDTH_KEY
}

function getDefaultSidebarWidth(side: SidebarSide) {
  return side === 'left' ? 280 : 300
}

function clampSidebarWidth(side: SidebarSide, width: number) {
  const minWidth = side === 'left' ? 180 : 220
  const maxWidth = side === 'left' ? 420 : 460

  return clamp(Math.round(width), minWidth, maxWidth)
}

function setRootSidebarWidth(side: SidebarSide, width: number) {
  if (typeof document === 'undefined') {
    return
  }

  const variableName = side === 'left' ? '--left-sidebar-width' : '--right-sidebar-width'
  document.documentElement.style.setProperty(
    variableName,
    `${clampSidebarWidth(side, width)}px`,
  )
}

function clampPlayerPosition(position: PlayerPosition, bounds: PlayerBounds) {
  if (typeof window === 'undefined') {
    return position
  }

  const maxLeft = Math.max(12, window.innerWidth - bounds.width - 12)
  const maxTop = Math.max(0, window.innerHeight - bounds.height)

  return {
    left: clamp(Math.round(position.left), 12, maxLeft),
    top: clamp(Math.round(position.top), 0, maxTop),
  }
}

function isSamePlayerPosition(
  currentPosition: PlayerPosition | null,
  nextPosition: PlayerPosition,
) {
  return currentPosition !== null &&
    currentPosition.left === nextPosition.left &&
    currentPosition.top === nextPosition.top
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
