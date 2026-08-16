export function satOverlayOptions() {
  return {
    opacity: 0.85,
    interactive: false,
    pane: "satPane",
    attribution: "GOES via IEM",
    className: "sat-overlay",
  };
}

export function createSatOverlay(frame) {
  return L.imageOverlay(frame.canvas.toDataURL("image/png"), frame.bounds, satOverlayOptions());
}

export function updateSatOverlay(layer, frame) {
  layer.setUrl(frame.canvas.toDataURL("image/png"));
  layer.setBounds(frame.bounds);
  return layer;
}
