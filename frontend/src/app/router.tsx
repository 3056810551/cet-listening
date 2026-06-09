import { createBrowserRouter, redirect } from 'react-router-dom'

import {
  examIndexLoader,
  trackRouteLoader,
} from '../routes/listening-loader'
import {
  ListeningRoute,
} from '../routes/listening-route'
import { RouterErrorPage } from '../routes/router-error'

export const router = createBrowserRouter([
  {
    path: '/',
    loader: () => redirect('/cet6/'),
    errorElement: <RouterErrorPage />,
  },
  {
    path: ':exam',
    loader: examIndexLoader,
    Component: ListeningRoute,
    errorElement: <RouterErrorPage />,
  },
  {
    path: ':exam/:trackId',
    loader: trackRouteLoader,
    Component: ListeningRoute,
    errorElement: <RouterErrorPage />,
  },
  {
    path: '*',
    loader: () => redirect('/cet6/'),
  },
])
