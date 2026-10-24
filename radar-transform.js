'use strict';

(function initRadarTransform(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TitanRadarTransform = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRadarTransform() {
  const VIRTUAL_SIZE = 614;

  // Keep this table aligned with the downloaded reference viewer. The PNG files
  // in public/maps are byte-identical to that viewer, so their coordinate and
  // image rotations must be treated as one contract.
  const MAP_TRANSFORMS = Object.freeze({
    Ascent: Object.freeze({ xMin: -6110, xMax: 8185, yMin: -11660, yMax: 2635, rot: 0 }),
    Duality: Object.freeze({ xMin: -560, xMax: 16240, yMin: -9680, yMax: 7120, rot: 90 }),
    Port: Object.freeze({ xMin: -9605, xMax: 4185, yMin: -6015, yMax: 7245, rot: 180 }),
    Triad: Object.freeze({ xMin: -4735, xMax: 8525, yMin: -14530, yMax: -1320, rot: 0 }),
    Bonsai: Object.freeze({ xMin: -3850, xMax: 8875, yMin: -10770, yMax: 1955, rot: 0 }),
    Foxtrot: Object.freeze({ xMin: -2370, xMax: 11915, yMin: -6670, yMax: 7620, rot: 90 }),
    Canyon: Object.freeze({ xMin: 2075, xMax: 14800, yMin: -7130, yMax: 5620, rot: 90 }),
    Rook: Object.freeze({ xMin: -6900, xMax: 7100, yMin: -6900, yMax: 7100, rot: 0 }),
    Pitt: Object.freeze({ xMin: -1010, xMax: 11715, yMin: -6160, yMax: 6565, rot: 90 }),
    Jam: Object.freeze({ xMin: -1050, xMax: 12545, yMin: -6210, yMax: 7385, rot: 90 }),
    Juliett: Object.freeze({ xMin: -6160, xMax: 6565, yMin: -6340, yMax: 6390, rot: 90 }),
    Infinity: Object.freeze({ xMin: -6173, xMax: 6173, yMin: -6173, yMax: 6173, rot: 0, imageRot: 90 }),
    Abyss: Object.freeze({ xMin: -6173, xMax: 6173, yMin: -6173, yMax: 6173, rot: 0, imageRot: 90 }),
    YouSuiDiKu: Object.freeze({ xMin: -6173, xMax: 6173, yMin: -6173, yMax: 6173, rot: 0, imageRot: 90 }),
    // Summit has no exact calibration; this rectangle is an ESTIMATE (2026-10-22).
    // Centre = native overlay-minimap table (kMapRadarTable) 6355/6230; the 11
    // calibrated maps put that table's centre within ~100uu (max ~580) of the real
    // rectangle centre. Span = 48 uu/px * 230 px * 1.278, where 1.278 is the mean
    // of (rect span)/(table scale * base size) over those 11 maps; it spreads
    // 1.15-1.48, so the span is good to about +-13% (up to ~10 m at the map edge).
    // rot=270 is the reference viewer's own value for Summit. `approximate` makes
    // the UI say so and keeps map inference from ever picking this rectangle.
    // Replace with measured bounds when a real Summit capture is available.
    Summit: Object.freeze({ xMin: -700, xMax: 13410, yMin: -825, yMax: 13285, rot: 270, approximate: true }),
  });

  function degToRad(degrees) {
    return Number(degrees) * Math.PI / 180;
  }

  // Infinity and YouSuiDiKu share Abyss's rectangle. They are one map.
  const MAP_ALIASES = Object.freeze({ Infinity: 'Abyss', YouSuiDiKu: 'Abyss' });

  // Phone frames carry map id 0 until the client names the level. Several
  // rectangles overlap near the origin, so a tight cluster is left unresolved.
  // A group that fills most of exactly one rectangle selects that map.
  function inferMapFromPositions(points) {
    const samples = [];
    if (Array.isArray(points)) {
      for (const point of points) {
        const x = Number(point && (point.x ?? point.worldX));
        const y = Number(point && (point.y ?? point.worldY));
        if (Number.isFinite(x) && Number.isFinite(y)) samples.push([x, y]);
      }
    }
    if (samples.length < 2) return null;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const [x, y] of samples) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    let best = null;
    let bestFit = 0;
    let tied = false;
    const seen = new Set();
    for (const [code, t] of Object.entries(MAP_TRANSFORMS)) {
      if (t.approximate) continue;
      const name = MAP_ALIASES[code] || code;
      if (seen.has(name)) continue;
      seen.add(name);
      if (minX < t.xMin || maxX > t.xMax || minY < t.yMin || maxY > t.yMax) continue;
      const fit = (spanX / (t.xMax - t.xMin)) * (spanY / (t.yMax - t.yMin));
      if (fit < 0.25) continue;
      if (Math.abs(fit - bestFit) <= 1e-9) { tied = true; continue; }
      if (fit < bestFit) continue;
      best = name;
      bestFit = fit;
      tied = false;
    }
    return best && !tied
      ? { mapCode: best, source: 'position_bounds', samples: samples.length }
      : null;
  }

  function worldToMinimap(worldX, worldY, mapCode) {
    const t = MAP_TRANSFORMS[mapCode];
    if (!t || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const nx = (worldX - t.xMin) / (t.xMax - t.xMin);
    const ny = (worldY - t.yMin) / (t.yMax - t.yMin);
    switch (t.rot || 0) {
      case 90: return { x: ny * VIRTUAL_SIZE, y: (1 - nx) * VIRTUAL_SIZE };
      case 180: return { x: (1 - nx) * VIRTUAL_SIZE, y: (1 - ny) * VIRTUAL_SIZE };
      case 270: return { x: (1 - ny) * VIRTUAL_SIZE, y: nx * VIRTUAL_SIZE };
      default: return { x: nx * VIRTUAL_SIZE, y: ny * VIRTUAL_SIZE };
    }
  }

  // Canvas angles grow clockwise because screen Y grows downward. This is the
  // heading convention used by the reference viewer's FOV rendering.
  function mapHeadingDegrees(yaw, mapCode) {
    const mapRotation = MAP_TRANSFORMS[mapCode]?.rot || 0;
    return -(Number.isFinite(yaw) ? yaw : 0) - mapRotation;
  }

  function selfFollowRotationDegrees(yaw, mapCode) {
    return -90 - mapHeadingDegrees(yaw, mapCode);
  }

  function transformPointForSelfFollow(point, selfPoint, center, yaw, mapCode) {
    const angle = degToRad(selfFollowRotationDegrees(yaw, mapCode));
    const dx = point.x - selfPoint.x;
    const dy = point.y - selfPoint.y;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  }

  return Object.freeze({
    VIRTUAL_SIZE,
    MAP_TRANSFORMS,
    degToRad,
    inferMapFromPositions,
    worldToMinimap,
    mapHeadingDegrees,
    selfFollowRotationDegrees,
    transformPointForSelfFollow,
  });
}));
