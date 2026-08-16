export function satOverlayOptions(frame) {
  return {
    opacity: 0.9,
    interactive: false,
    pane: "satPane",
    attribution: frame?.attribution || "GOES ABI via NOAA / AWS",
    className: "sat-overlay",
  };
}

function frameImageUrl(frame) {
  if (!frame.imageUrl) frame.imageUrl = frame.canvas.toDataURL("image/png");
  return frame.imageUrl;
}

export function createSatOverlay(frame) {
  return L.imageOverlay(frameImageUrl(frame), frame.bounds, satOverlayOptions(frame));
}

export function updateSatOverlay(layer, frame) {
  layer.setUrl(frameImageUrl(frame));
  layer.setBounds(frame.bounds);
  return layer;
}
