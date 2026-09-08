# Sidecar container for the automated "Biên dịch sang tiếng Việt" pipeline
# (see ../docs/vi-translate.md). Isolated in its own image on purpose —
# VI-Translate needs a full Python/ML stack (opencv, onnxruntime, pymupdf,
# a ~75MB layout-detection model) that has nothing to do with the Node
# backend, and installing it straight on the VPS host is exactly the kind
# of thing that quietly breaks the next `apt upgrade` or python3 update.
FROM python:3.12-slim

# libgl1/libglib2.0-0 — opencv-python needs these at the OS level even
# though pip installs only the Python bindings; without them it fails to
# import with a missing libGL.so.1 error the moment translate_pdf.py runs
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      libgl1 \
      libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Defaults to the latest main — fine while this is new and still settling,
# but once it's working reliably, pin this to a specific tag/commit (build
# with --build-arg VI_TRANSLATE_REF=<sha>) so a change upstream can't alter
# translation behavior out from under a working deploy without you choosing it.
ARG VI_TRANSLATE_REF=main
RUN git clone --depth 1 --branch ${VI_TRANSLATE_REF} \
      https://github.com/breslee1707/VI-Translate.git vi-translate

# base requirements only — OCR mode (requirements-ocr.txt) is deliberately
# left out: it's for scanned books, which isn't the common case here, and
# it drags in a second, heavier model. See docs/vi-translate.md if that
# ever needs to change.
RUN pip install --no-cache-dir -r vi-translate/requirements.txt

# warms babeldoc's layout-detection model into the image at build time
# instead of on the first real request — the first call to translate_pdf.py
# would otherwise download it from the network and stall for a while,
# right when someone's actually waiting on a translation
RUN python -c "from babeldoc.assets.assets import get_doclayout_onnx_model_path; get_doclayout_onnx_model_path()"

COPY server.py .

EXPOSE 8787
CMD ["python", "server.py"]
