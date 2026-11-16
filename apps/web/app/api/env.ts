/**
 * Frontend environment. Empty API_BASE = same-origin "/api" through the
 * Vite dev proxy (or the production static-host proxy). Set VITE_API_BASE
 * only when the API lives on another origin.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export const SITE_URL: string =
  import.meta.env.VITE_SITE_URL ?? "https://jlptgo.example.com";
