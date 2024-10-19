//deprecated:
//import {serve} from "https://deno.land/std/http/mod.ts"

import worker from "./src/worker.mjs";

const port = +(Deno.env.get("PORT") ?? 8080);

Deno.serve({port}, worker.fetch);
