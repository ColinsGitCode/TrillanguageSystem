# vLLM Recommended Config (Jetson Orin, Few-shot Validation)

**Date**: 2026-02-06
**Purpose**: Provide stable, reproducible vLLM settings for few-shot validation and reporting on Jetson AGX Orin (64GB).

---

## 1. Baseline Profile (Text-only, 7B)

**Target model**: Qwen2.5-7B-Instruct (text-only)

**Recommended settings**
- `--max-model-len 4096`
- `--gpu-memory-utilization 0.42`
- `--max-num-seqs 4`
- `--block-size 64`
- `--dtype float16`
- **Attention backend**: XFORMERS

**Environment**
```bash
export VLLM_ATTENTION_BACKEND=XFORMERS
export VLLM_FLASH_ATTN_VERSION=2
export VLLM_USE_TRITON_FLASH_ATTN=0
```

**Why**
- 4096 context is the current stable upper bound for Orin + XFORMERS.
- 0.42 leaves room for embedding/reranker and avoids OOM.
- max_num_seqs=4 is the known safe concurrent limit.
- block-size=64 matches paged attention requirements.

---

## 2. Quality Profile (Text-only, 14B, 4-bit)

**Target model**: Qwen2.5-14B-Instruct (text-only, quantized)

**Recommended settings**
- `--max-model-len 4096`
- `--gpu-memory-utilization 0.50` (if no embedding/reranker), otherwise 0.45
- `--max-num-seqs 2`
- `--block-size 64`
- `--dtype float16`
- `--quantization awq` (or `gptq`, depending on available weights)
- **Attention backend**: XFORMERS

**Why**
- 14B improves linguistic quality but requires quantization on Orin.
- Lower concurrency to protect latency and stability.

---

## 3. Few-shot Budget Guidance

Given `max_model_len=4096`:
- **few-shot token budget**: <= 25% (about 1024 tokens)
- **prompt total budget**: <= 75% (about 3072 tokens)
- fallback order: reduce examples -> truncate examples -> disable few-shot

---

## 4. Example vLLM Launch (7B)

```bash
python -m vllm.entrypoints.openai.api_server \
  --model /path/to/Qwen2.5-7B-Instruct \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.42 \
  --max-num-seqs 4 \
  --block-size 64 \
  --dtype float16
```

## 5. Example vLLM Launch (14B, 4-bit)

```bash
python -m vllm.entrypoints.openai.api_server \
  --model /path/to/Qwen2.5-14B-Instruct-AWQ \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.45 \
  --max-num-seqs 2 \
  --block-size 64 \
  --dtype float16 \
  --quantization awq
```

---

## 6. Notes

- Keep XFORMERS backend on Jetson; TRITON/FlashAttention PTX can be unstable on CUDA 12.6.
- For report consistency, lock a single model + config during A/B testing.
- If you must increase `max_model_len`, adjust few-shot budget proportionally and retest JSON parsing stability.

