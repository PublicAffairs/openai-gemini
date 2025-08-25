import { Buffer } from "node:buffer";

export default {
  async fetch (request) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const errHandler = (err) => {
      console.error(err);
      return new Response(err.message, fixCors({ status: err.status ?? 500 }));
    };
    try {
      const auth = request.headers.get("Authorization");
      const apiKey = auth?.split(" ")[1];
      const assert = (success) => {
        if (!success) {
          throw new HttpError("The specified HTTP method is not allowed for the requested resource", 400);
        }
      };
      const { pathname } = new URL(request.url);
      switch (true) {
        case pathname.endsWith("/chat/completions"):
          assert(request.method === "POST");
          return handleCompletions(await request.json(), apiKey)
            .catch(errHandler);
        case pathname.endsWith("/audio/speech"):
          assert(request.method === "POST");
          return handleSpeech(await request.json(), apiKey)
              .catch(errHandler);
        case pathname.endsWith("/embeddings"):
          assert(request.method === "POST");
          return handleEmbeddings(await request.json(), apiKey)
            .catch(errHandler);
        case pathname.endsWith("/models"):
          assert(request.method === "GET");
          return handleModels(apiKey)
            .catch(errHandler);
        default:
          throw new HttpError("404 Not Found", 404);
      }
    } catch (err) {
      return errHandler(err);
    }
  }
};

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

const fixCors = ({ headers, status, statusText }) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return { headers, status, statusText };
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

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";

const API_CLIENT = "genai-js/0.21.0";
const makeHeaders = (apiKey, more) => ({
  "x-goog-api-client": API_CLIENT,
  ...(apiKey && { "x-goog-api-key": apiKey }),
  ...more
});

async function handleModels(apiKey) {
    const response = await fetch(`${BASE_URL}/${API_VERSION}/models`, {
        headers: makeHeaders(apiKey),
    });
    let { body } = response;
    if (response.ok) {
        const { models } = JSON.parse(await response.text());
        body = JSON.stringify({
            object: "list",
            data: models.map(({ name }) => ({
                id: name.replace("models/", ""),
                object: "model",
                created: 0,
                owned_by: "",
            })),
        }, null, "  ");
    }
    return new Response(body, fixCors(response));
}
const DEFAULT_EMBEDDINGS_MODEL = "gemini-embedding-001";
async function handleEmbeddings(req, apiKey) {
    let modelFull, model;
    switch (true) {
    case typeof req.model !== "string":
      throw new HttpError("model is not specified", 400);
    case req.model.startsWith("models/"):
      modelFull = req.model;
      model = modelFull.substring(7);
      break;
    case req.model.startsWith("gemini-"):
      model = req.model;
      break;
    default:
      model = DEFAULT_EMBEDDINGS_MODEL;
    }
    modelFull = modelFull ?? "models/" + model;

    // if (typeof req.model !== "string") {
    //     throw new HttpError("model is not specified", 400);
    // }
    // let model;
    // if (req.model.startsWith("models/")) {
    //     model = req.model;
    // } else {
    //     if (!req.model.includes("embedding")) {
    //         req.model = DEFAULT_EMBEDDINGS_MODEL;
    //     }
    //     model = "models/" + req.model;
    // }

    if (!Array.isArray(req.input)) {
        req.input = [req.input];
    }
    // const response = await fetch(`${BASE_URL}/${API_VERSION}/${model}:batchEmbedContents`, {
    const response = await fetch(`${BASE_URL}/${API_VERSION}/${modelFull}:batchEmbedContents`, {
        method: "POST",
        headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({
            "requests": req.input.map(text => ({
                model: modelFull,
                content: { parts: { text } },
                outputDimensionality: req.dimensions,
            }))
        })
    });
    let { body } = response;
    if (response.ok) {
        const { embeddings } = JSON.parse(await response.text());
        body = JSON.stringify({
            object: "list",
            data: embeddings.map(({ values }, index) => ({
                object: "embedding",
                index,
                embedding: values,
            })),
            model,
        }, null, "  ");
    }
    return new Response(body, fixCors(response));
}
function addWavHeader(pcmData) {
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const chunkSize = 36 + dataSize;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(chunkSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmData]);
}
async function handleTts(req, apiKey) {
    if (!req.messages || req.messages.length === 0) {
        throw new HttpError("`messages` array is required for TTS.", 400);
    }
    if (!req.audio?.voice) {
        throw new HttpError("`audio.voice` is required for TTS.", 400);
    }
    const lastMessage = req.messages[req.messages.length - 1];
    const parts = await transformMsg(lastMessage);
    const inputText = parts.map(p => p.text).join(' ');
    if (!inputText) {
        throw new HttpError("A non-empty text message is required for TTS.", 400);
    }
    const geminiTtsModel = req.model || "gemini-2.5-flash-preview-tts";
    const geminiPayload = {
        model: geminiTtsModel,
        contents: [{
            parts: [{ text: inputText }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: req.audio.voice
                    }
                }
            }
        },
    };
    const url = `${BASE_URL}/${API_VERSION}/models/${geminiTtsModel}:generateContent`;
    const response = await fetch(url, {
        method: "POST",
        headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
        body: JSON.stringify(geminiPayload),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini TTS API Error:", errorBody);
        return new Response(errorBody, fixCors(response));
    }
    const geminiResponse = await response.json();
    const audioDataBase64 = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioDataBase64) {
        console.error("Could not extract audio data from Gemini response:", JSON.stringify(geminiResponse));
        throw new HttpError("Failed to generate audio, invalid response from upstream.", 500);
    }
    const requestedFormat = req.audio.format || 'wav';
    let finalAudioDataB64 = audioDataBase64;
    let finalFormat = 'pcm_s16le_24000_mono';
    if (requestedFormat.toLowerCase() === 'wav') {
        const pcmData = Buffer.from(audioDataBase64, 'base64');
        const wavData = addWavHeader(pcmData);
        finalAudioDataB64 = wavData.toString('base64');
        finalFormat = 'wav';
    }
    const openAiResponse = {
        id: "chatcmpl-tts-" + generateId(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: req.model,
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                audio: {
                    format: finalFormat,
                    data: finalAudioDataB64,
                    transcript: inputText,
                }
            },
            finish_reason: "stop",
        }],
        usage: null,
    };
    return new Response(JSON.stringify(openAiResponse, null, 2), fixCors({ headers: response.headers }));
}
async function handleSpeech(req, apiKey) {
    if (!req.input) {
        throw new HttpError("`input` field is required.", 400);
    }
    if (!req.voice) {
        throw new HttpError("`voice` field is required.", 400);
    }
    const geminiTtsModel = req.model || "gemini-2.5-flash-preview-tts";
    const geminiPayload = {
        model: geminiTtsModel,
        contents: [{
            parts: [{ text: req.input }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: req.voice
                    }
                }
            }
        },
    };
    const url = `${BASE_URL}/${API_VERSION}/models/${geminiTtsModel}:generateContent`;
    const geminiApiResponse = await fetch(url, {
        method: "POST",
        headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
        body: JSON.stringify(geminiPayload),
    });
    if (!geminiApiResponse.ok) {
        const errorBody = await geminiApiResponse.text();
        console.error("Gemini TTS API Error:", errorBody);
        return new Response(errorBody, fixCors({ headers: geminiApiResponse.headers, status: geminiApiResponse.status, statusText: geminiApiResponse.statusText }));
    }
    const geminiResponseJson = await geminiApiResponse.json();
    const audioDataBase64 = geminiResponseJson.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioDataBase64) {
        throw new HttpError("Failed to extract audio data from Gemini response.", 500);
    }
    const pcmData = Buffer.from(audioDataBase64, 'base64');
    const responseFormat = req.response_format || 'wav';
    let audioData;
    let contentType;
    const corsHeaders = fixCors({}).headers;
    switch (responseFormat.toLowerCase()) {
        case 'wav':
            audioData = addWavHeader(pcmData);
            contentType = 'audio/wav';
            break;
        case 'pcm':
            audioData = pcmData;
            contentType = 'audio/L16; rate=24000; channels=1';
            break;
        case 'mp3':
        case 'opus':
        case 'aac':
        case 'flac':
        default:
            audioData = addWavHeader(pcmData);
            contentType = 'audio/wav';
            corsHeaders.set('X-Warning', `Unsupported format "${responseFormat}" requested, fallback to "wav".`);
            break;
    }
    corsHeaders.set('Content-Type', contentType);
    return new Response(audioData, {
        status: 200,
        headers: corsHeaders
    });
}


const DEFAULT_MODEL = "gemini-2.5-flash";
async function handleCompletions (req, apiKey) {
  const isTtsRequest = Array.isArray(req.modalities) && req.modalities.includes("audio");
  if (isTtsRequest) {
    return handleTts(req, apiKey);
  }
  let model;
  switch (true) {
    case typeof req.model !== "string":
      break;
    case req.model.startsWith("models/"):
      model = req.model.substring(7);
      break;
    case req.model.startsWith("gemini-"):
    case req.model.startsWith("gemma-"):
    case req.model.startsWith("learnlm-"):
      model = req.model;
  }
  model = model || DEFAULT_MODEL;
  
  const isImageGenerationRequest = model.includes("image-generation");
  
  let body = await transformRequest(req, model);

  if (isImageGenerationRequest) {
    body.generationConfig = body.generationConfig || {};
    body.generationConfig.responseModalities = ["TEXT", "IMAGE"];
    delete body.system_instruction;
  }
  
  const extra = req.extra_body?.google;
  if (extra) {
    if (extra.safety_settings) {
      body.safetySettings = extra.safety_settings;
    }
    if (extra.cached_content) {
      body.cachedContent = extra.cached_content;
    }
    if (extra.thinking_config) {
      body.generationConfig.thinkingConfig = extra.thinking_config;
    }
    // [MODIFICATION START] 增加对 url_context 工具的检测
    // 如果客户端请求的 extra_body.google 中包含 url_context: true
    // 则为 Gemini 请求添加 url_context 工具
    if (extra.url_context) {
        body.tools = body.tools || [];
        body.tools.push({ "url_context": {} });
    }
    // [MODIFICATION END]
  }
  switch (true) {
    case model.endsWith(":search"):
      model = model.slice(0,-7);
    case req.model?.includes("-search-preview"):
      body.tools = body.tools || [];
      body.tools.push({googleSearch: {}});
  }
  const TASK = req.stream ? "streamGenerateContent" : "generateContent";
  let url = `${BASE_URL}/${API_VERSION}/models/${model}:${TASK}`;
  if (req.stream) { url += "?alt=sse"; }
  const response = await fetch(url, {
    method: "POST",
    headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  body = response.body;
  if (response.ok) {
    let id = "chatcmpl-" + generateId();
    const shared = {};
    if (req.stream) {
      body = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TransformStream({
          transform: parseStream,
          flush: parseStreamFlush,
          buffer: "",
          shared,
        }))
        .pipeThrough(new TransformStream({
          transform: toOpenAiStream,
          flush: toOpenAiStreamFlush,
          streamIncludeUsage: req.stream_options?.include_usage,
          model, id, last: [],
          shared,
        }))
        .pipeThrough(new TextEncoderStream());
    } else {
      body = await response.text();
      try {
        body = JSON.parse(body);
        if (!body.candidates) {
          throw new Error("Invalid completion object");
        }
      } catch (err) {
        console.error("Error parsing response:", err);
        return new Response(body, fixCors(response));
      }
      body = processCompletionsResponse(body, model, id);
    }
  }
  return new Response(body, fixCors(response));
}

const adjustProps = (schemaPart) => {
  if (typeof schemaPart !== "object" || schemaPart === null) {
    return;
  }
  if (Array.isArray(schemaPart)) {
    schemaPart.forEach(adjustProps);
  } else {
    if (schemaPart.type === "object" && schemaPart.properties && schemaPart.additionalProperties === false) {
      delete schemaPart.additionalProperties;
    }
    Object.values(schemaPart).forEach(adjustProps);
  }
};
const adjustSchema = (schema) => {
  const obj = schema[schema.type];
  delete obj.strict;
  delete obj.parameters?.$schema;
  return adjustProps(schema);
};
const harmCategory = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];
const safetySettings = harmCategory.map(category => ({
  category,
  threshold: "BLOCK_NONE",
}));
const fieldsMap = {
  frequency_penalty: "frequencyPenalty",
  max_completion_tokens: "maxOutputTokens",
  max_tokens: "maxOutputTokens",
  n: "candidateCount",
  presence_penalty: "presencePenalty",
  seed: "seed",
  stop: "stopSequences",
  temperature: "temperature",
  top_k: "topK",
  top_p: "topP",
};

const transformConfig = (req, model) => {
  let cfg = {};
  for (let key in req) {
    const matchedKey = fieldsMap[key];
    if (matchedKey) {
      cfg[matchedKey] = req[key];
    }
  }
  if (req.response_format) {
    switch (req.response_format.type) {
      case "json_schema":
        adjustSchema(req.response_format);
        cfg.responseSchema = req.response_format.json_schema?.schema;
        if (cfg.responseSchema && "enum" in cfg.responseSchema) {
          cfg.responseMimeType = "text/x.enum";
          break;
        }
      case "json_object":
        cfg.responseMimeType = "application/json";
        break;
      case "text":
        cfg.responseMimeType = "text/plain";
        break;
      default:
        throw new HttpError("Unsupported response_format.type", 400);
    }
  }
  if (req.reasoning_effort) {
    let thinkingBudget;
    switch (req.reasoning_effort) {
      case "low":
        thinkingBudget = model?.includes("pro") ? 128 : 0;
        break;
      case "medium":
        thinkingBudget = -1;
        break;
      case "high":
        thinkingBudget = 24576;
        break;
    }
    if (typeof thinkingBudget !== "undefined") {
      cfg.thinkingConfig = { thinkingBudget, includeThoughts: true };
    }
  }
  return cfg;
};

const parseImg = async (url) => {
  let mimeType, data;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} (${url})`);
      }
      mimeType = response.headers.get("content-type");
      data = Buffer.from(await response.arrayBuffer()).toString("base64");
    } catch (err) {
      throw new Error("Error fetching image: " + err.toString());
    }
  } else {
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match) {
      throw new HttpError("Invalid image data: " + url, 400);
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

const transformFnResponse = ({ content, tool_call_id }, parts) => {
  if (!parts.calls) {
    throw new HttpError("No function calls found in the previous message", 400);
  }
  let response;
  try {
    response = JSON.parse(content);
  } catch (err) {
    console.error("Error parsing function response content:", err);
    throw new HttpError("Invalid function response: " + content, 400);
  }
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    response = { result: response };
  }
  if (!tool_call_id) {
    throw new HttpError("tool_call_id not specified", 400);
  }
  const { i, name } = parts.calls[tool_call_id] ?? {};
  if (!name) {
    throw new HttpError("Unknown tool_call_id: " + tool_call_id, 400);
  }
  if (parts[i]) {
    throw new HttpError("Duplicated tool_call_id: " + tool_call_id, 400);
  }
  parts[i] = {
    functionResponse: {
      id: tool_call_id.startsWith("call_") ? null : tool_call_id,
      name,
      response,
    }
  };
};
const transformFnCalls = ({ tool_calls }) => {
  const calls = {};
  const parts = tool_calls.map(({ function: { arguments: argstr, name }, id, type }, i) => {
    if (type !== "function") {
      throw new HttpError(`Unsupported tool_call type: "${type}"`, 400);
    }
    let args;
    try {
      args = JSON.parse(argstr);
    } catch (err) {
      console.error("Error parsing function arguments:", err);
      throw new HttpError("Invalid function arguments: " + argstr, 400);
    }
    calls[id] = {i, name};
    return {
      functionCall: {
        id: id.startsWith("call_") ? null : id,
        name,
        args,
      }
    };
  });
  parts.calls = calls;
  return parts;
};

const transformMsg = async ({ content }) => {
  const parts = [];
  if (!Array.isArray(content)) {
    if (content) {
        parts.push({ text: content });
    }
    return parts;
  }
  
  for (const item of content) {
    switch (item.type) {
      case "input_text":
      case "text":
        parts.push({ text: item.text });
        break;
      case "image_url":
        parts.push(await parseImg(item.image_url.url));
        break;
      case "input_file": {
        let fileDataUri = item.file_data;
        if (!fileDataUri.startsWith("data:")) {
          fileDataUri = `data:application/pdf;base64,${item.file_data}`;
        }
        const match = fileDataUri.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
        if (!match) {
          throw new HttpError(`Invalid file_data format.`, 400);
        }
        const { mimeType, data } = match.groups;
        parts.push({ inlineData: { mimeType, data } });
        break;
      }
      case "file": {
        let fileDataUri = item.file.file_data;
        if (!fileDataUri.startsWith("data:")) {
          fileDataUri = `data:application/pdf;base64,${item.file_data}`;
        }
        const match = fileDataUri.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
        if (!match) {
          throw new HttpError(`Invalid file_data format.`, 400);
        }
        const { mimeType, data } = match.groups;
        parts.push({ inlineData: { mimeType, data } });
        break;
      }
      case "input_audio":
        parts.push({
          inlineData: {
            mimeType: "audio/" + item.input_audio.format,
            data: item.input_audio.data,
          }
        });
        break;
      default:
        throw new HttpError(`Unknown "content" item type: "${item.type}"`, 400);
    }
  }
  if (content.every(item => item.type === "image_url")) {
    parts.push({ text: "" });
  }
  return parts;
};

function parseAssistantContent(content) {
  const parts = [];
  const imageMarkdownRegex = /!\[gemini-image-generation\]\(data:(image\/\w+);base64,([\w+/=-]+)\)/g;

  if (typeof content !== 'string') {
      return parts;
  }
  
  let lastIndex = 0;
  let match;

  while ((match = imageMarkdownRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
          parts.push({ text: content.substring(lastIndex, match.index) });
      }

      const mimeType = match[1];
      const data = match[2];
      parts.push({
          inlineData: {
              mimeType,
              data,
          },
      });

      lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
      parts.push({ text: content.substring(lastIndex) });
  }

  if (parts.length === 0 && content) {
      parts.push({ text: content });
  }

  return parts;
}

function parseContentArray(contentArray) {
    const geminiParts = [];
    if (!Array.isArray(contentArray)) return geminiParts;

    for (const item of contentArray) {
        if (item.type === 'text' && typeof item.text === 'string') {
            const parsedSubParts = parseAssistantContent(item.text);
            geminiParts.push(...parsedSubParts);
        }
    }
    return geminiParts;
}

const transformMessages = async (messages) => {
  if (!messages) { return []; }
  const contents = [];
  let system_instruction;
  for (const item of messages) {
    switch (item.role) {
      case "system":
        system_instruction = { parts: await transformMsg(item) };
        continue;
      case "tool":
        let { role: r, parts: p } = contents[contents.length - 1] ?? {};
        if (r !== "function") {
          const calls = p?.calls;
          p = []; p.calls = calls;
          contents.push({ role: "function", parts: p });
        }
        transformFnResponse(item, p);
        continue;
      case "assistant":
        item.role = "model";
        let assistantParts;
        if (item.tool_calls) {
            assistantParts = transformFnCalls(item);
        } else if (typeof item.content === 'string') {
          assistantParts = parseAssistantContent(item.content);
        } else if (Array.isArray(item.content)) {
          assistantParts = parseContentArray(item.content);
        } else {
          assistantParts = [];
        }
        contents.push({
          role: item.role,
          parts: assistantParts
        });
        continue;
      case "user":
        contents.push({
          role: item.role,
          parts: item.tool_calls ? transformFnCalls(item) : await transformMsg(item)
        });
        break;
      default:
        throw new HttpError(`Unknown message role: "${item.role}"`, 400);
    }
  }
  if (system_instruction) {
    if (!contents[0]?.parts.some(part => part.text)) {
      contents.unshift({ role: "user", parts: [{ text: " " }] });
    }
  }
  return { system_instruction, contents };
};


const transformTools = (req) => {
  let tools, tool_config;
  if (req.tools) {
    const funcs = req.tools.filter(tool => tool.type === "function");
    funcs.forEach(adjustSchema);
    tools = [{ function_declarations: funcs.map(schema => schema.function) }];
  }
  if (req.tool_choice) {
    const allowed_function_names = req.tool_choice?.type === "function" ? [ req.tool_choice?.function?.name ] : undefined;
    if (allowed_function_names || typeof req.tool_choice === "string") {
      tool_config = {
        function_calling_config: {
          mode: allowed_function_names ? "ANY" : req.tool_choice.toUpperCase(),
          allowed_function_names
        }
      };
    }
  }
  return { tools, tool_config };
};
const transformRequest = async (req, model) => ({
  ...await transformMessages(req.messages),
  safetySettings,
  generationConfig: transformConfig(req, model),
  ...transformTools(req),
});

const generateId = () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomChar = () => characters[Math.floor(Math.random() * characters.length)];
  return Array.from({ length: 29 }, randomChar).join("");
};

const reasonsMap = {
  "STOP": "stop",
  "MAX_TOKENS": "length",
  "SAFETY": "content_filter",
  "RECITATION": "content_filter",
};

const transformCandidates = (key, cand) => {
  const message = { role: "assistant" };
  const contentParts = [];
  const reasoningParts = [];

  for (const part of cand.content?.parts ?? []) {
    if (part.functionCall) {
      const fc = part.functionCall;
      message.tool_calls = message.tool_calls ?? [];
      message.tool_calls.push({
        id: fc.id ?? "call_" + generateId(),
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        }
      });
    } else if (part.thought === true && part.text) {
      reasoningParts.push(part.text);
    } else if (part.text) {
      contentParts.push(part.text);
    } else if (part.inlineData) {
      const { mimeType, data } = part.inlineData;
      const markdownImage = `![gemini-image-generation](data:${mimeType};base64,${data})`;
      contentParts.push(markdownImage);
    }
  }

  const reasoningText = reasoningParts.join("\n\n");
  if (reasoningText) {
    message.reasoning_content = reasoningText;
  }

  message.content = contentParts.length > 0 ? contentParts.join("\n\n") : null;

  if (cand.groundingMetadata) {
    message.grounding_metadata = cand.groundingMetadata;
  }
  if (cand.url_context_metadata) {
    message.url_context_metadata = cand.url_context_metadata;
  }

  return {
    index: cand.index || 0,
    [key]: message,
    logprobs: null,
    finish_reason: message.tool_calls ? "tool_calls" : reasonsMap[cand.finishReason] || cand.finishReason,
  };
};

const transformCandidatesMessage = (cand) => transformCandidates("message", cand);
const transformCandidatesDelta = (cand) => transformCandidates("delta", cand);

const notEmpty = (el) => Object.values(el).some(Boolean) ? el : undefined;

const sum = (...numbers) => numbers.reduce((total, num) => total + (num ?? 0), 0);
const transformUsage = (data) => ({
  completion_tokens: sum(data.candidatesTokenCount, data.toolUsePromptTokenCount, data.thoughtsTokenCount),
  completion_tokens: sum(data.candidatesTokenCount, data.toolUsePromptTokenCount, data.thoughtsTokenCount),
  prompt_tokens: data.promptTokenCount,
  total_tokens: data.totalTokenCount,
  completion_tokens_details: notEmpty({
    audio_tokens: data.candidatesTokensDetails
      ?.find(el => el.modality === "AUDIO")
      ?.tokenCount,
    reasoning_tokens: data.thoughtsTokenCount,
  }),
  prompt_tokens_details: notEmpty({
    audio_tokens: data.promptTokensDetails
      ?.find(el => el.modality === "AUDIO")
      ?.tokenCount,
    cached_tokens: data.cacheTokensDetails
      ?.reduce((acc,el) => acc + el.tokenCount, 0),
  }),
  total_tokens: data.totalTokenCount,
  completion_tokens_details: notEmpty({
    audio_tokens: data.candidatesTokensDetails
      ?.find(el => el.modality === "AUDIO")
      ?.tokenCount,
    reasoning_tokens: data.thoughtsTokenCount,
  }),
  prompt_tokens_details: notEmpty({
    audio_tokens: data.promptTokensDetails
      ?.find(el => el.modality === "AUDIO")
      ?.tokenCount,
    cached_tokens: data.cacheTokensDetails
      ?.reduce((acc,el) => acc + el.tokenCount, 0),
  }),
});

const checkPromptBlock = (choices, promptFeedback, key) => {
  if (choices.length) { return; }
  if (promptFeedback?.blockReason) {
    console.log("Prompt block reason:", promptFeedback.blockReason);
    if (promptFeedback.blockReason === "SAFETY") {
      promptFeedback.safetyRatings
        .filter(r => r.blocked)
        .forEach(r => console.log(r));
    }
    choices.push({
      index: 0,
      [key]: null,
      finish_reason: "content_filter",
    });
  }
  return true;
};

const processCompletionsResponse = (data, model, id) => {
  const obj = {
    id,
    choices: data.candidates.map(cand => transformCandidatesMessage(cand)),
    created: Math.floor(Date.now()/1000),
    model: data.modelVersion ?? model,
    object: "chat.completion",
    usage: data.usageMetadata && transformUsage(data.usageMetadata),
  };
  if (obj.choices.length === 0 ) {
    checkPromptBlock(obj.choices, data.promptFeedback, "message");
  }
  return JSON.stringify(obj, null, 2);
};

const responseLineRE = /^data: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
function parseStream (chunk, controller) {
  this.buffer += chunk;
  do {
    const match = this.buffer.match(responseLineRE);
    if (!match) { break; }
    controller.enqueue(match[1]);
    this.buffer = this.buffer.substring(match[0].length);
  } while (true);
}
function parseStreamFlush (controller) {
  if (this.buffer) {
    console.error("Invalid data:", this.buffer);
    controller.enqueue(this.buffer);
    this.shared.is_buffers_rest = true;
  }
}

const delimiter = "\n\n";
const sseline = (obj) => {
  obj.created = Math.floor(Date.now()/1000);
  return "data: " + JSON.stringify(obj) + delimiter;
};
function toOpenAiStream (line, controller) {
  let data;
  try {
    data = JSON.parse(line);
    if (!data.candidates) {
      throw new Error("Invalid completion chunk object");
    }
  } catch (err)
  {
    console.error("Error parsing response:", err);
    if (!this.shared.is_buffers_rest) { line =+ delimiter; }
    controller.enqueue(line);
    return;
  }
  const obj = {
    id: this.id,
    choices: data.candidates.map(cand => transformCandidatesDelta(cand)),
    model: data.modelVersion ?? this.model,
    object: "chat.completion.chunk",
    usage: data.usageMetadata && this.streamIncludeUsage ? null : undefined,
  };
  if (checkPromptBlock(obj.choices, data.promptFeedback, "delta")) {
    controller.enqueue(sseline(obj));
    return;
  }
  console.assert(data.candidates.length === 1, "Unexpected candidates count: %d", data.candidates.length);
  const cand = obj.choices[0];
  cand.index = cand.index || 0;
  const finish_reason = cand.finish_reason;
  cand.finish_reason = null;
  if (!this.last[cand.index]) {
    controller.enqueue(sseline({
      ...obj,
      choices: [{ ...cand, tool_calls: undefined, delta: { role: "assistant", content: "" } }],
    }));
  }
  delete cand.delta.role;

  if (cand.delta.content === null) {
    delete cand.delta.content;
  }

  const hasContent = "content" in cand.delta;
  const hasReasoning = "reasoning_content" in cand.delta;
  const hasToolCalls = "tool_calls" in cand.delta;
  // 因为元数据也被添加到了 delta 对象中，所以也要检查它们
  const hasGrounding = "grounding_metadata" in cand.delta;
  const hasUrlContext = "url_context_metadata" in cand.delta;

  if (hasContent || hasReasoning || hasToolCalls || hasGrounding || hasUrlContext) {
    controller.enqueue(sseline(obj));
  }

  cand.finish_reason = finish_reason;
  if (data.usageMetadata && this.streamIncludeUsage) {
    obj.usage = transformUsage(data.usageMetadata);
  }
  cand.delta = {};
  this.last[cand.index] = obj;
}
function toOpenAiStreamFlush (controller) {
  if (this.last.length > 0) {
    for (const obj of this.last) {
      controller.enqueue(sseline(obj));
    }
    controller.enqueue("data: [DONE]" + delimiter);
  }
}