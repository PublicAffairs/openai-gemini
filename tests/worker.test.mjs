import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import worker from "../src/worker.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const request = (body) => new Request("https://proxy.example/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer test-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model: "gemini-3-flash-preview", ...body }),
});

const geminiResponse = (parts, finishReason = "STOP") => ({
  candidates: [{
    index: 0,
    content: { role: "model", parts },
    finishReason,
  }],
  modelVersion: "gemini-3-flash-preview",
  responseId: "response-id",
});

const mockGemini = (body, { status = 200, headers } = {}) => {
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers },
    );
  };
  return () => captured;
};

test("sanitizes tool schemas without deleting user property names", async () => {
  const captured = mockGemini(geminiResponse([{ text: "ok" }]));
  const response = await worker.fetch(request({
    messages: [{ role: "user", content: "hello" }],
    tool_choice: "required",
    tools: [{
      type: "function",
      function: {
        name: "demo",
        strict: true,
        parameters: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $comment: "remove me",
          type: "object",
          properties: {
            enumDescriptions: { type: "string", $comment: "remove me too" },
            mode: {
              type: "string",
              enum: ["fast"],
              enumDescriptions: ["Fast mode"],
            },
          },
        },
      },
    }],
  }));

  assert.equal(response.status, 200);
  const outbound = captured();
  const fn = outbound.tools[0].function_declarations[0];
  assert.equal(fn.strict, undefined);
  assert.equal(fn.parameters.$schema, undefined);
  assert.equal(fn.parameters.$comment, undefined);
  assert.deepEqual(fn.parameters.properties.enumDescriptions, { type: "string" });
  assert.equal(fn.parameters.properties.mode.enumDescriptions, undefined);
  assert.equal(outbound.tool_config.function_calling_config.mode, "ANY");
});

test("returns Gemini thought signatures on OpenAI tool calls", async () => {
  mockGemini(geminiResponse([{
    functionCall: { name: "write_file", args: { path: "test.md" } },
    thoughtSignature: "real-signature",
  }]));

  const response = await worker.fetch(request({
    messages: [{ role: "user", content: "create a file" }],
    tools: [{
      type: "function",
      function: {
        name: "write_file",
        parameters: { type: "object", properties: {} },
      },
    }],
  }));
  const completion = await response.json();
  const message = completion.choices[0].message;

  assert.equal(message.content, null);
  assert.equal(
    message.tool_calls[0].extra_content.google.thought_signature,
    "real-signature",
  );
  assert.equal(completion.choices[0].finish_reason, "tool_calls");
});

test("replays tool calls with fallback signatures and plain-text results", async () => {
  const captured = mockGemini(geminiResponse([{ text: "done" }]));
  const response = await worker.fetch(request({
    messages: [
      { role: "user", content: "create a file" },
      {
        role: "assistant",
        content: "I will create it.",
        tool_calls: [{
          id: "call_123",
          type: "function",
          function: {
            name: "write_file",
            arguments: "{\"path\":\"test.md\"}",
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_123",
        content: "The file was successfully created.",
      },
    ],
  }));

  assert.equal(response.status, 200);
  const outbound = captured();
  const modelParts = outbound.contents[1].parts;
  assert.equal(modelParts[0].text, "I will create it.");
  assert.equal(modelParts[1].functionCall.name, "write_file");
  assert.equal(modelParts[1].thoughtSignature, "skip_thought_signature_validator");
  assert.deepEqual(
    outbound.contents[2].parts[0].functionResponse.response,
    { result: "The file was successfully created." },
  );
});

test("prefers a real signature and signs only the first parallel fallback call", async () => {
  const captured = mockGemini(geminiResponse([{ text: "done" }]));
  await worker.fetch(request({
    messages: [
      { role: "user", content: "run tools" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "first", arguments: "{}" },
            extra_content: { google: { thought_signature: "real-signature" } },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "second", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "{}" },
      { role: "tool", tool_call_id: "call_2", content: "{}" },
    ],
  }));

  const functionCalls = captured().contents[1].parts;
  assert.equal(functionCalls[0].thoughtSignature, "real-signature");
  assert.equal(functionCalls[1].thoughtSignature, undefined);
});

test("preserves separate text and function-call signature placement", async () => {
  const captured = mockGemini(geminiResponse([{ text: "done" }]));
  await worker.fetch(request({
    messages: [
      { role: "user", content: "run a tool" },
      {
        role: "assistant",
        content: "Calling the tool.",
        extra_content: { google: { thought_signature: "text-signature" } },
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "demo", arguments: "{}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "{}" },
    ],
  }));

  const parts = captured().contents[1].parts;
  assert.equal(parts[0].thoughtSignature, "text-signature");
  assert.equal(parts[1].thoughtSignature, "skip_thought_signature_validator");
});

test("streams indexed parallel tool calls and always terminates with DONE", async () => {
  const chunk = geminiResponse([
    {
      functionCall: { name: "first", args: { value: 1 } },
      thoughtSignature: "signature",
    },
    {
      functionCall: { name: "second", args: { value: 2 } },
    },
  ]);
  mockGemini(`data: ${JSON.stringify(chunk)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });

  const response = await worker.fetch(request({
    stream: true,
    messages: [{ role: "user", content: "run tools" }],
  }));
  const lines = (await response.text()).split("\n")
    .filter(line => line.startsWith("data: "));
  const events = lines.slice(0, -1).map(line => JSON.parse(line.slice(6)));
  const toolDelta = events.find(event => event.choices?.[0]?.delta?.tool_calls);

  assert.ok(toolDelta);
  assert.equal("content" in toolDelta.choices[0].delta, false);
  assert.deepEqual(
    toolDelta.choices[0].delta.tool_calls.map(call => call.index),
    [0, 1],
  );
  assert.equal(lines.at(-1), "data: [DONE]");
  assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
});

test("keeps tool call indexes stable across separate stream chunks", async () => {
  const first = geminiResponse([{
    functionCall: { name: "first", args: {} },
    thoughtSignature: "signature",
  }], undefined);
  delete first.candidates[0].finishReason;
  const second = geminiResponse([{
    functionCall: { name: "second", args: {} },
  }]);
  mockGemini(
    `data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(second)}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );

  const response = await worker.fetch(request({
    stream: true,
    messages: [{ role: "user", content: "run tools" }],
  }));
  const indexes = (await response.text()).split("\n")
    .filter(line => line.startsWith("data: {"))
    .map(line => JSON.parse(line.slice(6)))
    .flatMap(event => event.choices?.[0]?.delta?.tool_calls ?? [])
    .map(call => call.index);

  assert.deepEqual(indexes, [0, 1]);
});

test("merges system and developer instructions with valid padding", async () => {
  const captured = mockGemini(geminiResponse([{ text: "ok" }]));
  await worker.fetch(request({
    messages: [
      { role: "system", content: "System rule." },
      { role: "developer", content: "Developer rule." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "demo", arguments: "{}" },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "{}" },
    ],
  }));

  const outbound = captured();
  assert.deepEqual(
    outbound.system_instruction.parts.map(part => part.text),
    ["System rule.", "Developer rule."],
  );
  assert.ok(Array.isArray(outbound.contents[0].parts));
  assert.equal(outbound.contents[0].parts[0].text, " ");
});

test("returns OpenAI-shaped JSON for local and upstream errors", async () => {
  globalThis.fetch = async () => {
    throw new Error("fetch should not be reached");
  };
  const localResponse = await worker.fetch(request({
    messages: [{
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "demo", arguments: "not-json" },
      }],
    }],
  }));
  const localError = await localResponse.json();
  assert.equal(localResponse.status, 400);
  assert.equal(localError.error.type, "invalid_request_error");

  mockGemini({
    error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" },
  }, { status: 429 });
  const upstreamResponse = await worker.fetch(request({
    messages: [{ role: "user", content: "hello" }],
  }));
  const upstreamError = await upstreamResponse.json();
  assert.equal(upstreamResponse.status, 429);
  assert.equal(upstreamError.error.message, "Quota exceeded");
  assert.equal(upstreamError.error.code, 429);
  assert.equal(upstreamError.error.type, "rate_limit_error");
});

test("surfaces malformed Gemini tool calls in JSON and streaming responses", async () => {
  const malformed = geminiResponse([], "MALFORMED_FUNCTION_CALL");
  mockGemini(malformed);
  const jsonResponse = await worker.fetch(request({
    messages: [{ role: "user", content: "run a tool" }],
  }));
  const jsonError = await jsonResponse.json();
  assert.equal(jsonResponse.status, 502);
  assert.match(jsonError.error.message, /MALFORMED_FUNCTION_CALL/);

  mockGemini(`data: ${JSON.stringify(malformed)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
  const streamResponse = await worker.fetch(request({
    stream: true,
    messages: [{ role: "user", content: "run a tool" }],
  }));
  const streamBody = await streamResponse.text();
  assert.match(streamBody, /"error":/);
  assert.match(streamBody, /MALFORMED_FUNCTION_CALL/);
  assert.match(streamBody, /data: \[DONE\]/);
});
