import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { HttpError, SchemaValidationError } from '../shared/api/errors'
import '../styles/listening-shell.css'

function getErrorMessage(error: unknown) {
  if (error instanceof HttpError) {
    return `${error.status} ${error.statusText} while loading ${error.path}`
  }

  if (error instanceof SchemaValidationError) {
    return `${error.path} failed validation: ${error.issues[0] ?? 'unknown issue'}`
  }

  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText || error.data || 'Route error'}`
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown routing error'
}

export function RouterErrorPage() {
  const error = useRouteError()

  return (
    <main className="error-shell">
      <section className="error-card">
        <p className="eyebrow">Route Error</p>
        <h1 className="error-title">The new shell could not load this route</h1>
        <p className="error-copy">{getErrorMessage(error)}</p>
        <a className="error-link" href="/cet6/">
          Go to CET-6
        </a>
      </section>
    </main>
  )
}
