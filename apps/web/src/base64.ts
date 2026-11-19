export function toBase64(value: Uint8Array) {
  let text = ''
  for (let index = 0; index < value.length; index += 8192) {
    text += String.fromCharCode(...value.subarray(index, index + 8192))
  }
  return btoa(text)
}
