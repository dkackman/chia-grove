#!/usr/bin/env python3
"""
Converts bhky/opennsfw2's pretrained Keras model (Apache 2.0) to ONNX so it can
be run in Node via onnxruntime-node. Run once, locally; the output .onnx file
is what gets checked into the repo and bundled in the deploy.

Usage:
    python3 -m venv .venv-onnx
    source .venv-onnx/bin/activate
    pip install -r requirements.txt
    python3 convert_opennsfw2_to_onnx.py
"""

import os

# tf2onnx's from_keras() only understands the legacy Keras 2 API; TensorFlow
# 2.16+ defaults tf.keras to Keras 3, so force the tf_keras compatibility shim
# before tensorflow (and anything that imports it, like opennsfw2) loads.
os.environ["TF_USE_LEGACY_KERAS"] = "1"

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import opennsfw2 as n2  # noqa: E402
import tf2onnx  # noqa: E402

OUTPUT_PATH = "opennsfw2.onnx"
INPUT_SHAPE = (224, 224, 3)  # H, W, C — matches opennsfw2's default input size


def main() -> None:
    print("Building opennsfw2 Keras model (pretrained weights ship with the package)...")
    model = n2.make_open_nsfw_model(input_shape=INPUT_SHAPE)

    print(f"Converting to ONNX -> {OUTPUT_PATH}")
    spec = (tf2onnx.tf_loader.tf.TensorSpec((1, *INPUT_SHAPE), tf2onnx.tf_loader.tf.float32, name="input"),)
    tf2onnx.convert.from_keras(model, input_signature=spec, output_path=OUTPUT_PATH)

    print("Verifying the exported ONNX model against the original Keras model...")
    rng = np.random.default_rng(0)
    sample = rng.random((1, *INPUT_SHAPE), dtype=np.float32)

    keras_score = float(model.predict(sample, verbose=0)[0][1])

    session = ort.InferenceSession(OUTPUT_PATH)
    input_name = session.get_inputs()[0].name
    onnx_output = session.run(None, {input_name: sample})
    onnx_score = float(onnx_output[0][0][1])

    diff = abs(keras_score - onnx_score)
    print(f"Keras score: {keras_score:.6f}  ONNX score: {onnx_score:.6f}  diff: {diff:.6f}")
    if diff > 1e-4:
        raise SystemExit("ONNX output diverges from the Keras model beyond tolerance — do not ship this file.")

    print(f"OK. {OUTPUT_PATH} matches the source model. Copy it into server/models/opennsfw2.onnx.")


if __name__ == "__main__":
    main()
