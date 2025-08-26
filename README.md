## Why

The Gemini API is [free](https://ai.google.dev/pricing "limits applied!"),
but there are many tools that work exclusively with the OpenAI API.

This project provides a personal OpenAI-compatible endpoint for free.


## Serverless?

Although it runs in the cloud, it does not require server maintenance.
It can be easily deployed to various providers for free
(with generous limits suitable for personal use).

> [!TIP]
> Running the proxy endpoint locally is also an option,
> though it's more appropriate for development use.


## How to start

You will need a personal Google [API key](https://makersuite.google.com/app/apikey).

> [!IMPORTANT]
> Even if you are located outside of the [supported regions](https://ai.google.dev/gemini-api/docs/available-regions#available_regions),
> it is still possible to acquire one using a VPN.

Deploy the project to one of the providers, using the instructions below.
You will need to set up an account there.

If you opt for “button-deploy”, you'll be guided through the process of forking the repository first,
which is necessary for continuous integration (CI).


### Deploy with Vercel

 [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/PublicAffairs/openai-gemini&repository-name=my-openai-gemini)
- Alternatively can be deployed with [cli](https://vercel.com/docs/cli):
  `vercel deploy`
- Serve locally: `vercel dev`
- Vercel _Functions_ [limitations](https://vercel.com/docs/functions/limitations) (with _Edge_ runtime)


### Deploy to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/PublicAffairs/openai-gemini&integrationName=integrationName&integrationSlug=integrationSlug&integrationDescription=integrationDescription)
- Alternatively can be deployed with [cli](https://docs.netlify.com/cli/get-started/):
  `netlify deploy`
- Serve locally: `netlify dev`
- Two different api bases provided:
  - `/v1` (e.g. `/v1/chat/completions` endpoint)  
    _Functions_ [limits](https://docs.netlify.com/functions/get-started/?fn-language=js#synchronous-function-2)
  - `/edge/v1`  
    _Edge functions_ [limits](https://docs.netlify.com/edge-functions/limits/)


### Deploy to Cloudflare

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PublicAffairs/openai-gemini)
- Alternatively can be deployed manually pasting content of [`src/worker.mjs`](src/worker.mjs)
  to https://workers.cloudflare.com/playground (see there `Deploy` button).
- Alternatively can be deployed with [cli](https://developers.cloudflare.com/workers/wrangler/):
  `wrangler deploy`
- Serve locally: `wrangler dev`
- _Worker_ [limits](https://developers.cloudflare.com/workers/platform/limits/#worker-limits)


### Deploy to Deno

See details [here](https://github.com/PublicAffairs/openai-gemini/discussions/19).


### Serve locally - with Node, Deno, Bun

Only for Node: `npm install`.

Then `npm run start` / `npm run start:deno` / `npm run start:bun`.


#### Dev mode (watch source changes)

Only for Node: `npm install --include=dev`

Then: `npm run dev` / `npm run dev:deno` / `npm run dev:bun`.


## How to use
If you open your newly-deployed site in a browser, you will only see a `404 Not Found` message. This is expected, as the API is not designed for direct browser access.
To utilize it, you should enter your API address and your Gemini API key into the corresponding fields in your software settings.

> [!NOTE]
> Not all software tools allow overriding the OpenAI endpoint, but many do
> (however these settings can sometimes be deeply hidden).

Typically, you should specify the API base in this format:  
`https://my-super-proxy.vercel.app/v1`

The relevant field may be labeled as "_OpenAI proxy_".
You might need to look under "_Advanced settings_" or similar sections.
Alternatively, it could be in some config file (check the relevant documentation for details).

For some command-line tools, you may need to set an environment variable, _e.g._:
```sh
OPENAI_BASE_URL="https://my-super-proxy.vercel.app/v1"
```
_..or_:
```sh
OPENAI_API_BASE="https://my-super-proxy.vercel.app/v1"
```


## Models

Requests use the specified [model] if its name starts with "gemini-", "gemma-", "learnlm-", 
or "models/". Otherwise, these defaults apply:

- `chat/completions`: `gemini-2.5-flash`
- `embeddings`: `gemini-embedding-001`
- `audio/speech`: `gemini-2.5-flash-preview-tts`

[model]: https://ai.google.dev/gemini-api/docs/models#model-variations

## Reasoning (Thinking)

This proxy supports the `reasoning_effort` parameter to control the Gemini model's internal "thinking" process, mapping it to Gemini's `thinkingBudget`.

- `reasoning_effort: "low"`: Uses the minimum thinking budget. For "pro" models, this is `128`; for other models (like Flash), it is `0` (disabling thinking). This is useful for faster responses on simpler tasks.
- `reasoning_effort: "medium"` (or not specified): Enables dynamic thinking (`-1`), allowing the model to adjust its thinking budget based on the request's complexity. This is the default behavior for Gemini 2.5 models.
- `reasoning_effort: "high"`: Sets a high thinking budget (`24576`) for the most complex tasks that require deep reasoning and planning.

## Built-in tools

### Web Search
To use the **web search** tool, append ":search" to the model name
(e.g., "gemini-2.5-flash:search").

Note: The `annotations` message property is not implemented.

### Image Generation
To use the **image generation** tool, specify a model name that includes `image-generation`. The response will be delivered within the `chat/completions` message content as a markdown image string, like this: `![gemini-image-generation](data:image/png;base64,...)`.

## Text-to-Speech (TTS)

The proxy supports text-to-speech generation via the `/v1/audio/speech` endpoint, mapping to Gemini's audio generation capabilities.

- **Endpoint**: `/v1/audio/speech`
- **Method**: `POST`
- **Supported Parameters**: `input`, `voice`, `model`, `response_format`.
- **Supported `response_format`**: 
    - Natively supports `wav` (with header) and `pcm` (raw audio data).
    - Requesting other formats like `mp3`, `opus`, `aac`, or `flac` will result in a **fallback to the `wav` format**. In such cases, the response will include an `X-Warning` header indicating the fallback.

## Media

[Vision] and [audio] input supported as per OpenAI [specs].
Implemented via [`inlineData`](https://ai.google.dev/api/caching#Part).

[vision]: https://platform.openai.com/docs/guides/images-vision?api-mode=chat&format=url#giving-a-model-images-as-input
[audio]: https://platform.openai.com/docs/guides/audio?example=audio-in&lang=curl#add-audio-to-your-existing-application
[specs]: https://platform.openai.com/docs/api-reference/chat/create


## Gemini-specific functions

There are several features supported by Gemini that are not available in OpenAI models
but can be enabled using the `extra_body` field.
The most notable of these is [`thinking_config`](https://ai.google.dev/gemini-api/docs/openai#thinking).

For more details, refer to the [Gemini API docs](https://ai.google.dev/gemini-api/docs/openai#extra-body).

---

## Supported API endpoints and applicable parameters

- [x] `chat/completions`

  Currently, most of the parameters that are applicable to both APIs have been implemented.
  <details>

  - [x] `messages`
      - [x] `content`
      - [x] `role`
          - [x] "system" (=>`system_instruction`)
          - [x] "user"
          - [x] "assistant"
          - [x] "tool"
      - [ ] `name`
      - [x] `tool_calls`
  - [x] `model`
  - [x] `frequency_penalty`
  - [ ] `logit_bias`
  - [ ] `logprobs`
  - [ ] `top_logprobs`
  - [x] `max_tokens`, `max_completion_tokens`
  - [x] `n` (`candidateCount` <8, not for streaming)
  - [x] `presence_penalty`
  - [x] `reasoning_effort`
  - [x] `response_format`
      - [x] "json_object"
      - [x] "json_schema" (a select subset of an OpenAPI 3.0 schema object)
      - [x] "text"
  - [x] `seed`
  - [x] `stop`: string|array (`stopSequences` [1,5])
  - [x] `stream`
  - [x] `stream_options`
      - [x] `include_usage`
  - [x] `temperature` (0.0..2.0 for OpenAI, but Gemini supports up to infinity)
  - [x] `top_p`
  - [x] `tools`
  - [x] `tool_choice`
  - [ ] `parallel_tool_calls` (is always active in Gemini)
  - [x] [`extra_body`](#gemini-specific-functions)

  </details>
- [ ] `completions`
- [x] `embeddings`
  - [x] `dimensions`
- [x] `models`
- [x] `audio/speech`