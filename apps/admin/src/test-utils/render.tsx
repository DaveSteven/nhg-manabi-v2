import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProviders } from '@/app/providers'

/** Render inside the providers every admin screen expects (antd config + App, Query). */
export function renderApp(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProviders>{ui}</AppProviders>
    </QueryClientProvider>
  )
}

/** Open an antd <Select> by its aria-label and choose an option by its text. */
export async function pickOption(label: string, option: string) {
  const u = userEvent.setup()
  await u.click(screen.getByLabelText(label))
  const items = await screen.findAllByTitle(option)
  await u.click(items[items.length - 1])
}
