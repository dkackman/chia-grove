import sharp from "sharp";

const INPUT_SIZE = 224;
const RESIZE_SIZE = 256;
const CROP_OFFSET = (RESIZE_SIZE - INPUT_SIZE) / 2;
// BGR order, matching the channel flip below (VGG-style training-set mean).
const BGR_MEAN = [104, 117, 123];

/**
 * Reproduces opennsfw2's `preprocess_image(..., Preprocessing.YAHOO)`: resize
 * to 256x256 (bilinear, ignoring aspect ratio), center-crop to 224x224,
 * RGB->BGR, subtract the per-channel training-set mean.
 *
 * Deliberately omits the reference implementation's intermediate JPEG
 * re-encode/decode round trip (an artifact of matching a specific Caffe/skimage
 * decode path, not a meaningful part of the signal) — see
 * server/models/convert_opennsfw2_to_onnx.py and the parity fixtures under
 * server/test/fixtures for how the acceptable drift from that omission, plus
 * PIL-vs-sharp resize kernel differences, was measured and bounded.
 */
export async function preprocessOpenNsfw(imageBytes: Uint8Array): Promise<Float32Array> {
  const { data, info } = await sharp(imageBytes)
    .removeAlpha()
    .toColourspace("srgb")
    .resize(RESIZE_SIZE, RESIZE_SIZE, { fit: "fill", kernel: "linear" })
    .extract({ left: CROP_OFFSET, top: CROP_OFFSET, width: INPUT_SIZE, height: INPUT_SIZE })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`expected 3-channel RGB after removeAlpha, got ${info.channels}`);
  }

  const tensor = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let px = 0; px < INPUT_SIZE * INPUT_SIZE; px++) {
    const r = data[px * 3];
    const g = data[px * 3 + 1];
    const b = data[px * 3 + 2];
    tensor[px * 3] = b - BGR_MEAN[0];
    tensor[px * 3 + 1] = g - BGR_MEAN[1];
    tensor[px * 3 + 2] = r - BGR_MEAN[2];
  }
  return tensor;
}
