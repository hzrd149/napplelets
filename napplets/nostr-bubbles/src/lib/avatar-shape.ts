export function getAvatarShapeMaskUrl(emoji: string): string {
  const cached = maskCache.get(emoji);
  if (cached) return cached;

  const fontSize = 512;
  const scratch = fontSize * 1.5;
  const source = document.createElement('canvas');
  source.width = scratch;
  source.height = scratch;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) return '';

  sourceContext.textAlign = 'center';
  sourceContext.textBaseline = 'middle';
  sourceContext.font = `${fontSize}px serif`;
  sourceContext.fillText(emoji, scratch / 2, scratch / 2);

  const { data, width, height } = sourceContext.getImageData(0, 0, scratch, scratch);
  let top = height;
  let bottom = 0;
  let left = width;
  let right = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! > 25) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (right < left || bottom < top) return '';

  let cropWidth = right - left + 1;
  let cropHeight = bottom - top + 1;
  if (cropWidth > cropHeight) {
    top = Math.max(0, top - Math.floor((cropWidth - cropHeight) / 2));
    cropHeight = cropWidth;
  } else if (cropHeight > cropWidth) {
    left = Math.max(0, left - Math.floor((cropHeight - cropWidth) / 2));
    cropWidth = cropHeight;
  }

  const output = document.createElement('canvas');
  output.width = 256;
  output.height = 256;
  const outputContext = output.getContext('2d');
  if (!outputContext) return '';
  outputContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, 256, 256);
  const image = outputContext.getImageData(0, 0, 256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255;
    image.data[i + 1] = 255;
    image.data[i + 2] = 255;
  }
  outputContext.putImageData(image, 0, 0);
  const url = output.toDataURL('image/png');
  maskCache.set(emoji, url);
  return url;
}

const maskCache = new Map<string, string>();
