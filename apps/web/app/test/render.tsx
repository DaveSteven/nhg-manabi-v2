import { authStore } from "../features/auth/authStore";
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
 * in a fresh QueryClient. Pass `queryClient` to override defaults (e.g.
 * retry:false for error-path tests that must settle immediately).
 */
export function renderRoutes(routes: RouteObject[], url = "/",
                             queryClient = createQueryClient()) {
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

/** Sign a test student in (the /study layout redirects guests to /login). */
export function signInForTest(level: "N1" | "N2" | "N3" | "N4" | "N5" | null = null) {
  authStore.setSession("test-token", {
    id: "9a1c66d0-1111-4111-8111-111111111111", email: "student@example.com",
    username: null, display_name: "小明", current_level: level, avatar: null,
  } as never);
}
