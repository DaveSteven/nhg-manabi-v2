import type { LinksFunction, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./api/queryClient";
import globalCss from "./styles/global.css?url";
import tokensCss from "./styles/tokens.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tokensCss },
  { rel: "stylesheet", href: globalCss },
];

/**
 * Default meta. Everything under /study overrides or inherits from the
 * study layout; all study routes end up noindex. The brand home (`/`)
 * overrides robots with index,follow. The SPA fallback page carries this
 * root default (noindex), which is what we want for /study/*.
 */
export const meta: MetaFunction = () => [
  { title: "JLPT GO" },
  { name: "robots", content: "noindex" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <Outlet />
    </QueryClientProvider>
  );
}
