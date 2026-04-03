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
# The full CUDA wheel is not needed because Cloud Run runs on CPU.
RUN pip install --no-cache-dir \
    torch \
    torchvision \
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

CMD uvicorn backend.main:app --host 0.0.0.0 --port "${PORT}"
