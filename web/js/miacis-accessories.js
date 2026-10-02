/**
 * miacis-accessories.js - 相棒（ミアキスくん）に重ねる固定のベクター素材
 *
 * すべて 100×100 の座標で描く。相棒の画像は台座の inset:6% に 90% で置かれるので、
 * 画像の 1254px は 79.2 単位、左上は (10.4, 10.4) にあたる。
 * 実測した目印（100×100）: 左目 (43.4, 37.0) / 右目 (49.9, 37.3) / 鼻 (45.5, 41.3)
 * 頭のてっぺん（黄色）y≈19.8、紺のふち y≈15、耳の先 (39, 22)・(61, 22)、あご y≈43.5、
 * 頭の幅（黄色）x 40〜63.5、両手 (38, 40)・(60, 40)。目の並びは右下がり約 2°。
 *
 * 絵柄は相棒に合わせる: 紺のふち取り（INK）＋平塗り＋白いハイライト1つ。
 * レア度で手間を変える: N 素直な形 / R 柄か小物を1つ / SR 金属の光沢・宝石 / UR きらめきの星。
 * 中身は固定の文字列だけ（利用者の入力を一切含まない）。
 */
const INK = '#372a98';
const n = (v) => Math.round(v * 100) / 100;

/** 白いハイライト（ふち取りなし） */
const hl = (d, w = 1.4) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" opacity=".9"/>`;

/** 4つ角のきらめき（UR・SR の飾り） */
function sparkle(x, y, r, fill = '#fffbe6') {
  const k = r * 0.22;
  return `<path d="M${n(x)} ${n(y - r)}Q${n(x + k)} ${n(y - k)} ${n(x + r)} ${n(y)}Q${n(x + k)} ${n(y + k)} ${n(x)} ${n(y + r)}Q${n(x - k)} ${n(y + k)} ${n(x - r)} ${n(y)}Q${n(x - k)} ${n(y - k)} ${n(x)} ${n(y - r)}Z" fill="${fill}" stroke="${INK}" stroke-width="${n(Math.max(0.6, r * 0.26))}" stroke-linejoin="round"/>`;
}

/** 5つ角の星の path */
function star(cx, cy, ro, ri, rot = -90) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = ((rot + i * 36) * Math.PI) / 180;
    pts.push(`${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}

/** 二次ベジェの上の点 */
function qpt(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

/** 花びら1枚（(x, y) が中心、rot 度回す） */
const petal = (x, y, rot, fill) => `<path transform="rotate(${rot} ${x} ${y})" d="M${x} ${n(y + 3)}C${n(x - 3)} ${n(y + 1)} ${n(x - 2.4)} ${n(y - 2.6)} ${n(x - 0.8)} ${n(y - 3)}L${x} ${n(y - 2)}L${n(x + 0.8)} ${n(y - 3)}C${n(x + 2.4)} ${n(y - 2.6)} ${n(x + 3)} ${n(y + 1)} ${x} ${n(y + 3)}z" fill="${fill}"/>`;

/** 桜の花（5枚） */
const blossom = (x, y, fill) => [0, 72, 144, 216, 288]
  .map((r) => `<path transform="rotate(${r} ${x} ${y})" d="M${x} ${y}C${n(x - 3.2)} ${n(y - 2)} ${n(x - 2.4)} ${n(y - 5.6)} ${n(x - 0.8)} ${n(y - 5.8)}L${x} ${n(y - 5)}L${n(x + 0.8)} ${n(y - 5.8)}C${n(x + 2.4)} ${n(y - 5.6)} ${n(x + 3.2)} ${n(y - 2)} ${x} ${y}z" fill="${fill}"/>`)
  .join('') + `<circle cx="${x}" cy="${y}" r="1.3" fill="#e8577f"/>`;

// 帽子は頭にかぶさるよう少し下げて大きくし、頭の傾き（約 -3°）に合わせる
const hat = (body) => `<g transform="translate(51 25.4) rotate(-3) scale(1.08) translate(-51 -24)">${body}</g>`;
// 首の物は首元で目立つよう 1.22 倍にする（あごの下 (50.5, 44) を中心に）
const neck = (body) => `<g transform="translate(50.5 44) scale(1.22) translate(-50.5 -44)" stroke-width="1.9">${body}</g>`;
const face = (body) => `<g transform="rotate(2 46.6 37.1)">${body}</g>`;

// ---- 首まわりの部品 ----
function beads() {
  let s = '';
  for (let i = 0; i <= 8; i++) {
    const [x, y] = qpt([41.5, 43.8], [50.5, 54], [59.5, 43.2], i / 8);
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="${i === 4 ? 2.5 : 1.85}" fill="${i % 2 ? '#d7a266' : '#a8703f'}" stroke-width="1.2"/>`;
  }
  const [x, y] = qpt([41.5, 43.8], [50.5, 54], [59.5, 43.2], 0.5);
  return s + hl(`M${n(x - 1.3)} ${n(y - 0.6)}q.4-1.1 1.4-1.3`, 0.9);
}

function medal({ ribbon, stripe, metal, rim, shade, emboss, r, shine }) {
  const cx = 50.3;
  const cy = 54.6;
  return `<path d="M42.2 43.2h4.4l5 8.2-3 1.2z" fill="${ribbon}" stroke-width="1.8"/>`
    + `<path d="M58.6 42.6h-4.4l-5.2 8.4 3 1z" fill="${ribbon}" stroke-width="1.8"/>`
    + `<path d="M44.4 43.6l4.8 7.4M56.4 43l-5 7.6" stroke="${stripe}" stroke-width="1.1" fill="none"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${metal}" stroke-width="2.2"/>`
    + (shade ? `<path d="M${n(cx + r * 0.95)} ${n(cy - r * 0.2)}A${r} ${r} 0 0 1 ${n(cx - r * 0.2)} ${n(cy + r * 0.95)}A${n(r * 0.85)} ${n(r * 0.85)} 0 0 0 ${n(cx + r * 0.95)} ${n(cy - r * 0.2)}z" fill="${shade}" stroke="none"/>` : '')
    + `<circle cx="${cx}" cy="${cy}" r="${n(r - 1.9)}" fill="none" stroke="${rim}" stroke-width="1"/>`
    + `<path d="${star(cx, cy + 0.2, r * 0.48, r * 0.21)}" fill="${emboss}" stroke="none"/>`
    + hl(`M${n(cx - r * 0.62)} ${n(cy - r * 0.2)}a${n(r * 0.66)} ${n(r * 0.66)} 0 0 1 ${n(r * 0.5)} -${n(r * 0.5)}`, 1.2)
    + (shine ? sparkle(cx + r * 0.78, cy - r * 0.78, 2) : '');
}

function starNecklace() {
  const P = [[41.4, 43.6], [50.4, 54.4], [59.6, 43]];
  let s = '<path d="M41.4 43.6Q50.4 54.4 59.6 43" fill="none" stroke-width="2"/>'
    + '<path d="M41.4 43.6Q50.4 54.4 59.6 43" fill="none" stroke="#ffe39a" stroke-width=".9"/>';
  for (const t of [0.2, 0.8]) {
    const [x, y] = qpt(...P, t);
    s += `<path d="${star(x, y, 2.5, 1.35)}" fill="#ffe27a" stroke-width=".9"/>`;
  }
  for (const t of [0.36, 0.64]) {
    const [x, y] = qpt(...P, t);
    s += `<circle cx="${n(x)}" cy="${n(y)}" r=".95" fill="#fff6c8" stroke-width=".7"/>`;
  }
  return s
    + `<path d="${star(50.4, 55, 6.6, 3.7)}" fill="#ffd84a" stroke-width="1.6"/>`
    + `<path d="${star(51.2, 55.8, 3.2, 1.8)}" fill="#f0b52e" stroke="none" opacity=".55"/>`
    + hl('M47.6 53.2l1.4-2.2', 1)
    + sparkle(41.6, 56, 2.4) + sparkle(60, 51.4, 2.2) + sparkle(57.4, 61.4, 1.7);
}

const parts = {
  // ===== 帽子（頭のてっぺん y≈20、つばは耳の高さ y≈24） =====
  hat_cap: hat(
    '<path d="M37 24.2C36.4 10.6 65.6 10.2 65 24.2z" fill="#4fb3ea"/>'
    + '<path d="M41 23.6Q29 22.4 25.6 26.6Q33 29.2 45 25.6z" fill="#2a78c2"/>'
    + '<path d="M51 12.4Q46.8 17 46.4 24M51 12.4Q55.6 17 56.4 24.2" fill="none" stroke-width="1"/>'
    + '<circle cx="51" cy="11.8" r="1.7" fill="#2a78c2" stroke-width="1.4"/>'
    + hl('M40.6 20.6Q42 17.4 45.6 16.2', 1.6)
  ),
  hat_straw: hat(
    '<ellipse cx="51" cy="24.2" rx="19.5" ry="4.6" fill="#efc15e"/>'
    + '<path d="M40 24C39.6 11.4 62.4 11.4 62 24Q51 26.4 40 24z" fill="#f8db86"/>'
    + '<path d="M40.1 20.4Q51 23 61.9 20.4L62 23.8Q51 26.3 40 23.8z" fill="#e8636b" stroke-width="1.8"/>'
    + '<path d="M34.6 26.4l1.4 1.3M40 27.9l.9 1.4M46 28.7l.4 1.5M56 28.7l-.4 1.5M62 27.9l-.9 1.4M67.4 26.4l-1.4 1.3M45 15l-.6 3.6M51 13.8v3.8M57 15l.6 3.6" fill="none" stroke="#c4913a" stroke-width=".9"/>'
    + hl('M43.6 19.4Q44.8 17.4 47.8 16.8', 1.4)
  ),
  hat_silk: hat(
    '<path d="M32.6 24.6Q51 18.8 69.4 24.6Q71 27.8 66.6 27.4Q51 24 35.4 27.4Q31 27.8 32.6 24.6z" fill="#34304e"/>'
    + '<path d="M40 23.4L39 6.8Q51 4.2 63 6.8L62 23.4Q51 25.4 40 23.4z" fill="#433d63"/>'
    + '<path d="M39.6 17.6Q51 20 62.4 17.6L62.1 22.6Q51 25 39.9 22.6z" fill="#b99be8" stroke-width="1.8"/>'
    + hl('M43.2 8.8L43.8 15.6', 1.6)
  ),
  hat_grad: hat(
    '<path d="M40.2 23.4L40.6 15.6Q51 19 61.4 15.6L61.8 23.4Q51 26.8 40.2 23.4z" fill="#463c63"/>'
    + '<path d="M40.4 21.6Q51 25 61.6 21.6" fill="none" stroke="#f2c14e" stroke-width="1"/>'
    + '<path d="M51 6.6L72 13.4L51 20.2L30 13.4z" fill="#2e2a48"/>'
    + hl('M51 8.6L65.6 13.3', 1.1)
    + '<path d="M51 13.4L68.4 14.6V25" fill="none" stroke-width="2.8"/>'
    + '<path d="M51 13.4L68.4 14.6V25" fill="none" stroke="#f6c64f" stroke-width="1.3"/>'
    + '<path d="M66.6 24.4h3.6l1 6.6h-5.6z" fill="#f6c64f" stroke-width="1.6"/>'
    + '<path d="M67.6 27l-.2 3.6M69.2 27l.2 3.6" fill="none" stroke="#d99a22" stroke-width=".7"/>'
    + '<circle cx="51" cy="13.4" r="1.6" fill="#f6c64f" stroke-width="1.2"/>'
  ),
  hat_ribbon: '<g transform="rotate(-12 53 16)">'
    + '<path d="M51.6 18.6L46.4 28.2L49.8 27.4L51.4 30L53.4 18.8z" fill="#d95c97" stroke-width="1.8"/>'
    + '<path d="M54.4 18.6L60.4 27.2L56.8 27.2L55.6 30L52.6 19z" fill="#d95c97" stroke-width="1.8"/>'
    + '<path d="M53 16.4C45.6 7 36.2 9.8 38.2 17.4C39.4 22.6 46.4 22 53 16.4z" fill="#f07fb4"/>'
    + '<path d="M53 16.4C60.4 7 69.8 9.6 67.8 17.2C66.6 22.6 59.6 22 53 16.4z" fill="#f07fb4"/>'
    + '<g fill="#fff" stroke="none" opacity=".85"><circle cx="42.2" cy="16.6" r="1.1"/><circle cx="46.2" cy="13.6" r=".9"/><circle cx="45.8" cy="18.6" r=".8"/><circle cx="63.6" cy="16.4" r="1.1"/><circle cx="59.8" cy="13.4" r=".9"/><circle cx="60.4" cy="18.6" r=".8"/></g>'
    + '<rect x="50.2" y="13.2" width="5.6" height="6.4" rx="2.2" fill="#f69ac4" stroke-width="2"/>'
    + hl('M40.4 14.6Q41.2 11.8 44 11.6', 1.3)
    + '</g>',
  hat_rescue: hat(
    '<path d="M36 24.6C35 8.4 67 8 66 24.6z" fill="#ec4a4c"/>'
    + '<path d="M60 11.8C64.2 14.6 65.6 19.4 65.6 23.8L61.6 23.9C62 19.4 61.4 15.2 60 11.8z" fill="#c2333c" stroke="none"/>'
    + '<path d="M33 24Q51 20.8 69 24L68.6 27.8Q51 25 33.4 27.8z" fill="#f7f2e4"/>'
    + '<path d="M49.1 11.6h3.8v3h3v3.8h-3v3h-3.8v-3h-3v-3.8h3z" fill="#fff" stroke-width="1.4"/>'
    + hl('M39.4 20.6Q40.6 16.6 44.6 15.2', 1.9)
    + '<circle cx="47.4" cy="14.6" r=".9" fill="#fff" stroke="none"/>'
  ),
  hat_safari: hat(
    '<ellipse cx="51" cy="24.6" rx="19" ry="4.8" fill="#d9cc93"/>'
    + '<path d="M38.4 24.2C37.8 9.8 64.2 9.8 63.6 24.2Q51 26.8 38.4 24.2z" fill="#c2b06d"/>'
    + '<path d="M58.4 12.6C62.4 15.4 63.6 19.6 63.5 22.6L60 23.2C60.4 19.4 59.8 15.6 58.4 12.6z" fill="#a8975a" stroke="none"/>'
    + '<path d="M38.5 20.6Q51 23.6 63.5 20.6L63.6 24Q51 27 38.4 24z" fill="#6b5236" stroke-width="1.8"/>'
    + '<circle cx="51" cy="11.2" r="1.6" fill="#6b5236" stroke-width="1.3"/>'
    + '<circle cx="44" cy="23" r="2.7" fill="#f2c94c" stroke-width="1.4"/>'
    + '<path d="M44 21.2l.7 1.8-.7 1.8-.7-1.8z" fill="#c4452f" stroke="none"/>'
    + hl('M41.4 19.6Q42.6 16.8 46 15.6', 1.5)
    + '<circle cx="43" cy="22" r=".55" fill="#fff" stroke="none"/>'
  ),
  hat_crown: hat(
    '<path d="M36 25.4L33.6 9.8L42.6 16.6L51 5.6L59.4 16.6L68.4 9.8L66 25.4Q51 28 36 25.4z" fill="#ffd040"/>'
    + '<path d="M59.4 16.6L68.4 9.8L66 25.4Q63.4 25.9 61 26.2z" fill="#eaa628" stroke="none"/>'
    + '<path d="M35.5 20.6Q51 23.4 66.5 20.6L66 25.6Q51 28.2 36 25.6z" fill="#f2ae2e" stroke-width="1.8"/>'
    + '<ellipse cx="51" cy="23.6" rx="2.6" ry="2.1" fill="#e2467c" stroke-width="1.2"/>'
    + '<circle cx="42.4" cy="23" r="1.6" fill="#4fb8ef" stroke-width="1.1"/>'
    + '<circle cx="59.6" cy="23" r="1.6" fill="#4fb8ef" stroke-width="1.1"/>'
    + '<g fill="#fff4b0" stroke-width="1.3"><circle cx="33.6" cy="9.6" r="1.9"/><circle cx="51" cy="5.4" r="2.1"/><circle cx="68.4" cy="9.6" r="1.9"/></g>'
    + hl('M38.6 14.6L39.6 20', 1.6)
    + '<g fill="#fff" stroke="none"><circle cx="50.2" cy="22.9" r=".7"/><circle cx="41.9" cy="22.5" r=".45"/><circle cx="59.1" cy="22.5" r=".45"/></g>'
    + sparkle(28.6, 12.4, 3.2) + sparkle(73.4, 16.6, 2.6) + sparkle(45.4, 2.2, 2)
  ),

  // ===== 顔（両目 (43.4, 37.0)・(49.9, 37.3) に重ねる） =====
  face_glasses: face(
    '<path d="M39.2 36.6L36.4 35.4M54 36.6L56.8 35.4M46.2 36.4Q46.6 35.6 47 36.4" fill="none" stroke-width="2.6"/>'
    + '<g fill="#e6f6ff" fill-opacity=".45" stroke-width="2.8"><circle cx="42.7" cy="37.1" r="3.5"/><circle cx="50.5" cy="37.2" r="3.5"/></g>'
    + '<g fill="none" stroke="#c4673f" stroke-width="1.2"><circle cx="42.7" cy="37.1" r="3.5"/><circle cx="50.5" cy="37.2" r="3.5"/></g>'
    + hl('M40.6 36.2q.4-1.3 1.6-1.6', 0.9)
  ),
  face_sun: face(
    '<path d="M38.4 36.2L35.8 35M54.8 36.2L57.4 35" fill="none" stroke-width="2.4"/>'
    + '<path d="M38.4 34.6H46.4Q46.8 40.6 42.4 40.8Q38 40.6 38.4 34.6z" fill="#2a2350" stroke-width="2"/>'
    + '<path d="M46.8 34.7H54.8Q55.2 40.7 50.8 40.9Q46.4 40.7 46.8 34.7z" fill="#2a2350" stroke-width="2"/>'
    + '<path d="M40 36.4l2.6 2.6M48.4 36.5l2.6 2.6" fill="none" stroke="#8fd8f0" stroke-width="1.1"/>'
  ),
  face_monocle: face(
    '<path d="M54 39.6Q57.6 45 54.4 50.2" fill="none" stroke-width="2.2"/>'
    + '<path d="M54 39.6Q57.6 45 54.4 50.2" fill="none" stroke="#e8b64a" stroke-width="1" stroke-dasharray="1 .9"/>'
    + '<circle cx="50.3" cy="37.2" r="4.1" fill="#e6f6ff" fill-opacity=".45" stroke-width="3"/>'
    + '<circle cx="50.3" cy="37.2" r="4.1" fill="none" stroke="#e8b64a" stroke-width="1.4"/>'
    + hl('M47.8 36.2q.5-1.6 2-2', 0.9)
  ),
  face_disguise: face(
    '<path d="M38.6 32.6Q42.4 30 46 32.4M47.6 32.4Q51.2 30 55 32.6" fill="none" stroke-width="2.6"/>'
    + '<path d="M38.6 32.6Q42.4 30 46 32.4M47.6 32.4Q51.2 30 55 32.6" fill="none" stroke="#4a3530" stroke-width="1.4"/>'
    + '<path d="M39.2 36.6L36.6 35.6M54 36.6L56.6 35.6" fill="none" stroke-width="2.4"/>'
    + '<g fill="#ffffff" fill-opacity=".55" stroke-width="2"><circle cx="42.7" cy="37.1" r="3.4"/><circle cx="50.5" cy="37.2" r="3.4"/></g>'
    + '<path d="M46.1 36.6Q46.6 35.8 47.1 36.6" fill="none" stroke-width="2"/>'
    + '<path d="M46.4 43C43.6 41.4 40.2 42 39 45.2C41.8 44.6 44.4 45.4 46.4 44C48.4 45.4 51 44.6 53.8 45.2C52.6 42 49.2 41.4 46.4 43z" fill="#4a3530" stroke-width="1.5"/>'
    + '<ellipse cx="46.4" cy="40.8" rx="2.7" ry="2.4" fill="#f4a3a0" stroke-width="1.6"/>'
    + hl('M45.2 39.8q.4-.7 1.2-.8', 0.8)
  ),
  face_mask: face(
    '<path d="M38.4 40.4Q36.2 39.4 36.8 36.8M54.8 40.4Q57 39.2 56.4 36.6" fill="none" stroke-width="1.4"/>'
    + '<path d="M38.4 39.8Q46.6 37.4 54.8 39.8L54.2 45Q46.6 49.2 38.9 45z" fill="#fbfcff" stroke-width="2"/>'
    + '<path d="M40 41.8Q46.6 40.2 53.2 41.8M40.2 43.8Q46.6 42.6 53 43.8" fill="none" stroke="#c3cae3" stroke-width=".9"/>'
    + '<path d="M51.2 44.6c-.9-.9-2.3.1-1.4 1.2l1.4 1.2 1.4-1.2c.9-1.1-.5-2.1-1.4-1.2z" fill="#f27fa6" stroke="none"/>'
    + hl('M40.6 40.6Q43 39.6 45 39.4', 1)
  ),
  face_goggle: face(
    '<path d="M35.6 37.4L57.6 36.6" fill="none" stroke-width="3.6"/>'
    + '<path d="M35.6 37.4L57.6 36.6" fill="none" stroke="#5a5f86" stroke-width="1.8"/>'
    + '<path d="M38 33.4Q46.6 31.8 55.6 33.4Q57 37.2 55.2 40.8Q50.6 41.6 47.6 39.8Q46.6 39.2 45.6 39.8Q42.6 41.6 38.4 40.8Q36.6 37.2 38 33.4z" fill="#3b4068" stroke-width="2.2"/>'
    + '<path d="M39.6 34.8Q46.6 33.5 54.1 34.8Q55 37 54 39.3Q50.8 39.8 48.4 38.4Q46.6 37.5 44.8 38.4Q42.4 39.8 39.9 39.3Q38.9 37 39.6 34.8z" fill="#5fe3f0" fill-opacity=".88" stroke="none"/>'
    + '<path d="M38.4 33.9Q46.6 32.5 55.2 33.9" fill="none" stroke="#a7b0d8" stroke-width=".8"/>'
    + '<path d="M49.4 36.2h3.6M49.4 37.5h2.2" fill="none" stroke="#2a7fb4" stroke-width=".7"/>'
    + '<circle cx="36.6" cy="37.2" r="1.4" fill="#c9cfe8" stroke-width="1"/>'
    + hl('M41 38.6L44.2 35.2M44.9 37.8l1.2-1.3', 1.1)
  ),
  face_opera: face(
    '<path d="M57.4 32C59 26 62.4 22.4 66.8 21C65.6 26.4 62.4 30.6 57.4 32z" fill="#9b6ad6" stroke-width="1.5"/>'
    + '<path d="M58.4 31Q61.8 26 65.6 22.2" fill="none" stroke="#e3d0fa" stroke-width=".8"/>'
    + '<path fill-rule="evenodd" d="M35 31.4Q40.4 33.2 46.6 35Q52.8 33.2 58.4 31.2Q59 39.6 53.6 42.2Q49 43 46.6 39.8Q44.2 43 39.6 42.2Q34.4 39.8 35 31.4z'
    + 'M40.9 37.2a2.45 1.85 0 1 0 4.9 0a2.45 1.85 0 1 0-4.9 0zM47.5 37.4a2.45 1.85 0 1 0 4.9 0a2.45 1.85 0 1 0-4.9 0z" fill="#fbf7ff" stroke-width="2"/>'
    + '<path d="M36.6 33.2Q41 34.6 46.6 36.5Q52.2 34.6 56.8 33" fill="none" stroke="#e2b23f" stroke-width="1.1"/>'
    + '<path d="M38.6 40.2q2 .9 3.4-.4M54.6 40.2q-2 .9-3.4-.4" fill="none" stroke="#8a5cc4" stroke-width=".9"/>'
    + '<path d="M46.6 33.4l1.5 1.9-1.5 1.9-1.5-1.9z" fill="#b06ae0" stroke-width="1"/>'
    + '<g fill="#f2c14e" stroke-width=".8"><circle cx="35.6" cy="32" r="1"/><circle cx="57.8" cy="31.8" r="1"/></g>'
    + '<circle cx="46.2" cy="34.6" r=".45" fill="#fff" stroke="none"/>'
    + hl('M37.4 38.6q-.6-2.2.4-4', 1)
    + sparkle(60.6, 39.4, 1.7, '#fff')
  ),
  face_fox: face(
    '<path d="M55.6 37Q59.2 39 58.8 44" fill="none" stroke-width="2.4"/>'
    + '<path d="M55.6 37Q59.2 39 58.8 44" fill="none" stroke="#f2c14e" stroke-width="1.1"/>'
    + '<path d="M57.6 43.4h2.4l.6 4.6h-3.6z" fill="#e0454b" stroke-width="1.3"/>'
    + '<path d="M38 41L37.2 29.6Q37 26.2 40 28.4L43.4 31.2Q46.6 30.2 49.8 31.2L53.4 28.2Q56.4 26 56.2 29.4L55.4 41Q52 45.2 46.6 47Q41.2 45.2 38 41z" fill="#fffaf0" stroke-width="2.2"/>'
    + '<path d="M38.8 30.6L39.3 28.6L41.8 30.9zM54.4 30.6L53.9 28.6L51.4 30.9z" fill="#e0454b" stroke="none"/>'
    + '<path d="M40.4 37.4Q43 35 45.8 37.2Q43 38.6 40.4 37.4zM47.4 37.2Q50.2 35 52.8 37.4Q50.2 38.6 47.4 37.2z" fill="#2a2350" stroke="none"/>'
    + '<path d="M40 35.4Q43 33.4 46 35.6M47.2 35.6Q50.2 33.4 53.2 35.4" fill="none" stroke="#e0454b" stroke-width="1.2"/>'
    + '<path d="M46.6 30.8q-1.6 2.2 0 4q1.6-1.8 0-4z" fill="#e0454b" stroke="none"/>'
    + '<path d="M39.6 40.4l2.6.6M39.8 42.2l2.4-.2M53.6 40.4l-2.6.6M53.4 42.2l-2.4-.2" fill="none" stroke="#e0454b" stroke-width="1"/>'
    + '<ellipse cx="46.6" cy="45.4" rx="1.3" ry=".9" fill="#2a2350" stroke="none"/>'
    + hl('M39 39.6Q38.6 35 39.6 32.4', 1.2)
    + sparkle(33.6, 31.4, 2.8) + sparkle(61.8, 27.4, 2.4) + sparkle(35.2, 46, 1.8)
  ),

  // ===== 首まわり（あご y≈43.5 の下、首元の中心 x≈50。neck() で 1.22 倍） =====
  neck_muffler: neck(
    '<path d="M47.8 49.2L44.8 61.8L51.4 63L54.4 49.8z" fill="#d94b5a"/>'
    + '<path d="M46.8 55l6 .9M46 58.4l6 .9" fill="none" stroke="#ffe7b8" stroke-width="1.5"/>'
    + '<path d="M45.6 62.4l-.4 1.8M47.8 62.8l-.3 1.8M50 63.2l-.2 1.8" fill="none" stroke-width="1.1"/>'
    + '<path d="M40.4 42.6Q50.6 47.6 61 41.8L62 47.6Q51 53.8 40.2 48.6z" fill="#ef5f6b"/>'
    + '<path d="M44.2 45.4l.3 3.6M48.6 46.8l.2 3.8M53.2 46.6l-.1 3.8M57.6 44.6l-.2 3.6" fill="none" stroke="#c43c4c" stroke-width=".9"/>'
    + hl('M42.6 45.4Q47 47.6 51.6 47.4', 1.2)
  ),
  neck_tie: neck(
    '<path d="M50.6 47.2L42 42.2Q39.4 47.4 42 52.4z" fill="#86bdee"/>'
    + '<path d="M50.6 47.2L59.2 42.2Q61.8 47.4 59.2 52.4z" fill="#86bdee"/>'
    + '<path d="M44.8 44.2v6.2M47.6 45.8v3M42.4 47.2h7.4M56.4 44.2v6.2M53.6 45.8v3M51.4 47.2h7.4" fill="none" stroke="#3f78c0" stroke-width=".9" opacity=".75"/>'
    + '<rect x="48.6" y="45" width="4" height="4.6" rx="1.4" fill="#5d97dc" stroke-width="1.6"/>'
    + hl('M43 45.2q.6-1.4 1.8-1.6', 1)
  ),
  neck_beads: neck(beads()),
  neck_bronze: neck(medal({ ribbon: '#4f8de0', stripe: '#fff', metal: '#cf8f58', rim: '#9c6136', shade: '', emboss: '#b0723f', r: 5.6, shine: false })),
  neck_bell: neck(
    '<path d="M41 43.4Q50.6 48.6 60.2 42.8L60.8 46.4Q51 52.4 40.6 47z" fill="#e66a86"/>'
    + '<g fill="#ffe08a" stroke-width=".6"><circle cx="44.4" cy="46.7" r=".8"/><circle cx="56.8" cy="46.1" r=".8"/></g>'
    + '<circle cx="50.6" cy="49" r="1.3" fill="none" stroke-width="1.2"/>'
    + '<circle cx="50.6" cy="54" r="4.8" fill="#d9dff0"/>'
    + '<path d="M45.9 52.6Q50.6 54.4 55.3 52.6" fill="none" stroke="#8f98bf" stroke-width="1"/>'
    + `<path d="M50.6 56.2v2.4" fill="none" stroke-width="1.1"/><circle cx="50.6" cy="56" r="1" fill="${INK}" stroke="none"/>`
    + hl('M47.6 51.6Q48.2 50.2 49.8 49.8', 1.1)
  ),
  neck_gold: neck(medal({ ribbon: '#e2474f', stripe: '#ffd460', metal: '#f7c63f', rim: '#d48e17', shade: '#e3a422', emboss: '#e09a1c', r: 6.2, shine: true })),
  neck_pendant: neck(
    '<path d="M41.6 43.6Q50.4 54 59.4 43" fill="none" stroke-width="2"/>'
    + '<path d="M41.6 43.6Q50.4 54 59.4 43" fill="none" stroke="#e6eaf6" stroke-width=".9"/>'
    + '<circle cx="50.4" cy="49" r="1.3" fill="#e6eaf6" stroke-width="1"/>'
    + '<path d="M50.4 50.2L54.2 53.4L53.4 58.6L50.4 62.6L47.4 58.6L46.6 53.4z" fill="#47b8ea" stroke-width="1.7"/>'
    + '<path d="M46.6 53.4L50.4 55L50.4 62.6L47.4 58.6z" fill="#9fe4fb" stroke="none"/>'
    + '<path d="M46.6 53.4L50.4 55L54.2 53.4M50.4 55V62.6" fill="none" stroke="#2879b8" stroke-width=".7"/>'
    + hl('M48 54.6l.4 2.8', 0.9)
    + sparkle(53.8, 51.8, 1.8, '#fff') + sparkle(46, 60.6, 1.2, '#fff')
  ),
  neck_star: neck(starNecklace())
};

export function renderAccessory(item, slot) {
  if (!item || typeof item.id !== 'string' || !item.id.startsWith(`${slot}_`) || !Object.hasOwn(parts, item.id)) return '';
  return `<svg class="miacis-part miacis-part-${slot}" aria-hidden="true" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;overflow:visible"><g stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${parts[item.id]}</g></svg>`;
}

// ===== 背景（台座の円の中の小さな風景） =====
// 平塗り中心。相棒（黄色と紺）が前に出るよう、真ん中は明るめにし、黄色の面は避ける。
const cloud = (x, y, s, fill = '#fff') => `<path d="M${n(x - 9 * s)} ${n(y)}a${n(4 * s)} ${n(4 * s)} 0 0 1 ${n(4 * s)} ${n(-4 * s)}a${n(5 * s)} ${n(5 * s)} 0 0 1 ${n(9 * s)} ${n(-2 * s)}a${n(4 * s)} ${n(4 * s)} 0 0 1 ${n(5 * s)} ${n(6 * s)}z" fill="${fill}"/>`;
const dots = (list, fill, r = 0.8) => list.map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr || r}" fill="${fill}"/>`).join('');

const backgrounds = {
  bg_green: '<rect width="100" height="100" fill="#d4f0fb"/>'
    + '<rect y="44" width="100" height="56" fill="#fff0d2"/>'
    + '<circle cx="22" cy="54" r="15" fill="#ffe2b0"/><circle cx="22" cy="54" r="10" fill="#ffbe78"/>'
    + '<path d="M0 60Q26 46 56 58T100 54V100H0z" fill="#9ad88c"/>'
    + '<path d="M0 74Q40 61 100 70V100H0z" fill="#5fb86a"/>'
    + dots([[14, 80], [24, 86], [80, 82], [88, 76], [70, 90]], '#fff', 1.1)
    + cloud(80, 24, 0.9),
  bg_sky: '<rect width="100" height="100" fill="#8fd0f5"/>'
    + '<circle cx="50" cy="50" r="40" fill="#a8dbf8"/>'
    + cloud(24, 26, 1.2) + cloud(84, 44, 1) + cloud(70, 14, 0.7) + cloud(16, 58, 0.8)
    + '<path d="M0 80Q50 74 100 80V100H0z" fill="#efe4cc"/>'
    + '<path d="M0 88Q50 83 100 88M30 77l-6 23M50 76v24M70 77l6 23" fill="none" stroke="#d8c8a6" stroke-width="1.2"/>',
  bg_dusk: '<rect width="100" height="100" fill="#ffb98c"/>'
    + '<rect width="100" height="36" fill="#f8a888"/>'
    + '<rect width="100" height="22" fill="#f08f8f"/>'
    + '<circle cx="76" cy="66" r="19" fill="#ff8f6a" opacity=".45"/><circle cx="76" cy="66" r="14" fill="#ff7f5e"/>'
    + '<path d="M0 66L8 60L14 64L22 56L30 62L38 58V70H0zM62 70L70 64L80 66L90 60L100 63V70z" fill="#a8698f"/>'
    + '<rect y="69" width="100" height="31" fill="#c98a8c"/>'
    + '<path d="M36 100L49 69H55L72 100z" fill="#f2c7a8"/>'
    + '<path d="M52 72v4M53 80v5M54.5 89v6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>'
    + dots([[12, 16], [30, 10], [88, 14]], '#ffe7d6', 0.7),
  bg_night: '<rect width="100" height="100" fill="#4664bd"/>'
    + '<circle cx="50" cy="52" r="38" fill="#5675cc"/>'
    + '<path d="M84 13a10 10 0 1 0 6 16a8 8 0 1 1-6-16z" fill="#fff4b8"/>'
    + dots([[12, 22, 1.1], [24, 10], [38, 18, 0.6], [66, 8], [14, 46, 0.7], [90, 50, 1], [80, 38, 0.6], [8, 64, 0.6], [92, 70, 0.7], [30, 34, 0.5]], '#fff')
    + '<path d="M20 14l1 2 2 .4-2 .6-1 2-1-2-2-.6 2-.4zM72 26l.8 1.6 1.6.4-1.6.4-.8 1.6-.8-1.6-1.6-.4 1.6-.4z" fill="#fff4b8"/>'
    + '<path d="M58 6L40 20" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".7"/>'
    + '<path d="M0 82Q30 72 60 82T100 78V100H0z" fill="#33498f"/>',
  bg_forest: '<rect width="100" height="100" fill="#c6eaa8"/>'
    + '<path d="M16 0V80M84 0V80" fill="none" stroke="#9a7650" stroke-width="7"/>'
    + '<path d="M6 0V70M94 0V72" fill="none" stroke="#b08a5e" stroke-width="4"/>'
    + '<path d="M-6 0H106V16Q96 26 84 18Q74 28 62 18Q50 26 38 18Q26 28 16 18Q6 26-6 16z" fill="#4fa564"/>'
    + '<path d="M-6 0H106V8Q94 16 80 9Q66 16 52 9Q38 16 24 9Q10 16-6 8z" fill="#3d8c56"/>'
    + '<path d="M30 12L46 12L66 100L40 100zM62 14L70 14L92 100L80 100z" fill="#fff" opacity=".32"/>'
    + '<path d="M0 80Q50 72 100 80V100H0z" fill="#86c46c"/>'
    + '<ellipse cx="54" cy="86" rx="12" ry="2.6" fill="#e8f7b4"/><ellipse cx="84" cy="92" rx="6" ry="1.6" fill="#e8f7b4"/>'
    + dots([[44, 30], [70, 40], [34, 54], [76, 60]], '#fff9d0', 0.9),
  bg_sakura: '<rect width="100" height="100" fill="#ffe3ec"/>'
    + '<circle cx="50" cy="50" r="40" fill="#fff0f4"/>'
    + '<path d="M-2 10Q20 14 34 4M14 12Q16 20 22 22" fill="none" stroke="#a8707a" stroke-width="2" stroke-linecap="round"/>'
    + blossom(30, 6, '#ff9fbf') + blossom(21, 21, '#ffb3cc') + blossom(7, 7, '#ffb3cc')
    + petal(80, 20, 20, '#ff9fbf') + petal(88, 46, -30, '#ffb8cf') + petal(14, 50, 40, '#ffb8cf') + petal(76, 74, 70, '#ff9fbf')
    + petal(22, 82, -50, '#ff9fbf') + petal(90, 86, 10, '#ffb8cf') + petal(60, 8, 110, '#ffb8cf') + petal(8, 70, 150, '#ff9fbf')
    + '<path d="M0 88Q50 82 100 88V100H0z" fill="#ffc6d8"/>',
  bg_ocean: '<rect width="100" height="100" fill="#3f9fc8"/>'
    + '<rect width="100" height="40" fill="#56bfd6"/>'
    + '<rect y="72" width="100" height="28" fill="#2f80b2"/>'
    + '<path d="M28 0H40L58 100H40zM64 0H70L84 100H76z" fill="#fff" opacity=".2"/>'
    + '<path d="M10 100Q4 88 10 80Q16 72 10 62M18 100Q22 90 17 84M88 100Q94 90 88 82Q83 74 88 66" fill="none" stroke="#2a6f8e" stroke-width="3" stroke-linecap="round"/>'
    + '<g fill="#fff" fill-opacity=".3" stroke="#fff" stroke-width=".8"><circle cx="80" cy="30" r="3"/><circle cx="85" cy="20" r="1.8"/><circle cx="82" cy="12" r="1.2"/><circle cx="18" cy="38" r="2.4"/><circle cx="14" cy="28" r="1.4"/><circle cx="70" cy="56" r="1.6"/></g>',
  bg_aurora: '<rect width="100" height="100" fill="#3f4fa6"/>'
    + '<circle cx="50" cy="50" r="40" fill="#4a5cb4"/>'
    + '<path d="M-4 16Q30 4 60 14T104 8V16Q72 24 50 22T-4 24z" fill="#c78af0" opacity=".65"/>'
    + '<path d="M-4 30Q20 14 44 26T104 18V30Q80 40 56 34T-4 42z" fill="#6ff0b4" opacity=".8"/>'
    + '<path d="M-4 44Q24 30 52 42T104 34V44Q78 54 54 50T-4 56z" fill="#78d6f4" opacity=".7"/>'
    + dots([[12, 8], [30, 4], [86, 24], [8, 60, 0.6], [92, 52], [70, 6, 0.6]], '#fff')
    + '<path d="M0 86L18 70L30 80L46 66L62 82L76 72L100 86V100H0z" fill="#dfe6ff"/>'
    + '<path d="M0 92Q50 86 100 92V100H0z" fill="#b8c4ee"/>'
    + sparkle(88, 12, 2.2, '#fff')
};

/** 背景 id ごとの風景 SVG。未知の id は空文字（呼び出し側でグラデーションに倒れる） */
export function renderBackdrop(item) {
  if (!item || typeof item.id !== 'string' || !Object.hasOwn(backgrounds, item.id)) return '';
  return `<svg class="miacis-backdrop" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0;width:100%;height:100%;display:block">${backgrounds[item.id]}</svg>`;
}

// ===== オーラ（相棒の後ろに見える光） =====
// N: やわらかい光の輪 / R: 光の粒が少し / SR: 放射状の光 / UR: 虹色の輪がゆっくり回る
const AX = 50;
const AY = 52;
const softRing = (c, o = 1) => `<ellipse cx="${AX}" cy="${AY}" rx="38" ry="44" fill="${c}" opacity="${n(Math.min(1, 0.22 * o))}"/>`
  + `<ellipse cx="${AX}" cy="${AY}" rx="31" ry="37" fill="${c}" opacity="${n(Math.min(1, 0.3 * o))}"/>`
  + `<ellipse cx="${AX}" cy="${AY}" rx="41" ry="46.5" fill="none" stroke="${c}" stroke-width="2.4" opacity=".95"/>`;

function rays(c, count, inner, outer, width, opacity) {
  const p = (r, t) => `${n(AX + r * Math.cos(t))} ${n(AY + r * Math.sin(t))}`;
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    d += `M${p(inner, a)}L${p(outer, a - width / 2)}L${p(outer, a + width / 2)}z`;
  }
  return `<path d="${d}" fill="${c}" opacity="${opacity}"/>`;
}

function rainbowRing() {
  const hues = ['#ff5f8f', '#ff9a4d', '#ffd84a', '#7fe08a', '#4fd0f0', '#6f8cff', '#b77cff', '#ff6fd0'];
  const r = 43;
  return hues.map((c, i) => {
    const a0 = (i / hues.length) * Math.PI * 2;
    const a1 = ((i + 1) / hues.length) * Math.PI * 2 + 0.03;
    return `<path d="M${n(50 + r * Math.cos(a0))} ${n(50 + r * Math.sin(a0))}A${r} ${r} 0 0 1 ${n(50 + r * Math.cos(a1))} ${n(50 + r * Math.sin(a1))}" fill="none" stroke="${c}" stroke-width="5"/>`;
  }).join('');
}

const PARTICLES = [[18, 30, 1.6], [82, 26, 1.3], [14, 62, 1.2], [86, 60, 1.7], [28, 86, 1.1], [74, 88, 1.3], [50, 6, 1.1], [90, 42, 0.9]];
const fleck = (c) => PARTICLES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#fff" stroke-width=".5"/>`).join('');

const auras = {
  aura_white: softRing('#ffffff', 1.6),
  aura_green: softRing('#8ff0be'),
  aura_yellow: softRing('#ffc58f', 1.1),
  aura_blue: softRing('#6fb8ff', 0.9) + `<ellipse cx="${AX}" cy="13" rx="15" ry="3.6" fill="none" stroke="#d6ebff" stroke-width="2.2"/>` + fleck('#a8d4ff'),
  aura_pink: softRing('#ff9fc2', 0.9) + PARTICLES.map(([x, y], i) => petal(x, y, i * 47, '#ffa8c8')).join(''),
  aura_gold: rays('#ffd84a', 16, 14, 47, 0.2, 0.62) + softRing('#ffd84a', 0.8)
    + sparkle(16, 24, 2.4, '#fff6c0') + sparkle(86, 70, 2.2, '#fff6c0') + sparkle(84, 18, 1.6, '#fff6c0'),
  aura_purple: rays('#c58aff', 12, 14, 47, 0.16, 0.58) + softRing('#c27ff0', 0.8)
    + '<path d="M14 24l5 6-3 1 5 7M87 58l-5 5 3 1-5 7M82 16l-3 5 2 .6-3 4" fill="none" stroke="#7a3fc0" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<path d="M14 24l5 6-3 1 5 7M87 58l-5 5 3 1-5 7M82 16l-3 5 2 .6-3 4" fill="none" stroke="#fbf0ff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>',
  aura_rainbow: rays('#ffffff', 16, 14, 46, 0.17, 0.5)
    + `<ellipse cx="${AX}" cy="${AY}" rx="34" ry="40" fill="#fff" opacity=".4"/>`
};

const auraSvg = (cls, body) => `<svg class="miacis-aura-art${cls}" aria-hidden="true" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;overflow:visible">${body}</svg>`;
// 虹の輪の回転。動きを減らす設定では止める（app.css / experience.css の一括停止とは別に、単体でも止まるように）
const SPIN_STYLE = '<style>@keyframes miacis-aura-spin{to{transform:rotate(360deg)}}.miacis-aura-spin{transform-origin:50% 50%;animation:miacis-aura-spin 18s linear infinite}@media (prefers-reduced-motion:reduce){.miacis-aura-spin{animation:none}}</style>';

/** オーラ id ごとの SVG（相棒の後ろに置く）。未知の id は空文字 */
export function renderAuraArt(item) {
  if (!item || typeof item.id !== 'string' || !Object.hasOwn(auras, item.id)) return '';
  const base = auraSvg('', auras[item.id]);
  if (item.id !== 'aura_rainbow') return base;
  return SPIN_STYLE + base + auraSvg(' miacis-aura-spin', rainbowRing() + sparkle(50, 4, 2.6, '#fff') + sparkle(94, 56, 2.2, '#fff') + sparkle(14, 80, 2, '#fff'));
}
