import type { VideoRenderer } from '../../infrastructure/integrations/hub-tools';

/**
 * Quadros de um vídeo como ele é, em frações da duração (ex.: 0.15, 0.5, 0.9). Usado pelos revisores que precisam
 * olhar o vídeo.
 */
export async function videoFrames(renderer: VideoRenderer, videoUrl: string, parts: number[]) {
  const video = await renderer.probe(videoUrl);
  const seconds = parts.map((part) => video.durationInSeconds * part);
  const frames = await renderer.frames(videoUrl, seconds);
  return frames.map((frame, index) => ({ second: seconds[index]!, ...frame }));
}
