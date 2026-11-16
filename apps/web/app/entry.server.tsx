/**
 * Build-time prerender entry (ADR-0007: ssr:false — no runtime Node SSR
 * service is deployed; this file only drives static prerendering during
 * `react-router build` and is otherwise unused at runtime).
 */
import { PassThrough } from "node:stream";

import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToPipeableStream } from "react-dom/server";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = Readable.toWeb(body) as ReadableStream<Uint8Array>;

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          if (!shellRendered) {
            reject(error);
          }
        },
      },
    );

    setTimeout(abort, 10_000);
  });
}

import { Readable } from "node:stream";
