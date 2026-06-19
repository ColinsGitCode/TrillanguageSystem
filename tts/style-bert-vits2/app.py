import os
import threading
from io import BytesIO
from pathlib import Path

import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from huggingface_hub import hf_hub_download
from scipy.io import wavfile
from style_bert_vits2.constants import Languages
from style_bert_vits2.nlp import bert_models
from style_bert_vits2.nlp.japanese import pyopenjtalk_worker as pyopenjtalk
from style_bert_vits2.nlp.japanese.user_dict import update_dict
from style_bert_vits2.tts_model import TTSModel


MODEL_REPO = os.getenv("SBV2_MODEL_REPO", "litagin/style_bert_vits2_jvnv")
MODEL_ROOT = Path(os.getenv("SBV2_MODEL_ROOT", "/models/model_assets"))
MODEL_NAME = os.getenv("SBV2_MODEL_NAME", "jvnv-F1-jp")
MODEL_FILE = os.getenv("SBV2_MODEL_FILE", "jvnv-F1-jp/jvnv-F1-jp_e160_s14000.safetensors")
CONFIG_FILE = os.getenv("SBV2_CONFIG_FILE", "jvnv-F1-jp/config.json")
STYLE_FILE = os.getenv("SBV2_STYLE_FILE", "jvnv-F1-jp/style_vectors.npy")
DEVICE = os.getenv("SBV2_DEVICE", "cpu")
BERT_MODEL = os.getenv("SBV2_BERT_MODEL", "ku-nlp/deberta-v2-large-japanese-char-wwm")
BERT_CACHE_DIR = os.getenv("SBV2_BERT_CACHE_DIR", str(MODEL_ROOT.parent / "bert"))
ENABLE_OPENJTALK_WORKER = os.getenv("SBV2_ENABLE_OPENJTALK_WORKER", "").lower() in {
    "1",
    "true",
    "yes",
}

app = FastAPI(title="Style-Bert-VITS2 POC", version="0.1.0")
_model_lock = threading.Lock()
_model = None
_initialized = False


def _ensure_assets() -> dict[str, Path]:
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    files = {
        "model": MODEL_FILE,
        "config": CONFIG_FILE,
        "style": STYLE_FILE,
    }
    resolved = {}
    for key, filename in files.items():
        hf_hub_download(
            repo_id=MODEL_REPO,
            filename=filename,
            local_dir=MODEL_ROOT,
            local_dir_use_symlinks=False,
        )
        resolved[key] = MODEL_ROOT / filename
    return resolved


def _resolve_language(value: str):
    normalized = str(value or "JP").upper()
    for language in Languages:
        if language.name.upper() == normalized or str(language.value).upper() == normalized:
            return language
    raise HTTPException(status_code=422, detail=f"Unsupported language: {value}")


def _initialize_runtime():
    global _initialized
    if _initialized:
        return
    if ENABLE_OPENJTALK_WORKER:
        pyopenjtalk.initialize_worker()
        update_dict()
    bert_model = bert_models.load_model(
        Languages.JP,
        pretrained_model_name_or_path=BERT_MODEL,
        cache_dir=BERT_CACHE_DIR,
    )
    if hasattr(bert_model, "to"):
        bert_model.to(DEVICE)
    bert_models.load_tokenizer(
        Languages.JP,
        pretrained_model_name_or_path=BERT_MODEL,
        cache_dir=BERT_CACHE_DIR,
    )
    _initialized = True


def _load_model():
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        _initialize_runtime()
        paths = _ensure_assets()
        _model = TTSModel(
            model_path=paths["model"],
            config_path=paths["config"],
            style_vec_path=paths["style"],
            device=DEVICE,
        )
        return _model


def _resolve_model(model_id: int, model_name: str | None):
    if model_name and model_name != MODEL_NAME:
        raise HTTPException(status_code=422, detail=f"model_name={model_name} not found")
    if model_id != 0:
        raise HTTPException(status_code=422, detail=f"model_id={model_id} not found")
    return _load_model()


def _resolve_speaker_id(model, speaker_id: int, speaker_name: str | None) -> int:
    if speaker_name:
        if speaker_name not in model.spk2id:
            raise HTTPException(status_code=422, detail=f"speaker_name={speaker_name} not found")
        return model.spk2id[speaker_name]
    if speaker_id not in model.id2spk:
        raise HTTPException(status_code=422, detail=f"speaker_id={speaker_id} not found")
    return speaker_id


@app.get("/status")
def status():
    devices = ["cpu"]
    devices.extend(f"cuda:{index}" for index in range(torch.cuda.device_count()))
    return {
        "service": "style-bert-vits2",
        "device": DEVICE,
        "devices": devices,
        "model_loaded": _model is not None,
        "model_name": MODEL_NAME,
        "model_repo": MODEL_REPO,
    }


@app.get("/models/info")
def models_info():
    model = _load_model()
    return {
        "0": {
            "model_name": MODEL_NAME,
            "model_path": str(model.model_path),
            "config_path": str(model.config_path),
            "device": model.device,
            "spk2id": model.spk2id,
            "id2spk": model.id2spk,
            "style2id": model.style2id,
        }
    }


@app.get("/voice")
@app.post("/voice")
def voice(
    text: str = Query(..., min_length=1),
    model_name: str | None = Query(None),
    model_id: int = Query(0),
    speaker_name: str | None = Query(None),
    speaker_id: int = Query(0),
    style: str = Query("Neutral"),
    length: float = Query(1.0),
    language: str = Query("JP"),
):
    model = _resolve_model(model_id, model_name)
    resolved_speaker_id = _resolve_speaker_id(model, speaker_id, speaker_name)
    if style not in model.style2id:
        raise HTTPException(status_code=422, detail=f"style={style} not found")

    try:
        sample_rate, audio = model.infer(
            text=text,
            language=_resolve_language(language),
            speaker_id=resolved_speaker_id,
            style=style,
            length=length,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    output = BytesIO()
    wavfile.write(output, sample_rate, audio)
    return Response(content=output.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host=os.getenv("SBV2_HOST", "0.0.0.0"),
        port=int(os.getenv("SBV2_PORT", "5000")),
        log_level=os.getenv("SBV2_LOG_LEVEL", "info"),
    )
