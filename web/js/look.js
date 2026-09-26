/**
 * look.js - ミアキスの着せ替え・描画と CSS サニタイズ
 */
import { escapeHtml } from './logic.js';
import { renderAccessory } from './miacis-accessories.js';

/**
 * 許可された CSS（linear-gradient または 単色カラー）のみを通す
 * 危険な文字列 (url, javascript, expression, <, >, etc) は一切通さない
 *
 * @param {string} css
 * @returns {string} 安全な CSS、または無効時は空文字
 */
export function sanitizeCss(css) {
  if (typeof css !== 'string') return '';
  const trimmed = css.trim();

  // 単色カラー: #fff または #ffffff (3桁・6桁・8桁のhex)
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
    return trimmed;
  }

  // linear-gradient:
  // 例: linear-gradient(135deg, #1e6b3c, #f2c200)
  // 例: linear-gradient(to right, #00c6ff, #0072ff)
  const isGradient = /^linear-gradient\(\s*(-?\d+deg|to\s+[a-z\s]+)\s*(,\s*#[0-9a-fA-F]{3,8}\s*(\d+%)?)+\s*\)$/i.test(trimmed);
  if (isGradient) {
    return trimmed;
  }

  return '';
}

/**
 * 許可された HEX カラーコードのみを通す
 *
 * @param {string} color
 * @returns {string}
 */
export function sanitizeColor(color) {
  if (typeof color !== 'string') return '';
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/**
 * ミアキスの着せ替えパーツ配置定数
 * 未登録パーツの絵文字用配置。既存24種類は miacis-accessories.js の専用描画を使用
 */
export const MIACIS_OFFSETS = {
  hat: {
    topPercent: 8,
    leftPercent: 33,
    sizeRatio: 0.32,
    rotateDeg: -5
  },
  face: {
    topPercent: 29,
    leftPercent: 33,
    sizeRatio: 0.24,
    rotateDeg: 0
  },
  neck: {
    topPercent: 44,
    leftPercent: 36,
    sizeRatio: 0.24,
    rotateDeg: 0
  }
};

/**
 * ミアキスの着せ替え姿を安全な HTML として描画する
 * 順序: 背景（台座グラデーション）→ オーラ（光）→ ミアキスくん → 帽子 → 顔 → 首まわり
 *
 * @param {object} look - 装備品情報 ({ hat, face, neck, background, aura, title })
 * @param {number} [size=120] - 描画サイズ (px)
 * @returns {string} HTML 文字列
 */
export function renderMiacis(look, size = 120) {
  const safeSize = Math.max(24, Math.min(600, parseInt(size, 10) || 120));
  const l = look || {};

  // 1. 背景 (background)
  const bgCss = sanitizeCss(l.background?.display?.css) || 'linear-gradient(145deg, #eee3ff, #c9b4e4)';

  // 2. オーラ (aura)
  let auraStyle = '';
  let auraClass = 'miacis-aura';
  if (l.aura?.display) {
    const isRainbow = Boolean(l.aura.display.rainbow);
    if (isRainbow) {
      auraClass += ' miacis-aura-rainbow';
      auraStyle = 'filter: drop-shadow(0 0 16px rgba(255, 105, 180, 0.8));';
    } else {
      const color = sanitizeColor(l.aura.display.color) || '#ffffff';
      const glow = Math.min(40, Math.max(4, parseInt(l.aura.display.glow, 10) || 16));
      auraStyle = `filter: drop-shadow(0 0 ${glow * (safeSize / 120)}px ${color});`;
    }
  }

  // 3. 帽子 (hat)
  let hatHtml = '';
  if (l.hat?.display?.emoji) {
    const emoji = escapeHtml(l.hat.display.emoji);
    const cfg = MIACIS_OFFSETS.hat;
    const fontSize = Math.round(safeSize * cfg.sizeRatio);
    hatHtml = `
      <div class="miacis-part miacis-part-hat"
           style="position:absolute; top:${cfg.topPercent}%; left:${cfg.leftPercent}%; font-size:${fontSize}px; transform:rotate(${cfg.rotateDeg}deg); z-index:4; pointer-events:none; line-height:1;">
        ${emoji}
      </div>`;
  }

  // 4. 顔 (face)
  let faceHtml = '';
  if (l.face?.display?.emoji) {
    const emoji = escapeHtml(l.face.display.emoji);
    const cfg = MIACIS_OFFSETS.face;
    const fontSize = Math.round(safeSize * cfg.sizeRatio);
    faceHtml = `
      <div class="miacis-part miacis-part-face"
           style="position:absolute; top:${cfg.topPercent}%; left:${cfg.leftPercent}%; font-size:${fontSize}px; z-index:5; pointer-events:none; line-height:1;">
        ${emoji}
      </div>`;
  }

  // 5. 首まわり (neck)
  let neckHtml = '';
  if (l.neck?.display?.emoji) {
    const emoji = escapeHtml(l.neck.display.emoji);
    const cfg = MIACIS_OFFSETS.neck;
    const fontSize = Math.round(safeSize * cfg.sizeRatio);
    neckHtml = `
      <div class="miacis-part miacis-part-neck"
           style="position:absolute; top:${cfg.topPercent}%; left:${cfg.leftPercent}%; font-size:${fontSize}px; z-index:6; pointer-events:none; line-height:1;">
        ${emoji}
      </div>`;
  }

  return `
    <div class="miacis-avatar-box" style="position:relative; width:${safeSize}px; height:${safeSize}px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;">
      <!-- 背景台座 -->
      <div class="miacis-pedestal"
           style="position:absolute; inset:0; border-radius:50%; background:${bgCss}; z-index:1; overflow:hidden;">
      </div>
      <!-- オーラ & ミアキスくん画像 -->
      <div class="${auraClass}"
           style="position:absolute; inset:6%; display:flex; align-items:center; justify-content:center; z-index:2; ${auraStyle}">
        <img src="assets/miacis-avatar.png"
             alt="ミアキス"
             style="width:90%; height:90%; object-fit:contain; z-index:3; pointer-events:none;">
      </div>
      <!-- 着せ替えパーツ -->
      ${renderAccessory(l.hat, 'hat') || hatHtml}
      ${renderAccessory(l.face, 'face') || faceHtml}
      ${renderAccessory(l.neck, 'neck') || neckHtml}
    </div>
  `.trim();
}
