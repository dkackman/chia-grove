export type MediaKind = "image" | "video" | "audio";

const VIDEO_EXT = new Set([".mp4", ".webm", ".ogv", ".mov"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".oga", ".flac", ".aac"]);

/** Classify an NFT media URL by file extension (query/fragment ignored). */
export function mediaKind(url: string): MediaKind {
  const ext = url.match(/\.[a-z0-9]+(?=[?#]|$)/i)?.[0]?.toLowerCase() ?? "";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "image";
}
