const POPUP_GAP = 10;
const WINDOW_MARGIN = 8;
const POINTER_EDGE_MARGIN = 22;

function calculatePopupPlacement({ trayBounds, windowBounds, workArea }) {
  const width = Math.max(0, Number(windowBounds?.width) || 0);
  const height = Math.max(0, Number(windowBounds?.height) || 0);
  const trayCenterX = Number(trayBounds?.x || 0) + Number(trayBounds?.width || 0) / 2;
  const preferredX = Math.round(trayCenterX - width + 42);
  const minX = Number(workArea?.x || 0) + WINDOW_MARGIN;
  const maxX = Math.max(minX, Number(workArea?.x || 0) + Number(workArea?.width || 0) - width - WINDOW_MARGIN);
  const x = Math.max(minX, Math.min(preferredX, maxX));

  const aboveY = Math.round(Number(trayBounds?.y || 0) - height - POPUP_GAP);
  const belowY = Math.round(Number(trayBounds?.y || 0) + Number(trayBounds?.height || 0) + POPUP_GAP);
  const workTop = Number(workArea?.y || 0);
  const workBottom = workTop + Number(workArea?.height || 0);
  const placement = aboveY >= workTop ? "above" : "below";
  const unclampedY = placement === "above" ? aboveY : belowY;
  const maxY = Math.max(workTop + WINDOW_MARGIN, workBottom - height - WINDOW_MARGIN);
  const y = Math.max(workTop + WINDOW_MARGIN, Math.min(unclampedY, maxY));

  const requestedPointerOffset = Math.round(trayCenterX - x);
  const pointerOffset = Math.max(POINTER_EDGE_MARGIN, Math.min(width - POINTER_EDGE_MARGIN, requestedPointerOffset));
  const pointerVisible = width >= POINTER_EDGE_MARGIN * 2 && y === unclampedY;

  return { x, y, placement, pointerOffset, pointerVisible };
}

module.exports = {
  POPUP_GAP,
  WINDOW_MARGIN,
  POINTER_EDGE_MARGIN,
  calculatePopupPlacement,
};
