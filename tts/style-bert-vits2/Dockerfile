FROM python:3.10-slim

LABEL org.opencontainers.image.title="style-bert-vits2-poc"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      espeak-ng \
      git \
      libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python -m pip install --upgrade pip \
    && python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN python -m pip install -r requirements.txt

COPY app.py .

ENV SBV2_HOST=0.0.0.0 \
    SBV2_PORT=5000 \
    SBV2_DEVICE=cpu \
    SBV2_MODEL_ROOT=/models/model_assets \
    SBV2_MODEL_REPO=litagin/style_bert_vits2_jvnv \
    SBV2_MODEL_NAME=jvnv-F1-jp \
    SBV2_MODEL_FILE=jvnv-F1-jp/jvnv-F1-jp_e160_s14000.safetensors \
    SBV2_CONFIG_FILE=jvnv-F1-jp/config.json \
    SBV2_STYLE_FILE=jvnv-F1-jp/style_vectors.npy \
    HF_HOME=/models/huggingface

EXPOSE 5000

CMD ["sh", "-c", "python -m uvicorn app:app --host ${SBV2_HOST:-0.0.0.0} --port ${SBV2_PORT:-5000}"]
