import { Link, useLoaderData } from 'react-router-dom'

import {
  getExamPath,
  getTrackPath,
} from '../shared/api/listening.api'
import type { Exam } from '../shared/api/listening.schemas'
import type { ListeningRouteData } from './listening-loader'
import '../styles/listening-shell.css'

const EXAM_LABELS: Record<Exam, string> = {
  cet4: 'CET-4',
  cet6: 'CET-6',
}

const EXAM_ORDER: Exam[] = ['cet6', 'cet4']

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return '--:--'
  }

  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ListeningRoute() {
  const data = useLoaderData() as ListeningRouteData
  const timings = data.trackBundle?.timings ?? null
  const lines = timings?.lines ?? []
  const sections = timings?.sections ?? []
  const duration = timings ? formatTime(timings.duration) : '--:--'

  return (
    <div className="listening-shell">
      <aside className="sidebar-panel catalog-panel" aria-label="Listening library">
        <div className="side-header">
          <div>
            <p className="eyebrow">Step 4</p>
            <h1 className="side-title">Listening Library</h1>
          </div>
          <span className="side-count">{data.examCatalog.length}</span>
        </div>

        <nav className="exam-tabs" aria-label="Exam tabs">
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

        <nav className="track-list" aria-label="Track list">
          {data.examCatalog.length ? (
            data.examCatalog.map((track) => (
              <Link
                key={track.id}
                className={[
                  'track-link',
                  data.currentTrack?.id === track.id ? 'active' : '',
                  track.available ? '' : 'unavailable',
                ]
                  .filter(Boolean)
                  .join(' ')}
                to={getTrackPath(track.exam, track.id)}
              >
                <span className="track-link-title">{track.title}</span>
                <span className="track-link-meta">
                  {track.available ? 'Ready' : 'Unavailable'}
                </span>
              </Link>
            ))
          ) : (
            <div className="empty-state compact">No listening material for this exam yet.</div>
          )}
        </nav>
      </aside>

      <main className="main-panel">
        <section className="player-shell" aria-label="Player shell">
          <div className="player-shell-head">
            <div>
              <p className="eyebrow">Route Shell</p>
              <h2 className="player-title">
                {data.currentTrack?.title ?? EXAM_LABELS[data.exam]}
              </h2>
              <p className="player-meta">
                {timings
                  ? `${lines.length} lines · ${sections.length} sections · ${duration}`
                  : 'Playback behavior is migrated in the next step.'}
              </p>
            </div>
            <span className="player-status">
              {data.currentTrack?.available ? 'Display parity' : 'Layout only'}
            </span>
          </div>

          <div className="progress-shell" aria-hidden="true">
            <span>00:00</span>
            <input type="range" min="0" max="1000" value="0" disabled readOnly />
            <span>{duration}</span>
          </div>

          <div className="control-row" aria-hidden="true">
            <button className="control-btn" type="button" disabled>
              -5s
            </button>
            <button className="control-btn primary" type="button" disabled>
              Play
            </button>
            <button className="control-btn" type="button" disabled>
              +5s
            </button>
            <span className="control-pill">1x</span>
            <span className="control-pill">Transcript</span>
            <span className="control-pill">Translation</span>
          </div>
        </section>

        <section className="transcript-panel" aria-label="Transcript">
          {!data.currentTrack ? (
            <div className="empty-state">
              No content is available for {EXAM_LABELS[data.exam]} yet.
            </div>
          ) : !data.currentTrack.available || !timings ? (
            <div className="empty-state">
              {data.currentTrack.title} exists in the catalog, but its structured
              transcript assets are not ready in the current dataset.
            </div>
          ) : (
            <div className="transcript-list">
              {sections.map((section) => (
                <section key={section.id} className="transcript-section">
                  <div className="section-heading">{section.title}</div>
                  <div className="section-lines">
                    {lines
                      .filter((line) => line.sectionId === section.id)
                      .map((line) => (
                        <article key={line.id} id={line.id} className="transcript-line">
                          <span className="transcript-time">{formatTime(line.start)}</span>
                          <div className="transcript-copy">
                            {line.speaker ? (
                              <span className="speaker-token">{line.speaker}</span>
                            ) : null}
                            <span>{line.text}</span>
                          </div>
                          <span className="transcript-type">{line.type}</span>
                        </article>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </main>

      <aside className="sidebar-panel details-panel" aria-label="Current track details">
        <div className="details-card">
          <span className="detail-label">Current exam</span>
          <strong className="detail-value">{EXAM_LABELS[data.exam]}</strong>
          <span className="detail-copy">
            {data.currentTrack?.title ?? 'No routeable track yet'}
          </span>
        </div>

        <div className="details-card">
          <span className="detail-label">Dataset status</span>
          <strong className="detail-value">
            {data.currentTrack?.available ? 'Structured' : 'Pending'}
          </strong>
          <span className="detail-copy">
            {timings
              ? `${lines.length} lines validated from timings JSON`
              : 'Route and layout are ready before playback behavior migration.'}
          </span>
        </div>

        <nav className="section-nav" aria-label="Section navigation">
          {sections.length ? (
            sections.map((section) => (
              <a
                key={section.id}
                className="section-link"
                href={section.firstLineId ? `#${section.firstLineId}` : undefined}
              >
                <span>{section.title}</span>
                <span>{section.firstLineId ?? '--'}</span>
              </a>
            ))
          ) : (
            <div className="empty-state compact">Section navigation appears here when data is ready.</div>
          )}
        </nav>
      </aside>
    </div>
  )
}
