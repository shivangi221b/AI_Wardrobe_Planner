FROM python:3.10-slim

# Install system-level dependencies required by OpenCV (headless), ONNX Runtime, and Pillow.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies in two stages so that the heavy torch layer is
# cached independently and only rebuilt when requirements.txt changes.

COPY requirements.txt .

# Install CPU-only PyTorch first to keep the image under ~2 GB.
# Versions are pinned for reproducible builds — bump deliberately and test
# locally before committing, since torch ABI changes can break ultralytics
# and open-clip-torch. torch is intentionally absent from requirements.txt
# so this install is the single authoritative source of the PyTorch wheel.
RUN pip install --no-cache-dir \
    "torch==2.5.1" \
    "torchvision==0.20.1" \
    --index-url https://download.pytorch.org/whl/cpu

# Install the remaining packages (ultralytics, open-clip-torch, rembg, etc.)
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the rembg background-removal model so that the first request
# does not incur a cold-start model download penalty inside the container.
RUN python -c "from rembg import new_session; new_session('u2net')" || true

# Copy application source after installing deps to benefit from layer caching.
COPY backend/ backend/
COPY vision/ vision/

# Cloud Run injects PORT automatically (defaults to 8080).
ENV PORT=8080

# Use exec-form so the shell is NOT PID 1. The inner `exec` replaces sh with
# uvicorn, ensuring SIGTERM from Cloud Run is delivered directly to uvicorn
# for graceful shutdown. Shell-form CMD (a plain string) leaves sh as PID 1
# which may swallow SIGTERM and cause Cloud Run to force-kill the container.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
