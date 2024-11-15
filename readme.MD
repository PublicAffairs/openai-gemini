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
> Even if you are located outside of the [supported regions](https://ai.google.dev/available_regions#available_regions)
> (e.g., in Europe), it is still possible to acquire one using a VPN.

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
- Alternatively can be deployed manually pasting content of [`src/worker.mjs`](../resize-images/src/worker.mjs)
  to https://workers.cloudflare.com/playground (see there `Deploy` button).
- Alternatively can be deployed with [cli](https://developers.cloudflare.com/workers/wrangler/):
  `wrangler deploy`
- Serve locally: `wrangler dev`
- _Worker_ [limits](https://developers.cloudflare.com/workers/platform/limits/#worker-limits)

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

However, some software may expect it without the `/v1` ending:  
`https://my-super-proxy.vercel.app`

The relevant field may be labeled as "_OpenAI proxy_".
You might need to look under "_Advanced settings_" or similar sections.
Alternatively, it could be in some config file (check the relevant documentation for details).

For some command-line tools, you may need to set an environment variable, _e.g._:
```sh
set OPENAI_BASE_URL=https://my-super-proxy.vercel.app/v1
```
_..or_:
```sh
set OPENAI_API_BASE=https://my-super-proxy.vercel.app/v1
```

Example Chat Completion API Request:

```bash
curl https://my-super-proxy.vercel.app/v1/chat/completions \
 -H "Content-Type: application/json" \
 -H "Authorization: Bearer $GOOGLE_API_KEY" \
 -d '{
     "model": "gemini-1.5-flash",
     "messages": [{"role": "user", "content": "Say this is a test!"}],
     "temperature": 0.7
 }'
```



## Models

In case the model specified in the request differs from "gemini-*",
the default [model] `gemini-1.5-pro` will be used.

[model]: https://ai.google.dev/gemini-api/docs/models/gemini

Model Mapping:

| Gemini Model        | **Rate Limits**                                              | Optimized For                                                |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| gemini-1.0-pro      | 15 RPM (requests per minute)<br/>32,000 TPM (tokens per minute)<br/>1,500 RPD (requests per day) | Natural language tasks (Deprecated on 2/15/2025)             |
| gemini-1.5-pro      | 2 RPM (requests per minute)<br/>32,000 TPM (tokens per minute)<br/>50 RPD (requests per day) | Complex reasoning tasks requiring more intelligence          |
| gemini-1.5-flash    | 15 RPM (requests per minute)<br />1 million TPM (tokens per minute)<br />1,500 RPD (requests per day) | Fast and versatile performance across a diverse variety of tasks |
| gemini-1.5-flash-8b | 15 RPM (requests per minute)<br/>1 million TPM (tokens per minute)<br/>1,500 RPD (requests per day) | High volume and lower intelligence tasks                     |
| text-embedding-004  | 1,500 RPM (requests per minute)                              | Measuring the relatedness of text strings                    |

---

## Possible further development

- [x] `chat/completions`

  Currently, most of the parameters that are applicable to both APIs have been implemented,
  with the exception of function calls.
  <details>

  - [x] `messages`
      - [x] `content`
      - [x] `role`
          - [x] `system` (=>`system_instruction`)
          - [x] `user`
          - [x] `assistant`
          - [ ] `tool` (v1beta)
      - [ ] `name`
      - [ ] `tool_calls`
  - [x] `model`
  - [ ] `frequency_penalty`
  - [ ] `logit_bias`
  - [ ] `logprobs`
  - [ ] `top_logprobs`
  - [x] `max_tokens`
  - [x] `n` (`candidateCount` <8) _n.b.: atm api does not accept >1_
  - [ ] `presence_penalty`
  - [x] `response_format`
  - [ ] `seed`
  - [ ] `service_tier`
  - [x] `stop`: string|array (`stopSequences` [1,5])
  - [x] `stream`
  - [ ] `stream_options`
      - [ ] `include_usage`
  - [x] `temperature` (0.0..2.0 for OpenAI, but Gemini supports up to infinity)
  - [x] `top_p`
  - [ ] `tools` (v1beta)
  - [ ] `tool_choice` (v1beta)
  - [ ] `parallel_tool_calls`
  - [ ] `user`

  </details>
- [ ] `completions`
- [ ] `embeddings`
- [ ] `models`
