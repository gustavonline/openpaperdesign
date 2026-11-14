// How long a request may take. An ordinary request (a read, a save, a tool call) stays bounded at 30 seconds in total. Moving a known amount of bytes (a handoff
// source archive: up to 24 MB, the real one is 10.9 MB, which is about 44 seconds at 2 Mbit/s) is bounded by SIZE and by PROGRESS instead: it may take as long as
// the bytes need at a stated minimum rate, ends if nothing moves for the idle time, and never goes past a hard ceiling. Only the handoff route asks for this.
import {PaperError} from './library.mjs';

// Mutable only so a test can run the same logic in milliseconds.
export const TIMING = {request: 30000, idle: 30000, minBytesPerSecond: 64 * 1024, ceiling: 15 * 60 * 1000};
export const transferMs = bytes => Math.min(TIMING.ceiling, TIMING.request + Math.ceil(Math.max(0, bytes) / TIMING.minBytesPerSecond) * 1000);

// fetch plus the whole body, with the response capped at `max` bytes. With `expected` (the bytes about to move, in either direction) the size-and-progress budget applies,
// otherwise the ordinary total bound. Before the response starts only the total budget applies (an upload has no progress to watch); once it flows, silence ends it.
export async function fetchBytes(url, init, {max, expected} = {}) {
  const tooLarge = () => new PaperError(413, 'The shared response is too large.');
  if (expected === undefined) {
    const response = await fetch(url, {...init, signal: AbortSignal.timeout(TIMING.request)});
    if (Number(response.headers.get('content-length')) > max) throw tooLarge();
    const chunks = []; let size = 0; for await (const chunk of response.body) { size += chunk.length; if (size > max) throw tooLarge(); chunks.push(chunk); }
    return {response, bytes: Buffer.concat(chunks)};
  }
  const controller = new AbortController(); let reason = 'took too long', idle;
  const total = setTimeout(() => { reason = 'took too long'; controller.abort(); }, transferMs(expected)), poke = () => { clearTimeout(idle); idle = setTimeout(() => { reason = 'stalled: nothing arrived for a while'; controller.abort(); }, TIMING.idle); };
  try {
    const response = await fetch(url, {...init, signal: controller.signal}); poke();
    if (Number(response.headers.get('content-length')) > max) throw tooLarge();
    const chunks = []; let size = 0; for await (const chunk of response.body) { poke(); size += chunk.length; if (size > max) throw tooLarge(); chunks.push(chunk); }
    return {response, bytes: Buffer.concat(chunks)};
  } catch (error) {
    if (controller.signal.aborted) throw new PaperError(504, `The transfer ${reason}. Nothing was kept; try again.`);
    throw error;
  } finally { clearTimeout(total); clearTimeout(idle); }
}
