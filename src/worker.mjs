import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { Buffer } from "node:buffer";
// alt: import { base64url } from "rfc4648";

export default {
  async fetch (request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/v1/chat/completions") || request.method !== "POST") {
      return new Response("404 Not Found", { status: 404 });
    }
    const auth = request.headers.get("Authorization");
    let apiKey = auth && auth.split(" ")[1];
    if (!apiKey) {
      return new Response("Bad credentials", { status: 401 });
    }
    let json;
    try {
      json = await request.json();
      if (!Array.isArray(json.messages)) {
        throw SyntaxError(".messages array required");
      }
    } catch (err) {
      console.error(err.toString());
      return new Response(err, { status: 400 });
    }
    return handleRequest(json, apiKey);
  }
};

const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};

async function handleRequest(req, apiKey) {
  const model = new GoogleGenerativeAI(apiKey)
    .getGenerativeModel(genModelParams(req));
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  let contents;
  try {
    contents = await transformMessages(req.messages);
  } catch (err) {
    console.error(err);
    return new Response(err, { status: 400, headers });
  }  
  let options = { headers };
  let body;
  let id = generateChatcmplId(); //"chatcmpl-8pMMaqXMK68B3nyDBrapTDrhkHBQK";
  try {
    if (req.stream) {
      body = await getChatResponseStream(model, contents, id);
      headers.set("Content-Type", "text/event-stream");
    } else {
      body = await getChatResponse(model, contents, id);
      headers.set("Content-Type", "application/json");
    }
  } catch (err) {
    console.error(err);
    body = err;
    options.status = /\[(\d\d\d) /.exec(err)?.[1] ?? 500;
    //Error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/gemini-pro:streamGenerateContent?alt=sse: [400 Bad Request] User location is not supported for the API use.
  }
  return new Response(body, options);
}

const hasImageMessage = (messages) => { // OpenAI "model": "gpt-4-vision-preview"
  return messages.some(({ content }) => {
    return Array.isArray(content)
      ? content.some((it) => it.type === "image_url")
      : false;
  });
};

const categories = { ...HarmCategory};
delete categories.HARM_CATEGORY_UNSPECIFIED;
const safetySettings = Object.values(categories).map((category) => ({
  category,
  threshold: HarmBlockThreshold.BLOCK_NONE,
}));
const fieldsMap = {
  stop: "stopSequences",
  // n: "candidateCount", // { "error": { "code": 400, "message": "Only one candidate can be specified", "status": "INVALID_ARGUMENT" } }
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  //..."topK"
};
const transformConfig = (req) => {
  let cfg = {};
  // if (typeof req.stop === "string") { req.stop = [req.stop]; } // no need
  for (let key in req) {
    const matchedKey = fieldsMap[key];
    if (matchedKey) {
      cfg[matchedKey] = req[key];
    }
  }
  return cfg;
};
const genModelParams = (req) => {
  return {
    model: hasImageMessage(req.messages)
      ? "gemini-pro-vision"
      : "gemini-pro",
    safetySettings,
    generationConfig: transformConfig(req),
  };
};

const parseImg = async (url) => {
  let mimeType, data;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const response = await fetch(url);
      mimeType = response.headers.get("content-type");
      data = Buffer.from(await response.arrayBuffer()).toString("base64");
    } catch (err) {
      throw Error("Error fetching image: " + err.toString());
    }
  } else {
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match) {
      throw Error("Invalid image data: " + url);
    }
    ({ mimeType, data } = match.groups);
  }
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
};

const transformMsg = async ({ role, content }) => {
  const parts = [];
  if (!Array.isArray(content)) {
    // system, user: string
    // assistant: string or null (Required unless tool_calls is specified.)
    parts.push({ text: content });
    return [{ role, parts }];
  }
  // user:
  // An array of content parts with a defined type, each can be of type text or image_url when passing in images.
  // You can pass multiple images by adding multiple image_url content parts.
  // Image input is only supported when using the gpt-4-visual-preview model.
  for (const item of content) {
    switch (item.type) {
    case "text":
      parts.push({ text: item.text });
      break;
    case "image_url":
      parts.push(await parseImg(item.image_url.url));
      break;
    default:
      throw TypeError(`Unknown "content" item type: "${item.type}"`);
    }
  }
  return [{ role, parts }];
};

const transformMessages = async (messages) => {
  const result = [];
  let lastRole;
  for (const item of messages) {
    item.role = item.role === "assistant" ? "model" : "user";
    if (item.role === "user" && lastRole === "user") {
      result.push([{ role: "model", parts: [{ text: "" }] }]);
    }
    lastRole = item.role;
    result.push(await transformMsg(item));
  }
  //console.info(JSON.stringify(result, 2));
  return result;
};

const generateChatcmplId = () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "chatcmpl-";
  for (let i = 0; i <= 29; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

const reasonsMap = { //https://ai.google.dev/api/rest/v1/GenerateContentResponse#finishreason
  //"FINISH_REASON_UNSPECIFIED": // Default value. This value is unused.
  "STOP": "stop",
  "MAX_TOKENS": "length",
  "SAFETY": "content_filter",
  "RECITATION": "content_filter",
  "OTHER": "???"
  // :"function_call",
};

const getChatResponse = async (model, contents, id) => {
  const { response: { candidates } } = await model.generateContent({ contents });
  const data = {
    id,
    object: "chat.completion",
    created: Date.now(),
    model: model.model,
    // system_fingerprint: "fp_69829325d0",
    choices: candidates.map((cand) => ({
      index: cand.index,
      message: { role: "assistant", content: cand.content.parts[0].text },
      logprobs: null,
      finish_reason: reasonsMap[cand.finishReason] || cand.finishReason,
    })),
  };
  return JSON.stringify(data);
};

const transformResponseStream = (id, model, cand, stop, first) => {
  const data = {
    id,
    object: "chat.completion.chunk",
    created: Date.now(),
    model,
    // system_fingerprint: "fp_69829325d0",
    choices: [{
      index: cand.index,
      delta: first
        ? { role: "assistant", content: "" }
        : stop ? {} : { content: cand.content.parts[0].text },
      logprobs: null,
      finish_reason: stop
        ? reasonsMap[cand.finishReason] || cand.finishReason
        : null,
    }],
  };
  return "data: " + JSON.stringify(data) + delimiter;
};
const delimiter = "\n\n";
const getChatResponseStream = async (model, contents, id) => {
  const { stream, response } = await model.generateContentStream({ contents }); // eslint-disable-line no-unused-vars
  return new ReadableStream({ pull: async function (controller) {
    const transform = transformResponseStream.bind(null, id, model.model);
    const { value, done } = await stream.next();
    if (done) {
      if (this.last.length > 0) {
        for (const cand of this.last) {
          controller.enqueue(transform(cand, "stop"));
        }
        controller.enqueue("data: [DONE]" + delimiter);
      }
      controller.close();
      return;
    }
    for (const cand of value.candidates) { // !!untested with candidateCount>1
      if (!this.last[cand.index]) {
        controller.enqueue(transform(cand, false, "first"));
      }
      this.last[cand.index] = cand;
      if (cand.content) { // prevent empty data (e.g. when MAX_TOKENS)
        controller.enqueue(transform(cand));
      } else {
        controller.enqueue(""); // to continue streaming
      }
    }
  }, last: [], }).pipeThrough(new TextEncoderStream());
};
