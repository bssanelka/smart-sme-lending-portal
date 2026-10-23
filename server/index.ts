import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Умный кредитный кабинет: http://localhost:${info.port}`);
  console.log(`[server] API reference: http://localhost:${info.port}/api/docs`);
});
