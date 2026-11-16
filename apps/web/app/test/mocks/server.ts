import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

/**
 * MSW server for Mock API integration tests. jsdom origin is pinned to
 * http://localhost/ (vite.config.ts). Handlers mirror the REAL backend
 * contracts (backend/app/api/*.py) — fixtures copied from the DTO test
 * fixtures. Mocks never prove backend behavior; they pin frontend
 * behavior against the documented contract.
 */
export const ORIGIN = "http://localhost";

export const handlers = [
  http.get(`*/api/exams`, () =>
    HttpResponse.json([], { status: 200 })),
  http.get(`*/api/practice/sessions/current`, () =>
    HttpResponse.json({ detail: "no active practice" }, { status: 404 })),
];

export const server = setupServer(...handlers);
