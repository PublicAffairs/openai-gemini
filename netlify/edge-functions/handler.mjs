export const config = { path: "/edge/*" };

import worker from "../../src/worker.mjs";

export default worker.fetch;
