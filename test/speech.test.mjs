import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import worker from "../src/worker.mjs";

const ENDPOINT = "https://proxy.example/v1/audio/speech";
const PCM = Buffer.from([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);

function geminiAudioResponse (pcm = PCM) {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          inlineData: {
            mimeType: "audio/L16;codec=pcm;rate=24000",
            data: pcm.toString("base64"),
          },
        }],
      },
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function speechRequest (body, method = "POST") {
  return new Request(ENDPOINT, {
    method,
    headers: {
      Authorization: "Bearer test-gemini-key",
      "Content-Type": "application/json",
    },
    ...(method === "POST" && { body: JSON.stringify(body) }),
  });
}

async function withMockFetch (mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("audio/speech maps aliases and wraps Gemini PCM as WAV", async () => {
  let upstream;

  await withMockFetch(async (url, init) => {
    upstream = { url: String(url), init };
    return geminiAudioResponse();
  }, async () => {
    const response = await worker.fetch(speechRequest({
      model: "tts-1",
      input: "Hello from the test suite.",
      voice: "alloy",
      response_format: "wav",
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");

    const wav = Buffer.from(await response.arrayBuffer());
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), PCM.length);
    assert.deepEqual(wav.subarray(44), PCM);
  });

  assert.equal(
    upstream.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
  );
  assert.equal(upstream.init.headers["x-goog-api-key"], "test-gemini-key");

  const payload = JSON.parse(upstream.init.body);
  assert.deepEqual(payload.contents, [{ parts: [{ text: "Hello from the test suite." }] }]);
  assert.equal(
    payload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    "Puck",
  );
});

test("audio/speech returns unmodified PCM when requested", async () => {
  await withMockFetch(async () => geminiAudioResponse(), async () => {
    const response = await worker.fetch(speechRequest({
      model: "tts-1-hd",
      input: "PCM output",
      voice: "echo",
      response_format: "pcm",
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/pcm");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PCM);
  });
});

test("audio/speech accepts direct Gemini model names with models/ prefix", async () => {
  let upstreamUrl;

  await withMockFetch(async (url) => {
    upstreamUrl = String(url);
    return geminiAudioResponse();
  }, async () => {
    const response = await worker.fetch(speechRequest({
      model: "models/gemini-3.1-flash-tts-preview",
      input: "Direct model",
      voice: "nova",
      response_format: "pcm",
    }));

    assert.equal(response.status, 200);
  });

  assert.equal(
    upstreamUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
  );
});

test("audio/speech rejects missing input before calling Gemini", async () => {
  let calls = 0;

  await withMockFetch(async () => {
    calls += 1;
    return geminiAudioResponse();
  }, async () => {
    const response = await worker.fetch(speechRequest({
      model: "tts-1",
      voice: "alloy",
      response_format: "wav",
    }));

    assert.equal(response.status, 400);
    assert.equal(await response.text(), "input is required");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });

  assert.equal(calls, 0);
});

test("audio/speech rejects missing voice before calling Gemini", async () => {
  let calls = 0;

  await withMockFetch(async () => {
    calls += 1;
    return geminiAudioResponse();
  }, async () => {
    const response = await worker.fetch(speechRequest({
      model: "tts-1",
      input: "Missing voice",
      response_format: "wav",
    }));

    assert.equal(response.status, 400);
    assert.equal(await response.text(), "voice is required");
  });

  assert.equal(calls, 0);
});

test("audio/speech rejects unsupported output formats", async () => {
  await withMockFetch(async () => geminiAudioResponse(), async () => {
    const response = await worker.fetch(speechRequest({
      model: "tts-1",
      input: "Unsupported format",
      voice: "alloy",
      response_format: "mp3",
    }));

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Only "wav" and "pcm" formats are supported/);
  });
});

test("audio/speech preserves Gemini error status and CORS headers", async () => {
  await withMockFetch(async () => new Response("quota exceeded", {
    status: 429,
    statusText: "Too Many Requests",
  }), async () => {
    const response = await worker.fetch(speechRequest({
      model: "tts-1",
      input: "Upstream error",
      voice: "alloy",
      response_format: "wav",
    }));

    assert.equal(response.status, 429);
    assert.equal(await response.text(), "quota exceeded");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});

test("audio/speech rejects non-POST requests", async () => {
  const response = await worker.fetch(speechRequest({}, "GET"));

  assert.equal(response.status, 400);
  assert.equal(
    await response.text(),
    "The specified HTTP method is not allowed for the requested resource",
  );
});
