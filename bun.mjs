import worker from "./src/worker.mjs";

worker.port = +(process.env.PORT || 8080);
const environment = process.env.NODE_ENV ?? "development";
worker.development = process.env.NODE_ENV==="development";

const server = Bun.serve(worker);
console.log(`[${environment}] Listening on ${server.url.origin}`);
