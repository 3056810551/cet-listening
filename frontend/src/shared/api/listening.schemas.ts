import { z } from 'zod'

export const examSchema = z.enum(['cet4', 'cet6'])

export const trackSchema = z.object({
  exam: examSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  markdown: z.string().min(1),
  transcript: z.string().min(1),
  audio: z.string().min(1),
  timings: z.string().min(1),
  available: z.boolean(),
})

const sourceFileSchema = z.object({
  name: z.string().min(1),
  size: z.number().nonnegative(),
  mtimeNs: z.number().nonnegative(),
})

export const sectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  firstLineId: z.string().min(1).nullable().optional(),
})

export const transcriptLineSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  sectionTitle: z.string().min(1),
  speaker: z.string().optional(),
  text: z.string().min(1),
  type: z.string().min(1),
  words: z.number().int().nonnegative(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  matchedWords: z.number().int().nonnegative().optional(),
  translation: z.string().optional(),
})

const documentBaseSchema = z.object({
  version: z.number().int().positive(),
  markdown: z.string().min(1),
  source: z.object({
    markdown: sourceFileSchema,
    audio: sourceFileSchema.optional(),
  }),
  generatedAt: z.number().nonnegative(),
  sections: z.array(sectionSchema),
  lines: z.array(transcriptLineSchema),
})

export const catalogSchema = z.array(trackSchema)

export const transcriptDocumentSchema = documentBaseSchema

export const timingsDocumentSchema = documentBaseSchema.extend({
  audio: z.string().min(1),
  duration: z.number().nonnegative(),
  elapsedSeconds: z.number().nonnegative().optional(),
  mode: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  device: z.string().min(1).optional(),
  computeType: z.string().min(1).optional(),
  warning: z.string().nullable().optional(),
  cached: z.boolean().optional(),
  transcription: z
    .object({
      language: z.string().min(1),
      languageProbability: z.number().nonnegative(),
      duration: z.number().nonnegative(),
      segmentCount: z.number().int().nonnegative(),
      wordCount: z.number().int().nonnegative(),
    })
    .optional(),
})

export type Exam = z.infer<typeof examSchema>
export type Track = z.infer<typeof trackSchema>
export type Section = z.infer<typeof sectionSchema>
export type TranscriptLine = z.infer<typeof transcriptLineSchema>
export type Catalog = z.infer<typeof catalogSchema>
export type TranscriptDocument = z.infer<typeof transcriptDocumentSchema>
export type TimingsDocument = z.infer<typeof timingsDocumentSchema>
