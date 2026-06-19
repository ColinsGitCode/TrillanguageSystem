# Style-Bert-VITS2 POC

This optional service is the Japanese TTS quality POC. It is not started by the default Compose stack.

## Start

```bash
docker compose -p npm-audit-deps --profile sbv2 up -d --build tts-ja-sbv2
```

First startup downloads the configured JVNV model assets and Japanese BERT resources into the `sbv2_models` volume.
The container listens on port 5000 internally and maps to host port 15000 by default. Override with `SBV2_HOST_PORT`.
The OpenJTalk worker subprocess is disabled by default for the container POC. Enable it with `SBV2_ENABLE_OPENJTALK_WORKER=true` only if direct pyopenjtalk inference is not enough.

## Smoke Test

```bash
curl -fsS http://127.0.0.1:15000/status
curl -fsS http://127.0.0.1:15000/models/info
curl -fsS -G --data-urlencode 'text=こんにちは' \
  http://127.0.0.1:15000/voice \
  -o .tmp/sbv2-hello.wav
```

`/status` is lightweight and does not load the model. `/models/info` and `/voice` lazy-load the model.
