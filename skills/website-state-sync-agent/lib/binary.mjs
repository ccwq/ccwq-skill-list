const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeText(value) { return encoder.encode(value); }
export function decodeText(value) { return decoder.decode(value); }

export function toBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
