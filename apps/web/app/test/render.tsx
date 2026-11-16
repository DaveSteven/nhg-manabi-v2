import type { ReactElement, ReactNode } from "react";
import type { RouteObject } from "react-router";
import { Outlet } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createQueryClient } from "../api/queryClient";

export function makeWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

/** Render UI under a fresh QueryClient (per call; tests stay independent). */
export function renderWithQuery(ui: ReactElement,
                                queryClient = createQueryClient()) {
  const wrapper = makeWrapper(queryClient);
  return { ...render(ui, { wrapper }), queryClient };
}

/**
 * Render a route tree at a URL (route smoke / integration tests), wrapped
 * in a fresh QueryClient.
 */
export function renderRoutes(routes: RouteObject[], url = "/") {
  const queryClient = createQueryClient();
  const tree: RouteObject[] = [
    {
      element: (
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      ),
      children: routes,
    },
  ];
  const router = createMemoryRouter(tree, { initialEntries: [url] });
  return { ...render(<RouterProvider router={router} />), queryClient, router };
}
