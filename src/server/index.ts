import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDecide } from "../adapters/jev.js";
import { createApp } from "./app.js";

// Like the CLI, the server is run from the project root and reads these relative to it.
const HOUSES_DIR = "houses";
const PAGE = "src/web/index.html";
const WEB_DIR = "dist/web";
const PREACT_DIR = "node_modules/preact";
const TAILWIND = "node_modules/@tailwindcss/browser/dist/index.global.js";

const port = Number(process.env.PORT ?? 3000);

const app = createApp({ connect: createDecide, housesDir: HOUSES_DIR });

// The page, its compiled modules, and the two browser libraries it loads. Nothing else is served.
const under = (prefix: string) => (path: string) => path.slice(prefix.length);
app.get("/", serveStatic({ path: PAGE }));
app.get("/app/*", serveStatic({ root: WEB_DIR, rewriteRequestPath: under("/app") }));
app.get("/vendor/preact/*", serveStatic({ root: PREACT_DIR, rewriteRequestPath: under("/vendor/preact") }));
app.get("/vendor/tailwind.js", serveStatic({ path: TAILWIND }));

// Local tool: listen on this machine only.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`home-jev interactive simulator: http://localhost:${info.port}`);
});
