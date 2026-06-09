import { fetchJson, normalizeAssetPath } from './http'
import {
  catalogSchema,
  type Catalog,
  type Exam,
  type TimingsDocument,
  timingsDocumentSchema,
  type Track,
  type TranscriptDocument,
  transcriptDocumentSchema,
} from './listening.schemas'

export type TrackBundle = {
  track: Track
  transcript: TranscriptDocument
  timings: TimingsDocument
}

export function getCatalog(signal?: AbortSignal) {
  return fetchJson('/tracks.json', catalogSchema, { signal })
}

export function getTranscriptDocument(track: Track | string, signal?: AbortSignal) {
  const path = typeof track === 'string' ? track : track.transcript
  return fetchJson(normalizeAssetPath(path), transcriptDocumentSchema, { signal })
}

export function getTimingsDocument(track: Track | string, signal?: AbortSignal) {
  const path = typeof track === 'string' ? track : track.timings
  return fetchJson(normalizeAssetPath(path), timingsDocumentSchema, { signal })
}

export async function getTrackBundle(
  track: Track,
  signal?: AbortSignal,
): Promise<TrackBundle> {
  const [transcript, timings] = await Promise.all([
    getTranscriptDocument(track, signal),
    getTimingsDocument(track, signal),
  ])

  return {
    track,
    transcript,
    timings,
  }
}

export function getFirstAvailableTrack(catalog: Catalog) {
  return catalog.find((track) => track.available) ?? catalog[0] ?? null
}

export function getCatalogForExam(catalog: Catalog, exam: Exam) {
  return sortTracksById(catalog.filter((track) => track.exam === exam))
}

export function getExamPath(exam: Exam) {
  return `/${exam}/`
}

export function getTrackPath(exam: Exam, trackId: string) {
  return `/${exam}/${encodeURIComponent(trackId)}`
}

export function sortTracksById<T extends Pick<Track, 'id'>>(tracks: readonly T[]) {
  return [...tracks].sort((left, right) => compareTrackIds(left.id, right.id))
}

function compareTrackIds(left: string, right: string) {
  const parsedLeft = parseTrackId(left)
  const parsedRight = parseTrackId(right)

  for (let index = 0; index < parsedLeft.length; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) {
      return parsedLeft[index] - parsedRight[index]
    }
  }

  return left.localeCompare(right)
}

function parseTrackId(id: string) {
  const match = id.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  return match ? match.slice(1).map(Number) : [9999, 99, 99]
}
