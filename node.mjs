import { serve } from "@hono/node-server"
import worker from "./src/worker.mjs";

worker.port = +(process.env.PORT || 8080);

serve(worker, (info) => {
  console.log('Listening on:', info);
})


