export class HttpError extends Error {
  readonly path: string
  readonly status: number
  readonly statusText: string

  constructor(
    path: string,
    status: number,
    statusText: string,
  ) {
    super(`Request failed for ${path}: ${status} ${statusText}`)
    this.name = 'HttpError'
    this.path = path
    this.status = status
    this.statusText = statusText
  }
}

export class SchemaValidationError extends Error {
  readonly path: string
  readonly issues: string[]

  constructor(
    path: string,
    issues: string[],
  ) {
    super(`Schema validation failed for ${path}`)
    this.name = 'SchemaValidationError'
    this.path = path
    this.issues = issues
  }
}
