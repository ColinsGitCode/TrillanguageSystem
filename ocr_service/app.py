import base64
import os
import subprocess
import tempfile
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


app = FastAPI(title="tesseract-ocr-service", version="1.0.0")


class OcrRequest(BaseModel):
    image: str
    langs: Optional[str] = None


def decode_image_bytes(image_payload: str) -> bytes:
    payload = (image_payload or "").strip()
    if not payload:
        raise ValueError("Empty image payload")

    if payload.startswith("data:"):
        parts = payload.split(",", 1)
        if len(parts) != 2:
            raise ValueError("Invalid data URI image payload")
        payload = parts[1]

    padding = (-len(payload)) % 4
    if padding:
        payload += "=" * padding

    try:
        return base64.b64decode(payload, validate=False)
    except Exception as exc:
        raise ValueError("Invalid base64 image payload") from exc


def run_tesseract(image_bytes: bytes, langs: str) -> str:
    timeout_sec = int(os.getenv("OCR_TIMEOUT_SEC", "20"))
    psm = os.getenv("OCR_PSM", "6")
    oem = os.getenv("OCR_OEM", "1")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".img") as tmp:
        tmp.write(image_bytes)
        temp_path = tmp.name

    cmd = [
        "tesseract",
        temp_path,
        "stdout",
        "-l",
        langs,
        "--psm",
        str(psm),
        "--oem",
        str(oem),
    ]

    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

    text = (completed.stdout or "").strip()
    if completed.returncode != 0 and not text:
        stderr = (completed.stderr or "").strip()
        raise RuntimeError(stderr or f"Tesseract failed with exit code {completed.returncode}")
    return text


@app.get("/health")
def health():
    try:
        completed = subprocess.run(
            ["tesseract", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "Unknown error")

        first_line = (completed.stdout or "").splitlines()[0] if completed.stdout else "tesseract"
        return {"status": "ok", "engine": first_line, "langs": os.getenv("OCR_LANGS", "eng+jpn+chi_sim")}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/ocr")
def ocr(req: OcrRequest):
    langs = (req.langs or os.getenv("OCR_LANGS", "eng+jpn+chi_sim")).strip()
    try:
        image_bytes = decode_image_bytes(req.image)
        text = run_tesseract(image_bytes, langs)
        return {"text": text, "provider": "tesseract", "langs": langs}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"OCR timed out: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
