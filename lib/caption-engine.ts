import {
  CaptionCue,
  CaptionStyleConfig,
  EDLScene,
  EditDecisionList,
  OutputAspectRatio,
  OutputResolution,
  TitleOverlayConfig,
} from './types';

export interface OverlayStripAsset {
  filename: string;
  pngBytes: Uint8Array;
  x: number;
  y: number;
  localStart: number;
  localEnd: number;
}

export function getTargetDimensions(
  aspectRatio: OutputAspectRatio,
  resolution: OutputResolution
): {width: number; height: number} {
  const shortSide = resolution === '720p' ? 720 : 1080;
  const longSide = resolution === '720p' ? 1280 : 1920;

  if (aspectRatio === '1:1') {
    return {width: shortSide, height: shortSide};
  }
  if (aspectRatio === '16:9') {
    return {width: longSide, height: shortSide};
  }
  return {width: shortSide, height: longSide};
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode overlay PNG'))),
      'image/png'
    );
  });
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

export function computeCaptionSafeY(
  videoHeight: number,
  stripHeight: number,
  position: CaptionStyleConfig['position'],
  aspectRatio: OutputAspectRatio
): number {
  if (position === 'middle_center') {
    return Math.round((videoHeight - stripHeight) * 0.5);
  }
  if (position === 'upper_third') {
    return Math.round(videoHeight * 0.2);
  }
  // bottom_safe: Clears Shorts/Reels/TikTok bottom description & audio bar (bottom 22% kept clear)
  const bottomAnchor = aspectRatio === '9:16' ? 0.74 : 0.82;
  return Math.max(
    40,
    Math.round(videoHeight * bottomAnchor - stripHeight / 2)
  );
}

export function renderCaptionCueToCanvas(params: {
  cue: CaptionCue;
  activeWordIndex: number;
  style: CaptionStyleConfig;
  videoWidth: number;
  videoHeight: number;
  scaleFactor: number;
}): {canvas: HTMLCanvasElement; stripWidth: number; stripHeight: number} {
  const {cue, activeWordIndex, style, videoWidth, scaleFactor} = params;

  // Keep right/left 9% safe margins so Shorts/Reels right-hand action icons never cover text
  const stripWidth = Math.max(240, Math.floor((videoWidth * 0.84) / 2) * 2);
  const fontSize = Math.max(22, Math.round(style.fontSize * scaleFactor));
  const lineHeight = Math.round(fontSize * 1.34);
  const padX = Math.round(fontSize * 0.55);
  const padY = Math.round(fontSize * 0.42);

  const fontStack = `${style.fontFamily}, "Plus Jakarta Sans", "Noto Sans Bengali", sans-serif`;
  const fontSpec = `700 ${fontSize}px ${fontStack}`;

  // Measure words & wrap lines
  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = 16;
  measureCanvas.height = 16;
  const mCtx = measureCanvas.getContext('2d')!;
  mCtx.font = fontSpec;

  const spaceW = mCtx.measureText(' ').width;
  const maxTextW = stripWidth - padX * 2 - 24;

  interface PositionedWord {
    word: string;
    idx: number;
    width: number;
    isHighlighted: boolean;
  }

  const lines: PositionedWord[][] = [];
  let currentLine: PositionedWord[] = [];
  let currentLineWidth = 0;

  cue.words.forEach((cw, idx) => {
    const wWidth = mCtx.measureText(cw.word).width;
    const isActive = idx === activeWordIndex;
    const isHighlighted = isActive || cw.highlight;

    if (currentLine.length > 0 && currentLineWidth + spaceW + wWidth > maxTextW) {
      lines.push(currentLine);
      currentLine = [{word: cw.word, idx, width: wWidth, isHighlighted}];
      currentLineWidth = wWidth;
    } else {
      if (currentLine.length > 0) currentLineWidth += spaceW;
      currentLine.push({word: cw.word, idx, width: wWidth, isHighlighted});
      currentLineWidth += wWidth;
    }
  });
  if (currentLine.length > 0) lines.push(currentLine);

  const totalTextHeight = lines.length * lineHeight;
  const stripHeight = Math.max(
    80,
    Math.ceil((totalTextHeight + padY * 2 + 28) / 2) * 2
  );

  const canvas = document.createElement('canvas');
  canvas.width = stripWidth;
  canvas.height = stripHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, stripWidth, stripHeight);
  ctx.font = fontSpec;
  ctx.textBaseline = 'middle';

  // Compute max rendered line width for tight background box
  const lineWidths = lines.map(
    (ln) =>
      ln.reduce((acc, item) => acc + item.width, 0) +
      Math.max(0, ln.length - 1) * spaceW
  );
  const widestLine = Math.max(...lineWidths, 60);

  if (style.backgroundOpacity > 0.02) {
    const boxW = Math.min(stripWidth - 8, widestLine + padX * 2);
    const boxH = totalTextHeight + padY * 1.5;
    const boxX = (stripWidth - boxW) / 2;
    const boxY = (stripHeight - boxH) / 2;

    ctx.save();
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    drawRoundedRect(ctx, boxX, boxY, boxW, boxH, Math.round(fontSize * 0.34));
    ctx.fill();
    ctx.restore();
  }

  const startY = (stripHeight - totalTextHeight) / 2 + lineHeight / 2;

  lines.forEach((line, lineIdx) => {
    const lineW = lineWidths[lineIdx];
    let cursorX = (stripWidth - lineW) / 2;
    const y = startY + lineIdx * lineHeight;

    line.forEach((item) => {
      const isSpokenNow = item.idx === activeWordIndex;

      // Active spoken word subtle highlight badge on bold/kinetic styles
      if (
        isSpokenNow &&
        (style.stylePreset === 'hormozi_bold' || style.stylePreset === 'neon_gaming')
      ) {
        ctx.save();
        ctx.fillStyle = hexToRgba(style.highlightColor, 0.22);
        drawRoundedRect(
          ctx,
          cursorX - 6,
          y - lineHeight * 0.44,
          item.width + 12,
          lineHeight * 0.88,
          Math.round(fontSize * 0.22)
        );
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      if (style.shadowOpacity > 0.02) {
        ctx.shadowColor = `rgba(0, 0, 0, ${style.shadowOpacity})`;
        ctx.shadowBlur = Math.round(8 * scaleFactor);
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = Math.round(3 * scaleFactor);
      }

      if (style.strokeWidth > 0) {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(1.5, style.strokeWidth * scaleFactor * 1.4);
        ctx.strokeStyle = style.strokeColor;
        ctx.strokeText(item.word, cursorX, y);
      }

      ctx.shadowColor = 'transparent';
      ctx.fillStyle = isSpokenNow
        ? style.highlightColor
        : item.isHighlighted
          ? style.highlightColor
          : style.primaryColor;
      ctx.fillText(item.word, cursorX, y);
      ctx.restore();

      cursorX += item.width + spaceW;
    });
  });

  return {canvas, stripWidth, stripHeight};
}

export async function renderTitleOverlayStrip(params: {
  title: TitleOverlayConfig;
  videoWidth: number;
  videoHeight: number;
  scaleFactor: number;
  fontFamily: string;
}): Promise<{pngBytes: Uint8Array; x: number; y: number} | null> {
  const {title, videoWidth, videoHeight, scaleFactor, fontFamily} = params;
  if (!title.enabled || !title.text.trim()) return null;

  const stripW = Math.floor((videoWidth * 0.84) / 2) * 2;
  const fontSize = Math.max(24, Math.round(44 * scaleFactor));
  const subSize = Math.max(16, Math.round(26 * scaleFactor));
  const stripH = Math.ceil((fontSize * 2.8 + (title.subtext ? subSize * 1.6 : 0)) / 2) * 2;

  const canvas = document.createElement('canvas');
  canvas.width = stripW;
  canvas.height = stripH;
  const ctx = canvas.getContext('2d')!;

  const fontStack = `${fontFamily}, "Plus Jakarta Sans", "Noto Sans Bengali", sans-serif`;

  ctx.save();
  ctx.fillStyle = 'rgba(6, 11, 22, 0.84)';
  drawRoundedRect(ctx, 8, 8, stripW - 16, stripH - 16, Math.round(18 * scaleFactor));
  ctx.fill();
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.65)';
  ctx.lineWidth = Math.max(1.5, 2 * scaleFactor);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `700 ${fontSize}px ${fontStack}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Fit headline inside strip width
  let displayHeadline = title.text.trim();
  while (
    displayHeadline.length > 8 &&
    ctx.measureText(displayHeadline).width > stripW - 56
  ) {
    displayHeadline = displayHeadline.slice(0, -4).trim() + '…';
  }

  const centerY = title.subtext ? stripH * 0.4 : stripH * 0.5;
  ctx.fillText(displayHeadline, stripW / 2, centerY);

  if (title.subtext.trim()) {
    ctx.font = `500 ${subSize}px ${fontStack}`;
    ctx.fillStyle = '#93C5FD';
    ctx.fillText(title.subtext.trim().slice(0, 42), stripW / 2, stripH * 0.72);
  }
  ctx.restore();

  const pngBytes = await canvasToPngBytes(canvas);
  return {
    pngBytes,
    x: Math.round((videoWidth - stripW) / 2),
    y: Math.round(videoHeight * 0.12),
  };
}

export async function prepareWatermarkPng(params: {
  watermarkBlob: Blob;
  edl: EditDecisionList;
  videoWidth: number;
  videoHeight: number;
}): Promise<{pngBytes: Uint8Array; x: number; y: number} | null> {
  const {watermarkBlob, edl, videoWidth} = params;
  if (!edl.watermark.enabled) return null;

  const url = URL.createObjectURL(watermarkBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode watermark image'));
      el.src = url;
    });

    const targetW = Math.max(
      48,
      Math.floor((videoWidth * Math.max(0.06, Math.min(0.28, edl.watermark.scale))) / 2) * 2
    );
    const ratio = (img.naturalHeight || 100) / Math.max(1, img.naturalWidth || 100);
    const targetH = Math.max(24, Math.floor((targetW * ratio) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d')!;
    ctx.globalAlpha = Math.max(0.1, Math.min(1, edl.watermark.opacity));
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const pngBytes = await canvasToPngBytes(canvas);
    const margin = Math.round(videoWidth * 0.045);
    const x =
      edl.watermark.position === 'top_left'
        ? margin
        : Math.max(margin, videoWidth - targetW - margin);
    const y = Math.round(videoWidth * 0.065);

    return {pngBytes, x, y};
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function buildSceneOverlayStrips(params: {
  scene: EDLScene;
  sceneIndex: number;
  edl: EditDecisionList;
  videoWidth: number;
  videoHeight: number;
}): Promise<OverlayStripAsset[]> {
  const {scene, sceneIndex, edl, videoWidth, videoHeight} = params;
  const overlays: OverlayStripAsset[] = [];
  const scaleFactor = videoWidth / 1080;

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  // 1. Animated Title Card in opening window
  if (
    edl.titleOverlay.enabled &&
    edl.titleOverlay.text.trim() &&
    scene.startTime < edl.titleOverlay.endTime &&
    scene.endTime > edl.titleOverlay.startTime
  ) {
    const overlapStart = Math.max(scene.startTime, edl.titleOverlay.startTime);
    const overlapEnd = Math.min(scene.endTime, edl.titleOverlay.endTime);
    if (overlapEnd - overlapStart >= 0.15) {
      const titleStrip = await renderTitleOverlayStrip({
        title: edl.titleOverlay,
        videoWidth,
        videoHeight,
        scaleFactor,
        fontFamily: edl.captionStyle.fontFamily,
      });
      if (titleStrip) {
        overlays.push({
          filename: `title_${sceneIndex}.png`,
          pngBytes: titleStrip.pngBytes,
          x: titleStrip.x,
          y: titleStrip.y,
          localStart: Number((overlapStart - scene.startTime).toFixed(3)),
          localEnd: Number((overlapEnd - scene.startTime).toFixed(3)),
        });
      }
    }
  }

  // 2. Dynamic Captions with active word highlighting
  if (!edl.captionStyle.enabled) {
    return overlays;
  }

  const overlappingCues = edl.captions.filter(
    (c) => c.endTime > scene.startTime + 0.04 && c.startTime < scene.endTime - 0.04
  );

  let stripCounter = 0;
  for (const cue of overlappingCues) {
    const wordCount = cue.words.length;
    if (wordCount === 0) continue;

    for (let wIdx = 0; wIdx < wordCount; wIdx++) {
      const wStart = cue.words[wIdx].startTime;
      const wEnd =
        wIdx < wordCount - 1 ? cue.words[wIdx + 1].startTime : cue.endTime;

      const ovStart = Math.max(scene.startTime, wStart);
      const ovEnd = Math.min(scene.endTime, wEnd);
      if (ovEnd - ovStart < 0.05) continue;

      const {canvas, stripWidth, stripHeight} = renderCaptionCueToCanvas({
        cue,
        activeWordIndex: wIdx,
        style: edl.captionStyle,
        videoWidth,
        videoHeight,
        scaleFactor,
      });

      const pngBytes = await canvasToPngBytes(canvas);
      const x = Math.round((videoWidth - stripWidth) / 2);
      const y = computeCaptionSafeY(
        videoHeight,
        stripHeight,
        edl.captionStyle.position,
        edl.aspectRatio
      );

      overlays.push({
        filename: `cap_${sceneIndex}_${stripCounter++}.png`,
        pngBytes,
        x,
        y,
        localStart: Number((ovStart - scene.startTime).toFixed(3)),
        localEnd: Number((ovEnd - scene.startTime).toFixed(3)),
      });
    }
  }

  return overlays;
}
