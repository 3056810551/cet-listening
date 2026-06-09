import type { LoaderFunctionArgs } from 'react-router-dom'
import { redirect } from 'react-router-dom'

import {
  getCatalog,
  getCatalogForExam,
  getFirstAvailableTrack,
  getTrackBundle,
  getTrackPath,
  type TrackBundle,
} from '../shared/api/listening.api'
import { examSchema, type Catalog, type Exam, type Track } from '../shared/api/listening.schemas'
import { readSavedTrackId } from '../shared/listening-view-state'

export type ListeningRouteData = {
  exam: Exam
  examCatalog: Catalog
  currentTrack: Track | null
  trackBundle: TrackBundle | null
}

export async function examIndexLoader({ params, request }: LoaderFunctionArgs) {
  return loadListeningRouteData(params.exam, undefined, request.signal)
}

export async function trackRouteLoader({ params, request }: LoaderFunctionArgs) {
  return loadListeningRouteData(params.exam, params.trackId, request.signal)
}

async function loadListeningRouteData(
  examParam: string | undefined,
  trackId: string | undefined,
  signal: AbortSignal,
): Promise<ListeningRouteData | Response> {
  const exam = parseExamParam(examParam)
  const catalog = await getCatalog(signal)
  const examCatalog = getCatalogForExam(catalog, exam)

  if (!examCatalog.length) {
    return {
      exam,
      examCatalog,
      currentTrack: null,
      trackBundle: null,
    }
  }

  if (!trackId) {
    const savedTrackId = readSavedTrackId(exam)
    const savedTrack = savedTrackId
      ? examCatalog.find((track) => track.id === savedTrackId) ?? null
      : null
    const nextTrack = savedTrack ?? getFirstAvailableTrack(examCatalog) ?? examCatalog[0]

    if (nextTrack) {
      return redirect(getTrackPath(exam, nextTrack.id))
    }
  }

  const currentTrack = trackId
    ? examCatalog.find((track) => track.id === trackId) ?? null
    : null

  if (!currentTrack) {
    const fallbackTrack = getFirstAvailableTrack(examCatalog)

    if (fallbackTrack) {
      return redirect(getTrackPath(exam, fallbackTrack.id))
    }

    return {
      exam,
      examCatalog,
      currentTrack: null,
      trackBundle: null,
    }
  }

  const trackBundle = currentTrack.available
    ? await getTrackBundle(currentTrack, signal)
    : null

  return {
    exam,
    examCatalog,
    currentTrack,
    trackBundle,
  }
}

function parseExamParam(value: string | undefined): Exam {
  const parsed = examSchema.safeParse(value)

  if (!parsed.success) {
    throw new Response('Exam not found', { status: 404 })
  }

  return parsed.data
}
