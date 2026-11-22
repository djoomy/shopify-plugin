import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

const DELAI_ABANDON = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);

  const agent = request.headers.get("user-agent");
  const evenementPret =
    agent && isbot(agent) ? "onAllReady" : "onShellReady";

  return new Promise((resoudre, rejeter) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer context={remixContext} url={request.url} />,
      {
        [evenementPret]: () => {
          const corps = new PassThrough();
          responseHeaders.set("Content-Type", "text/html");
          resoudre(
            new Response(createReadableStreamFromReadable(corps), {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(corps);
        },
        onShellError: rejeter,
        onError: () => {
          responseStatusCode = 500;
        },
      },
    );

    setTimeout(abort, DELAI_ABANDON);
  });
}
