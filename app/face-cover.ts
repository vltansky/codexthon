// Renders a face crop inside a square tile without distortion: the crop
// region is made square in image-pixel space (using the photo's aspect
// ratio), so the background scales uniformly instead of stretching the box.
export function faceCoverStyle(coverThumbnailUrl: string, coverBox: number[], coverAspect: number): React.CSSProperties {
  if (!coverThumbnailUrl) return {};
  if (coverBox.length !== 4 || !(coverAspect > 0)) {
    return { backgroundImage: `url("${coverThumbnailUrl}")`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = coverBox;
  // Work in pixel-like units with height 1 and width = aspect.
  const imageWidth = coverAspect;
  const imageHeight = 1;
  const boxWidth = (x2 - x1) * imageWidth;
  const boxHeight = (y2 - y1) * imageHeight;
  const centerX = ((x1 + x2) / 2) * imageWidth;
  const centerY = ((y1 + y2) / 2) * imageHeight;
  const side = Math.min(Math.max(boxWidth, boxHeight) * 1.45, imageWidth, imageHeight);
  const left = clamp(centerX - side / 2, 0, imageWidth - side);
  const top = clamp(centerY - side / 2, 0, imageHeight - side);
  return {
    backgroundImage: `url("${coverThumbnailUrl}")`,
    backgroundSize: `${(imageWidth / side) * 100}% auto`,
    backgroundPosition: `${imageWidth === side ? 0 : (left / (imageWidth - side)) * 100}% ${imageHeight === side ? 0 : (top / (imageHeight - side)) * 100}%`,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
