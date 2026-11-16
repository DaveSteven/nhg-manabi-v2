import type { Config } from "@react-router/dev/config";

/**
 * ADR-0007: React Router Framework Mode, no runtime SSR.
 * - `/` (brand home) is statically prerendered with full initial HTML.
 * - `/study/*` learning routes are served from __spa-fallback.html.
 * - Deployment must serve real static assets first, prerendered `/` for
 *   the brand route, the SPA fallback for /study routes, real 404 for
 *   invalid public routes — never the brand HTML as a global fallback.
 */
export default {
  ssr: false,
  prerender: ["/"],
} satisfies Config;
