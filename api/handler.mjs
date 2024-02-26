import worker from "../src/worker.mjs";

export default worker.fetch;

export const config = {
  runtime: "edge", 
  // Available languages and regions for Google AI Studio and Gemini API
  // https://ai.google.dev/available_regions#available_regions
  // https://vercel.com/docs/concepts/edge-network/regions
  regions: [
    //"arn1",
    "bom1",
    //"cdg1",
    "cle1",
    "cpt1",
    //"dub1",
    //"fra1",
    "gru1",
    //"hkg1",
    "hnd1",
    "iad1",
    "icn1",
    "kix1",
    "pdx1",
    "sfo1",
    "sin1",
    "syd1",
  ],
};
