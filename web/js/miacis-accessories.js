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

/**
 * ふち取りを外側だけに付ける: 同じ形を紺で太く塗ってから、色で塗り重ねる。
 * 形が重なっても内側に線が出ない（花・音符など小さい部品向け）。shapes の要素は fill/stroke を持たない
 */
const outlined = (shapes, fill, w = 1.6) => `<g fill="${INK}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round">${shapes}</g><g fill="${fill}" stroke="none">${shapes}</g>`;

/** 丸い花びら5枚の小花（(x, y) が中心、r が花の半径） */
function flower(x, y, r, fill, core = '#ffb347') {
  let shapes = '';
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    shapes += `<circle cx="${n(x + r * 0.55 * Math.cos(a))}" cy="${n(y + r * 0.55 * Math.sin(a))}" r="${n(r * 0.5)}"/>`;
  }
  return outlined(shapes, fill, n(r * 0.5)) + `<circle cx="${x}" cy="${y}" r="${n(r * 0.3)}" fill="${core}" stroke="none"/>`;
}

/** 葉っぱ1枚（(x, y) が中心、rot 度回す、len は長さの半分） */
const leafShape = (x, y, rot, fill, len = 4, sw = 1) => `<g transform="rotate(${rot} ${x} ${y})"><path d="M${x} ${n(y - len)}C${n(x + len * 0.75)} ${n(y - len * 0.5)} ${n(x + len * 0.7)} ${n(y + len * 0.5)} ${x} ${n(y + len)}C${n(x - len * 0.7)} ${n(y + len * 0.5)} ${n(x - len * 0.75)} ${n(y - len * 0.5)} ${x} ${n(y - len)}z" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`
  + `<path d="M${x} ${n(y - len * 0.6)}V${n(y + len * 1.2)}" fill="none" stroke="${INK}" stroke-width="${n(sw * 0.7)}" stroke-linecap="round"/></g>`;

/** ハートの path（(x, y) がおおよその中心、s 倍。素の幅 8.8） */
function heartPath(x, y, s) {
  const P = (dx, dy) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  return `M${P(0, 4)}C${P(-1.2, 3.2)} ${P(-4.4, 1)} ${P(-4.4, -1.2)}C${P(-4.4, -3)} ${P(-3, -4)} ${P(-1.8, -4)}C${P(-0.8, -4)} ${P(-0.2, -3.4)} ${P(0, -2.6)}C${P(0.2, -3.4)} ${P(0.8, -4)} ${P(1.8, -4)}C${P(3, -4)} ${P(4.4, -3)} ${P(4.4, -1.2)}C${P(4.4, 1)} ${P(1.2, 3.2)} ${P(0, 4)}Z`;
}

/** 武田菱（4つの菱形。(x, y) が中心、s が菱1つの横幅の半分） */
function takedaBishi(x, y, s, fill) {
  const h = s * 0.68;
  const gap = s * 1.12;
  const dia = (cx, cy) => `M${n(cx)} ${n(cy - h)}L${n(cx + s)} ${n(cy)}L${n(cx)} ${n(cy + h)}L${n(cx - s)} ${n(cy)}z`;
  return `<path d="${dia(x, y - h * 1.12)}${dia(x, y + h * 1.12)}${dia(x - gap, y)}${dia(x + gap, y)}" fill="${fill}" stroke="none"/>`;
}

/** 点の列 [[x, y], ...] を path に。mirror で x = 101 - x に左右反転（首元の中心 x=50.5 で折り返す） */
function pathOf(cmds, mirror = false) {
  return cmds.map(([c, ...v]) => c + v.map((num, i) => n(i % 2 === 0 && mirror ? 101 - num : num)).join(' ')).join('') + 'z';
}

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

function lei() {
  const colors = ['#ff7fa8', '#fff4f8', '#ff9a4d', '#c99bff', '#ff7fa8', '#fff4f8', '#ff9a4d', '#c99bff', '#ff7fa8'];
  const P = [[41, 43.4], [50.5, 55], [60, 42.8]];
  let s = '';
  for (const t of [0.1, 0.32, 0.56, 0.78, 0.97]) {
    const [x, y] = qpt(...P, t);
    s += leafShape(n(x), n(y + 1.6), t < 0.5 ? 40 : -40, '#5cb86a', 2.2, 0.9);
  }
  colors.forEach((c, i) => {
    const [x, y] = qpt(...P, i / 8);
    s += flower(n(x), n(y), i === 4 ? 3 : 2.6, c, '#ffd25e');
  });
  const [x, y] = qpt(...P, 0.5);
  return s + hl(`M${n(x - 1.6)} ${n(y - 1.2)}q.5-.9 1.3-1.1`, 0.8);
}

/** マント（左右の布＋えり＋留め具）。布は肩から体の外へ広がり、胸の前は開ける */
function cape({ cloth, shade, trim, lining, clasp }) {
  const panel = [['M', 45.4, 44.4], ['Q', 38.6, 45, 34.4, 49.8], ['Q', 30.4, 56, 28.2, 65.4], ['Q', 31.4, 63.4, 33.6, 65.6], ['Q', 35.6, 63, 38.2, 64], ['Q', 37.4, 57, 40.4, 50.6], ['Q', 42.6, 47.2, 46.4, 46.4]];
  const inner = [['M', 46.4, 46.4], ['Q', 42.6, 47.2, 40.4, 50.6], ['Q', 37.4, 57, 38.2, 64], ['Q', 39.6, 63.4, 40.6, 64.2], ['Q', 39.8, 57.6, 42, 52], ['Q', 43.6, 48.6, 47, 47.6]];
  const edge = [['M', 33.4, 52], ['Q', 30.6, 57.4, 29.4, 63.6]];
  const line = (cmds, mirror) => cmds.map(([c, ...v]) => c + v.map((num, i) => n(i % 2 === 0 && mirror ? 101 - num : num)).join(' ')).join('');
  let s = '';
  for (const m of [false, true]) {
    s += `<path d="${pathOf(panel, m)}" fill="${cloth}"/>`
      + `<path d="${pathOf(inner, m)}" fill="${lining}" stroke-width="1.2"/>`
      + `<path d="${line(edge, m)}" fill="none" stroke="${shade}" stroke-width="1.4"/>`
      + `<path d="M${n(m ? 101 - 38.2 : 38.2)} 64Q${n(m ? 101 - 35.6 : 35.6)} 63 ${n(m ? 101 - 33.6 : 33.6)} 65.6" fill="none" stroke="${trim}" stroke-width=".9"/>`;
  }
  return s
    + `<path d="M42 43.4Q50.6 48.6 59.2 42.8L59.8 46.4Q50.6 52.4 41.4 47z" fill="${cloth}"/>`
    + `<path d="M42.2 45.6Q50.6 50.8 59.4 45" fill="none" stroke="${trim}" stroke-width="1"/>`
    + clasp
    + hl('M35 52.4Q33.2 55.4 32.4 58.4', 1.1);
}

// ---- Miacis の遊び・活動の部品（卓球・ヘアアイロン・取材・ダーツ・麻雀・体を動かすゲーム・パーソナルカラー） ----

/** 円の中心 (cx, cy) から見た角度 a（ラジアン）・半径 r の点 */
const polar = (cx, cy, r, a) => `${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;

/** 輪の一部（r0〜r1、角度 a0〜a1 ラジアン）。r0 = 0 なら扇形 */
function ringSeg(cx, cy, r0, r1, a0, a1) {
  return `M${polar(cx, cy, r0, a0)}L${polar(cx, cy, r1, a0)}A${n(r1)} ${n(r1)} 0 0 1 ${polar(cx, cy, r1, a1)}L${polar(cx, cy, r0, a1)}`
    + (r0 > 0 ? `A${n(r0)} ${n(r0)} 0 0 0 ${polar(cx, cy, r0, a0)}` : '') + 'z';
}

/** ダーツの的（白黒の扇・赤緑のダブルとトリプル・ブル）。ふち取りは呼ぶ側で付ける */
function dartboard(cx, cy, r) {
  const N = 12;
  const step = (Math.PI * 2) / N;
  let dark = '';
  let red = '';
  let green = '';
  for (let i = 0; i < N; i++) {
    const a0 = -Math.PI / 2 - step / 2 + i * step;
    const a1 = a0 + step;
    if (i % 2) dark += ringSeg(cx, cy, 0, r * 0.8, a0, a1);
    const ring = ringSeg(cx, cy, r * 0.8, r, a0, a1) + ringSeg(cx, cy, r * 0.4, r * 0.56, a0, a1);
    if (i % 2) green += ring; else red += ring;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f7eed6" stroke="none"/>`
    + `<path d="${dark}" fill="#2a2350" stroke="none"/>`
    + `<path d="${red}" fill="#e8424c" stroke="none"/>`
    + `<path d="${green}" fill="#2fa36a" stroke="none"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${n(r * 0.24)}" fill="#2fa36a" stroke="none"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${n(r * 0.12)}" fill="#e8424c" stroke="none"/>`;
}

/** 麻雀牌1枚（上の辺の中央 (x, y) からぶら下げ、rot 度回す）。牌の面に face(x, 面の中心 y) の絵を描く */
function mjTile(x, y, rot, w, h, face) {
  const top = y + 0.3;
  const cy = top + h / 2;
  return `<g transform="rotate(${n(rot)} ${n(x)} ${n(y)})">`
    + `<rect x="${n(x - w / 2)}" y="${n(top)}" width="${w}" height="${n(h + 1.1)}" rx="1" fill="#36a47a" stroke-width="1.3"/>`
    + `<rect x="${n(x - w / 2)}" y="${n(top)}" width="${w}" height="${h}" rx="1" fill="#fbf6e4" stroke-width="1.3"/>`
    + face(x, cy, w, h)
    + `<path d="M${n(x - w / 2 + 0.8)} ${n(top + 1.1)}v${n(h * 0.4)}" fill="none" stroke="#fff" stroke-width=".7"/>`
    + '</g>';
}
const mjChun = (x, y, w, h) => `<path d="M${n(x - w * 0.27)} ${n(y - h * 0.12)}h${n(w * 0.54)}v${n(h * 0.26)}h${n(-w * 0.54)}zM${x} ${n(y - h * 0.34)}V${n(y + h * 0.34)}" fill="none" stroke="#d8323c" stroke-width=".85" stroke-linecap="round"/>`;
const mjPin1 = (x, y, w) => `<circle cx="${x}" cy="${y}" r="${n(w * 0.3)}" fill="#e8424c" stroke="#2f6fc0" stroke-width=".8"/><circle cx="${x}" cy="${y}" r="${n(w * 0.1)}" fill="#fff" stroke="none"/>`;
const mjPin2 = (x, y, w, h) => `<g stroke="none"><circle cx="${x}" cy="${n(y - h * 0.22)}" r="${n(w * 0.22)}" fill="#2f6fc0"/><circle cx="${x}" cy="${n(y + h * 0.22)}" r="${n(w * 0.22)}" fill="#36a47a"/></g>`;
const mjSou = (x, y, w, h) => `<path d="M${n(x - w * 0.16)} ${n(y - h * 0.3)}V${n(y + h * 0.3)}M${n(x + w * 0.16)} ${n(y - h * 0.3)}V${n(y + h * 0.3)}" fill="none" stroke="#2f9a5e" stroke-width=".9" stroke-linecap="round"/>`;

/** 体を動かすゲームの白いリモコン（汎用。上の端 (x, y) を留め、rot 度振る）。十字キー・丸ボタン・小さなボタン2つ */
function wand(x, y, rot) {
  const t = y + 0.6;
  return `<g transform="rotate(${n(rot)} ${n(x)} ${n(y)})">`
    + `<rect x="${n(x - 2.4)}" y="${n(t)}" width="4.8" height="11.6" rx="2.1" fill="#fbfcff" stroke-width="1.7"/>`
    + `<path d="M${n(x + 1.3)} ${n(t + 1.4)}V${n(t + 10.4)}" fill="none" stroke="#dde2f2" stroke-width="1.3"/>`
    + `<path d="M${n(x - 0.55)} ${n(t + 1.5)}h1.1v1.1h1.1v1.1h-1.1v1.1h-1.1v-1.1h-1.1v-1.1h1.1z" fill="#5a5f86" stroke="none"/>`
    + `<circle cx="${x}" cy="${n(t + 6.1)}" r="1.15" fill="#4fb8ef" stroke-width=".8"/>`
    + `<circle cx="${n(x - 0.35)}" cy="${n(t + 5.75)}" r=".35" fill="#fff" stroke="none"/>`
    + `<g fill="#aeb6d4" stroke="none"><circle cx="${x}" cy="${n(t + 8.5)}" r=".5"/><circle cx="${x}" cy="${n(t + 9.9)}" r=".5"/></g>`
    + '</g>';
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
  hat_beanie: hat(
    '<path d="M37.4 20.6C36.4 6.4 65.6 6.4 64.6 20.6z" fill="#ff8a5b"/>'
    + '<path d="M44.6 10.4Q43.4 15 43.8 20.4M51 8.8V20.8M57.4 10.4Q58.6 15 58.2 20.4" fill="none" stroke="#e0653c" stroke-width=".9"/>'
    + '<path d="M36.4 19.6Q51 23.2 65.6 19.6L66 25.2Q51 29 36 25.2z" fill="#f2683f"/>'
    + [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.92].map((t) => {
      const [x0, y0] = qpt([36.4, 19.6], [51, 23.2], [65.6, 19.6], t);
      const [x1, y1] = qpt([36, 25.2], [51, 29], [66, 25.2], t);
      return `<path d="M${n(x0)} ${n(y0 + 0.9)}L${n(x1)} ${n(y1 - 0.9)}" fill="none" stroke="#c94b2a" stroke-width=".9"/>`;
    }).join('')
    + '<circle cx="51" cy="6.6" r="3.6" fill="#fff4e6"/>'
    + '<path d="M49.4 5.6l1 1M52 4.8l.8 1M51.6 7.6l1 .8M48.8 7.6l.8.6" fill="none" stroke="#e8cdb0" stroke-width=".8"/>'
    + hl('M40.8 17.4Q41.8 13.4 45.4 11.6', 1.6)
  ),
  hat_bucket: hat(
    '<path d="M40.4 22.8L41.8 12.2Q51 9.2 60.2 12.2L61.6 22.8z" fill="#5a8fd6"/>'
    + '<path d="M41.4 15.6Q51 13.6 60.6 15.6" fill="none" stroke="#a9c8f2" stroke-width=".8" stroke-dasharray="1.2 1"/>'
    + '<path d="M33.2 27.8Q35.4 21 40.8 21.2Q51 23.8 61.2 21.2Q66.6 21 68.8 27.8Q51 31.6 33.2 27.8z" fill="#4b7cc4"/>'
    + '<path d="M35.6 26.6Q51 30 66.4 26.6" fill="none" stroke="#a9c8f2" stroke-width=".8" stroke-dasharray="1.2 1"/>'
    + hl('M44.4 19.4L45.2 14.4', 1.6)
  ),
  hat_hachimaki: hat(
    '<path d="M64.2 26.6L72.6 21.4L73.8 25zM64.2 28.2L71.6 32.4L69.4 34.6z" fill="#fbfbff" stroke-width="1.6"/>'
    + '<path d="M70.6 23.4l1.6-.9M69.6 32.6l1.4.9" fill="none" stroke="#e8424c" stroke-width=".8"/>'
    + '<path d="M38.8 25.4Q51 28.6 63.6 25L63.8 29.2Q51 32.8 38.6 29.6z" fill="#fbfbff"/>'
    + '<circle cx="47.3" cy="28.9" r="1.75" fill="#e8424c" stroke="none"/>'
    + '<ellipse cx="64.4" cy="27.4" rx="1.9" ry="2.1" fill="#fbfbff" stroke-width="1.6"/>'
    + hl('M41 27.4Q43.6 28.4 45 28.6', 0.9).replace('#fff', '#c3cae3')
  ),
  hat_chef: hat(
    '<path d="M41.2 19.4C35.4 18.6 34.6 10 41 9.2C41.8 3.4 48.6 2.2 51 6.2C53.4 2.2 60.2 3.4 61 9.2C67.4 10 66.6 18.6 60.8 19.4Q51 21.8 41.2 19.4z" fill="#fdfdff"/>'
    + '<path d="M46 18.4Q45.2 14.6 46.4 11.6M51 19V10.8M56 18.4Q56.8 14.6 55.6 11.6" fill="none" stroke="#c9cde6" stroke-width=".9"/>'
    + '<path d="M40.4 24.6L40.8 18.2Q51 21.2 61.2 18.2L61.6 24.6Q51 27.6 40.4 24.6z" fill="#eef0f8"/>'
    + '<path d="M40.7 21.4Q51 24.4 61.3 21.4" fill="none" stroke="#c9cde6" stroke-width=".8"/>'
    + hl('M38.6 13.4Q39.4 10.6 42.4 10.2', 1.4).replace('#fff', '#c9cde6')
  ),
  hat_headphones: hat(
    '<path d="M38.2 26C37.2 8.6 64.8 8.6 63.8 26" fill="none" stroke-width="4.4"/>'
    + '<path d="M38.2 26C37.2 8.6 64.8 8.6 63.8 26" fill="none" stroke="#5a5f8e" stroke-width="2.2"/>'
    + '<path d="M41.4 15.4Q45 11.8 51 11.4" fill="none" stroke="#b9bde0" stroke-width=".9"/>'
    + '<rect x="33.6" y="22.6" width="6.4" height="10" rx="2.8" fill="#ff6f7d"/>'
    + '<rect x="62" y="22.6" width="6.4" height="10" rx="2.8" fill="#ff6f7d"/>'
    + '<path d="M39.4 24.4v6.4M62.6 24.4v6.4" fill="none" stroke="#5a5f8e" stroke-width="1.6"/>'
    + '<g fill="none" stroke="#fff" stroke-width=".9"><circle cx="36.6" cy="27.6" r="1.4"/><circle cx="65.4" cy="27.6" r="1.4"/></g>'
    + hl('M35.4 24.8q.2-.9 1-1.2', 0.9)
  ),
  hat_flower: hat(
    '<path d="M37.2 21.6Q51 25.6 64.8 21.2" fill="none" stroke-width="2.6"/>'
    + '<path d="M37.2 21.6Q51 25.6 64.8 21.2" fill="none" stroke="#6cbf6a" stroke-width="1.1"/>'
    + [[0.16, -35], [0.39, 30], [0.62, -30], [0.85, 35]].map(([t, r]) => {
      const [x, y] = qpt([37.2, 21.6], [51, 25.6], [64.8, 21.2], t);
      return leafShape(n(x), n(y - 1.6), r, '#7fcf6e', 2.2, 0.9);
    }).join('')
    + [[0.03, 3.2, '#ff8fb8'], [0.27, 3.4, '#fff7fb'], [0.5, 3.9, '#ff8fb8'], [0.73, 3.4, '#9fd6ff'], [0.97, 3.2, '#c9a2ff']].map(([t, r, c]) => {
      const [x, y] = qpt([37.2, 21.6], [51, 25.6], [64.8, 21.2], t);
      return flower(n(x), n(y), r, c, '#ffc94e');
    }).join('')
    + hl('M49.4 21.6q.4-.9 1.2-1.1', 0.8)
  ),
  hat_witch: hat(
    '<path d="M29.6 26.2Q51 19.4 72.4 26.2Q73.6 29.6 69 29.2Q51 25.6 33 29.2Q28.4 29.6 29.6 26.2z" fill="#3e3170"/>'
    + '<path d="M40.4 24Q43.6 15.8 48.2 8.6Q52 2.6 59.6 2Q55.6 4.8 55 9.4Q57.4 16.4 61.6 24Q51 26.4 40.4 24z" fill="#54439a"/>'
    + '<path d="M55 9.4Q57.4 16.4 61.6 24Q59.6 24.6 57.4 24.9Q56.6 16 55 9.4z" fill="#45377f" stroke="none"/>'
    + '<path d="M41.4 21.2Q51 23.6 60.6 21.2L61.6 24.4Q51 27 40.4 24.4z" fill="#ff8f3a" stroke-width="1.8"/>'
    + '<rect x="48.6" y="21.2" width="4.6" height="4" rx=".7" fill="#ffd040" stroke-width="1.2"/>'
    + '<rect x="49.9" y="22.4" width="2" height="1.6" fill="#ff8f3a" stroke="none"/>'
    + hl('M44.6 19Q46 14 48.4 10.6', 1.5)
  ),
  hat_santa: hat(
    '<path d="M38 21.2C37.6 11 46 6.4 54.6 7.2C61.8 7.8 67.4 12.6 69.6 19.6L66.4 20.4C65.2 17.2 63.4 15.2 61.8 14.4C63.2 16.8 64.2 18.8 64.4 21.4Q51 24.6 38 21.2z" fill="#e8434f"/>'
    + '<path d="M61.8 14.4C63.2 16.8 64.2 18.8 64.4 21.4L61.4 22.2Q61.4 17.6 58.4 12.6Q60.4 13.4 61.8 14.4z" fill="#c4303e" stroke="none"/>'
    + '<path d="M36.4 20.4Q51 24.2 65.6 20.4L66 25.8Q51 29.8 36 25.8z" fill="#fbfbff"/>'
    + '<circle cx="68.6" cy="21.8" r="3.2" fill="#fbfbff"/>'
    + '<path d="M38.8 24.4C39.4 22.6 41.6 22.6 42.4 23.4C41.6 24.8 40 25.6 38.8 24.4zM45.6 24.8C45.2 23 43.2 22.4 42.4 23.4C43 24.8 44.4 25.8 45.6 24.8z" fill="#3fae5e" stroke-width="1"/>'
    + '<g fill="#e8434f" stroke-width=".8"><circle cx="42.2" cy="22.4" r="1.05"/><circle cx="43.8" cy="22" r="1"/></g>'
    + hl('M40.4 17.6Q41.6 12.6 46.6 10.2', 1.6)
  ),
  hat_halo: hat(
    '<ellipse cx="51" cy="8.2" rx="15" ry="5.4" fill="#fff4b8" stroke="none" opacity=".55"/>'
    + '<ellipse cx="51" cy="8.2" rx="11" ry="3.2" fill="none" stroke-width="4.4"/>'
    + '<ellipse cx="51" cy="8.2" rx="11" ry="3.2" fill="none" stroke="#e3a422" stroke-width="2.4"/>'
    + '<path d="M40 8.2A11 3.2 0 0 0 62 8.2" fill="none" stroke="#ffd84a" stroke-width="2.4"/>'
    + '<path d="M43.4 10.2Q47 11.4 51.4 11.4" fill="none" stroke="#fff" stroke-width=".9"/>'
    + sparkle(65.4, 3.8, 2.4) + sparkle(37, 4.2, 1.7)
  ),
  hat_kabuto: hat(
    // 錣（しころ）: 赤備えの赤
    '<path d="M37 20.6Q51 25.6 65 20.6L70 27.6Q68.2 29.8 65.2 28.6L64.4 26.2Q51 30.6 37.6 26.2L36.8 28.6Q33.8 29.8 32 27.6z" fill="#d23b45"/>'
    + '<path d="M35.4 25.2Q51 30.4 66.6 25.2" fill="none" stroke="#ffd36a" stroke-width=".9"/>'
    + '<path d="M33.6 27.4l1.4-1M67 26.4l1.4 1" fill="none" stroke="#ffd36a" stroke-width=".8"/>'
    // 鉢（はち）
    + '<path d="M38 22.4C37.2 9 64.8 9 64 22.4Q51 26 38 22.4z" fill="#3b3560"/>'
    + '<path d="M44.6 12.2Q43.4 17.4 43.8 23.8M51 10.6V24.6M57.4 12.2Q58.6 17.4 58.2 23.8" fill="none" stroke="#6f69a6" stroke-width="1"/>'
    + '<path d="M38.2 22.4Q51 26.2 63.8 22.4" fill="none" stroke="#ffd36a" stroke-width="1.1"/>'
    + hl('M40.8 18.4Q41.8 14.2 45.4 12.6', 1.4)
    // 金の鍬形（くわがた）と台
    + '<path d="M49.6 19.4C44 17.4 38 12 35.2 3.8Q40.6 7.4 44.2 10.6Q48 13.6 51 18.2z" fill="#ffd040"/>'
    + '<path d="M52.4 19.4C58 17.4 64 12 66.8 3.8Q61.4 7.4 57.8 10.6Q54 13.6 51 18.2z" fill="#ffd040"/>'
    + '<path d="M39.4 7.6Q44.8 11.6 49.2 17.2M62.6 7.6Q57.2 11.6 52.8 17.2" fill="none" stroke="#e3a422" stroke-width="1"/>'
    + hl('M37.6 7Q40.2 11.6 44.2 14.6', 0.9)
    + '<path d="M46.6 17.4Q51 15.2 55.4 17.4L54.8 21.8Q51 23.4 47.2 21.8z" fill="#ffd040" stroke-width="1.6"/>'
    + takedaBishi(51, 19.4, 1.05, '#c8323c')
    + sparkle(29.4, 8.4, 2.8) + sparkle(72.4, 6.4, 2.3) + sparkle(51, 6.4, 1.7)
  ),
  // 卓球: 赤×白のスポーツ用ヘアバンド、横にピンポン球のワッペン
  hat_pingpong_band: hat(
    '<path d="M38.4 23.2Q51 26.8 63.8 22.8L64 29Q51 33 38.4 29.4z" fill="#e8424c"/>'
    + '<path d="M38.45 24.9Q51 28.6 63.85 24.5M38.45 27.7Q51 31.4 63.95 27.3" fill="none" stroke="#fff" stroke-width="1"/>'
    + '<circle cx="57.6" cy="27.4" r="3.6" fill="#fff7e8" stroke-width="1.6"/>'
    + '<circle cx="57.6" cy="27.4" r="2.7" fill="none" stroke="#e8424c" stroke-width=".6" stroke-dasharray=".9 .7"/>'
    + '<path d="M56.6 28.6l-1.6 1.6" fill="none" stroke="#b5845a" stroke-width="1.1"/>'
    + '<circle cx="57.3" cy="27.7" r="1.5" fill="#e8424c" stroke-width=".8"/>'
    + '<circle cx="59.2" cy="26" r=".95" fill="#ff9f40" stroke-width=".6"/>'
    + hl('M40.6 25.4Q43.4 26.6 46 27', 1)
  ),
  // ヘアアイロン（UR）: ゆるふわ巻き髪のウィッグ。天使の輪のつや、ヘアアイロンのピン留め、きらめき
  hat_curls: hat(
    '<path d="M35.6 27.6Q32.4 23.4 35 19.6Q34.6 14 39.6 11.4Q42.6 6.2 48 6.6Q51 4.4 54 6.6Q59.4 6.2 62.4 11.4Q67.4 14 67 19.6Q69.6 23.4 66.4 27.6Q70.8 30.4 68.8 34.2Q71.6 37.8 68.8 41.4Q70 45.8 65.8 46.6Q62 46.6 62.2 43Q60.6 40.2 62.6 37.4Q60.8 34.4 62.4 31.2Q60.4 30.8 59.4 28.6Q57 31 54.6 28.8Q51.8 31.2 49 28.8Q46.2 31 43.6 28.6Q41.8 30.6 40.2 29.6Q41.6 32.8 39.8 35.4Q41.6 38.6 39.6 41.6Q40 45.8 36.2 46.6Q32.4 46.4 32.4 42.8Q30.6 39.6 33 36.4Q30.8 33 33.4 30.2Q33.6 28.4 35.6 27.6z" fill="#e0985e"/>'
    // 右側（頭の後ろ）の影
    + '<path d="M58.6 9.4Q60.8 9.9 62.4 11.4Q67.4 14 67 19.6Q69.6 23.4 66.4 27.6Q70.8 30.4 68.8 34.2Q71.6 37.8 68.8 41.4Q70 45.8 65.8 46.6Q67.6 43.4 66 40.8Q68 37.4 66 34.4Q67.4 30.6 63.8 28.6Q65 17 58.6 9.4z" fill="#c47943" stroke="none"/>'
    // 巻きの筋
    + '<path d="M45.4 8.8Q40.8 13.6 42.6 18.8Q44.2 23.4 42.2 27.6M51.4 7.4Q48.4 12.4 50.2 17.4Q51.8 22 49.6 27.6M57.4 9Q55.4 14 57.4 19Q59.2 23.6 57.4 27.4M36.4 31.2Q34.6 33.8 36.2 36.4Q37.8 39 36 41.8M65.6 31.2Q63.8 33.8 65.4 36.4Q67 39 65.2 41.8" fill="none" stroke="#b5683a" stroke-width=".9"/>'
    // 毛先のくるん
    + '<path d="M35 44.4a1.5 1.5 0 1 1 2.3 1M64.8 44.4a1.5 1.5 0 1 0 -2.3 1" fill="none" stroke="#b5683a" stroke-width=".9"/>'
    // 天使の輪
    + hl('M38.8 19.4Q40.4 15.6 43.8 13.8M46.6 12.6Q50.6 11.4 54.6 12.4', 1.7)
    + hl('M33.8 34.4q.2-1.4 1.2-2.2M34 40q.1-1.2 1-2', 1)
    // ヘアアイロンのピン留め（ピンクの持ち手・銀のプレート）
    + '<g transform="rotate(-38 61.4 16.8)">'
    + '<rect x="55.6" y="15.4" width="11.6" height="2.9" rx="1.45" fill="#ff8fbf" stroke-width="1.4"/>'
    + '<path d="M55.7 16.85H61" fill="none" stroke="#d95c97" stroke-width=".6"/>'
    + '<rect x="61" y="15.1" width="6.6" height="3.5" rx="1.2" fill="#e6eaf6" stroke-width="1.3"/>'
    + '<path d="M61.8 16.85h5" fill="none" stroke="#aeb6d4" stroke-width=".6"/>'
    + '<circle cx="57.4" cy="16.85" r=".55" fill="#ff4f6e" stroke="none"/>'
    + '</g>'
    + '<g fill="#fff" stroke="none"><circle cx="44.6" cy="22.4" r=".6"/><circle cx="54.4" cy="20.8" r=".5"/><circle cx="38" cy="25.6" r=".45"/></g>'
    + sparkle(28.8, 16.4, 3.2) + sparkle(73.6, 23.4, 2.7) + sparkle(46, 2.2, 2.1) + sparkle(30.8, 46.4, 1.7)
  ),
  // インタビュー: 片耳ヘッドセット＋口元へ伸びる細いマイク
  hat_headset: hat(
    '<path d="M37.4 26.4C36.4 9 65.6 9 64.6 26" fill="none" stroke-width="4"/>'
    + '<path d="M37.4 26.4C36.4 9 65.6 9 64.6 26" fill="none" stroke="#c3c9ee" stroke-width="2"/>'
    + '<rect x="62.2" y="23.2" width="4.2" height="6.6" rx="1.8" fill="#ffa23a" stroke-width="1.7"/>'
    // マイクのアーム（耳あてから口元へ）
    + '<path d="M36.4 31.4Q36.6 38.6 43.4 39.6" fill="none" stroke-width="3"/>'
    + '<path d="M36.4 31.4Q36.6 38.6 43.4 39.6" fill="none" stroke="#c3c9ee" stroke-width="1.2"/>'
    + '<ellipse cx="44.4" cy="39.6" rx="2.2" ry="1.7" fill="#2a2350" stroke-width="1.2"/>'
    + '<circle cx="43.7" cy="39" r=".45" fill="#8f98bf" stroke="none"/>'
    // 耳あて
    + '<rect x="32.8" y="22.6" width="7.4" height="10" rx="3.2" fill="#5a5f8e"/>'
    + '<circle cx="36.5" cy="27.6" r="2.5" fill="#ffa23a" stroke-width="1.2"/>'
    + '<circle cx="38.6" cy="24.4" r=".7" fill="#ff4f5e" stroke="none"/>'
    + hl('M41 15.8Q44.6 12 50.6 11.6', 0.9)
    + hl('M35.4 27q.2-.9 1.1-1.1', 0.8)
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
  face_heart: face(
    '<path d="M39 36.4L36.2 35.2M54.2 36.4L57 35.2M46.2 35.8Q46.6 35 47 35.8" fill="none" stroke-width="2.6"/>'
    + `<g fill="#ffb3cf" fill-opacity=".6" stroke-width="2.8"><path d="${heartPath(42.6, 37.3, 0.9)}"/><path d="${heartPath(50.6, 37.4, 0.9)}"/></g>`
    + `<g fill="none" stroke="#ff4f8b" stroke-width="1.2"><path d="${heartPath(42.6, 37.3, 0.9)}"/><path d="${heartPath(50.6, 37.4, 0.9)}"/></g>`
    + hl('M40 35.8q.4-1 1.4-1.2', 0.9)
  ),
  face_bandage: face(
    '<g transform="rotate(-24 53.6 40.4)">'
    + '<rect x="48.4" y="38.2" width="10.4" height="4.4" rx="2.2" fill="#f2a46c" stroke-width="1.6"/>'
    + '<rect x="51.8" y="38.8" width="3.6" height="3.2" rx=".7" fill="#fff1e4" stroke="none"/>'
    + '<g fill="#c9784a" stroke="none"><circle cx="50.2" cy="39.8" r=".35"/><circle cx="51" cy="41.1" r=".35"/><circle cx="56.2" cy="39.8" r=".35"/><circle cx="57" cy="41.1" r=".35"/></g>'
    + '</g>'
    + hl('M50 40.4l2.2-1.1', 0.8)
  ),
  face_star: face(
    '<path d="M38.6 36.4L35.8 35.2M54.6 36.4L57.4 35.2" fill="none" stroke-width="2.4"/>'
    + `<g fill="#3a2a78" stroke-width="2.2"><path d="${star(42.6, 37.6, 4.4, 2.15)}"/><path d="${star(50.6, 37.7, 4.4, 2.15)}"/></g>`
    + `<g fill="none" stroke="#ff5ca8" stroke-width="1"><path d="${star(42.6, 37.6, 4.4, 2.15)}"/><path d="${star(50.6, 37.7, 4.4, 2.15)}"/></g>`
    + '<path d="M41.2 37l1.6 1.6M49.2 37.1l1.6 1.6" fill="none" stroke="#9ee7ff" stroke-width="1"/>'
    + '<circle cx="44.2" cy="36" r=".55" fill="#fff" stroke="none"/>'
  ),
  face_eyepatch: face(
    '<path d="M38.4 29.4L47.4 34.8M53.8 39.2L63.4 42" fill="none" stroke-width="2.4"/>'
    + '<path d="M38.4 29.4L47.4 34.8M53.8 39.2L63.4 42" fill="none" stroke="#4a3f6e" stroke-width=".9"/>'
    + '<path d="M46.4 35Q50.2 33 54 35Q54.8 39.6 50.2 41.8Q45.6 39.6 46.4 35z" fill="#2a2350" stroke-width="1.8"/>'
    + '<path d="M48.9 38.3l2.6 1.9M51.5 38.3l-2.6 1.9" fill="none" stroke="#fff" stroke-width=".7"/>'
    + '<circle cx="50.2" cy="37" r="1.05" fill="#fff" stroke="none"/>'
    + hl('M47.6 35.6q1-.8 2.2-.9', 0.7)
  ),
  face_vr: face(
    '<path d="M35.4 37.6L57.8 36.8" fill="none" stroke-width="3.8"/>'
    + '<path d="M35.4 37.6L57.8 36.8" fill="none" stroke="#5a5f86" stroke-width="1.8"/>'
    + '<path d="M39.6 32.2H53.8Q56.4 32.2 56.4 34.8V39.8Q56.4 42.4 53.8 42.4H49.4Q46.6 40.6 43.8 42.4H39.6Q37 42.4 37 39.8V34.8Q37 32.2 39.6 32.2z" fill="#eef0fa" stroke-width="2.2"/>'
    + '<path d="M38.4 34.2Q38.6 33.2 39.8 33.2H53.6Q54.8 33.2 55 34.2z" fill="#c9cde6" stroke="none"/>'
    + '<path d="M39.8 34.6H53.6Q54.6 34.6 54.6 35.6V38.8Q54.6 39.8 53.6 39.8H39.8Q38.8 39.8 38.8 38.8V35.6Q38.8 34.6 39.8 34.6z" fill="#2b2f5c" stroke="none"/>'
    + '<path d="M41.6 39.8L46.4 34.6H49.2L44.4 39.8z" fill="#7b6fe0" stroke="none" opacity=".7"/>'
    + '<path d="M40.8 38.6H52.6" fill="none" stroke="#5fe3f0" stroke-width=".8"/>'
    + '<g fill="#5fe3f0" stroke="none"><circle cx="52.4" cy="35.9" r=".55"/><circle cx="50.8" cy="35.9" r=".55"/></g>'
    + hl('M42.6 36.6l1.4-1.4', 1)
    + sparkle(57.8, 31, 1.7, '#fff')
  ),
  face_tengu: face(
    // 頭襟（ときん）
    '<path d="M44.4 30.2L44.8 26.6L46.6 25.4L48.4 26.6L48.8 30.2z" fill="#2a2350" stroke-width="1.5"/>'
    + '<path d="M38.2 41.4L37.6 32Q38 29 41 29.8Q46.6 28.4 52.2 29.8Q55.2 29 55.6 32L55 41.4Q52.2 45.8 46.6 47.2Q41 45.8 38.2 41.4z" fill="#e0454b" stroke-width="2.2"/>'
    + '<path d="M52.4 31Q54.6 31.4 54.4 34.6L53.8 41Q51.6 44.6 48.6 46.2Q52.4 41 52.4 31z" fill="#c4333d" stroke="none"/>'
    // 白い太まゆ
    + '<path d="M38.8 33.4Q41.6 31.4 45.6 33.8L45.2 35.4Q42 33.8 39.4 35z" fill="#fbfbff" stroke-width="1.1"/>'
    + '<path d="M54.4 33.4Q51.6 31.4 47.6 33.8L48 35.4Q51.2 33.8 53.8 35z" fill="#fbfbff" stroke-width="1.1"/>'
    + '<g fill="#ffd040" stroke-width="1"><circle cx="42.6" cy="37.2" r="1.5"/><circle cx="50.6" cy="37.4" r="1.5"/></g>'
    + `<g fill="${INK}" stroke="none"><circle cx="42.4" cy="37.3" r=".65"/><circle cx="50.4" cy="37.5" r=".65"/></g>`
    // 長い鼻（左に突き出す）
    + '<path d="M47.4 38.6Q41 37.8 34.4 39.4Q32.6 40.6 34.6 41.8Q41 43 47.6 42.4z" fill="#e8555b" stroke-width="1.8"/>'
    + '<path d="M44.6 39.2Q39.6 38.8 35.6 39.8" fill="none" stroke="#fff" stroke-width=".8" opacity=".9"/>'
    + '<path d="M43.4 44.6Q46.6 43.4 49.8 44.6" fill="none" stroke-width="1.2"/>'
    + '<circle cx="41.2" cy="37" r=".4" fill="#fff" stroke="none"/>'
    + sparkle(59.6, 30.4, 1.8, '#fff')
  ),
  // ヘアアイロン: 前髪を留めるパッチンクリップ2つ（ピンクとミント）
  face_hairclip: face(
    '<g transform="translate(50.6 31.4) scale(1.32) translate(-50.1 -32.4)">'
    + [[48.4, 31.2, '#ff8fbf', '#d95c97'], [51.8, 33.6, '#7fdcc4', '#3fae8e']].map(([x, y, c, d]) => `<g transform="rotate(-24 ${x} ${y})">`
      + `<path d="M${n(x - 4)} ${y}Q${n(x - 4)} ${n(y - 1.5)} ${n(x - 2.4)} ${n(y - 1.5)}L${n(x + 3.4)} ${n(y - 0.7)}Q${n(x + 4.2)} ${y} ${n(x + 3.4)} ${n(y + 0.7)}L${n(x - 2.4)} ${n(y + 1.5)}Q${n(x - 4)} ${n(y + 1.5)} ${n(x - 4)} ${y}z" fill="${c}" stroke-width="1.3"/>`
      + `<path d="M${n(x - 2.4)} ${y}L${n(x + 2.4)} ${y}" fill="none" stroke="${d}" stroke-width=".8"/>`
      + `<circle cx="${n(x - 2.6)}" cy="${n(y - 0.5)}" r=".5" fill="#fff" stroke="none"/>`
      + '</g>').join('')
    + '</g>'
  ),
  // ダーツ（UR）: レンズがダーツの的になった金ぶちのゴーグル。右のレンズにダーツが刺さる
  face_bullseye: face(
    '<path d="M35.4 37.4L57.8 36.8" fill="none" stroke-width="3.6"/>'
    + '<path d="M35.4 37.4L57.8 36.8" fill="none" stroke="#5a5f86" stroke-width="1.8"/>'
    + '<path d="M45.4 36.4Q46.6 35.4 47.8 36.4" fill="none" stroke-width="3"/>'
    + '<path d="M45.4 36.4Q46.6 35.4 47.8 36.4" fill="none" stroke="#ffd040" stroke-width="1.2"/>'
    + [[41.6, 37.2], [51.6, 37.2]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke-width="3.4"/>${dartboard(x, y, 4.2)}<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke="#ffd040" stroke-width="1.3"/>`).join('')
    + hl('M38.8 36.4q.5-1.8 2-2.4', 0.9)
    // 右のレンズに刺さったダーツ（先・胴・羽根）
    + '<g transform="rotate(-40 52.2 37)">'
    + '<path d="M52.2 37L55 36.4V37.6z" fill="#e6eaf6" stroke-width="1"/>'
    + '<rect x="54.8" y="35.8" width="4.4" height="2.4" rx="1" fill="#c9cfe8" stroke-width="1.2"/>'
    + '<path d="M56.2 36v2M57.6 36v2" fill="none" stroke="#7d86ad" stroke-width=".55"/>'
    + '<rect x="59" y="36.4" width="2.2" height="1.2" fill="#4fb8ef" stroke-width=".9"/>'
    + '<path d="M60.6 37L64 33.2L65.8 33.6L64.2 37L65.8 40.4L64 40.8z" fill="#ff5c9a" stroke-width="1.2"/>'
    + '<path d="M61.6 37H64.6" fill="none" stroke="#fff" stroke-width=".6"/>'
    + '</g>'
    + sparkle(36.4, 31.6, 2.6) + sparkle(62.6, 39.6, 2.1) + sparkle(47, 31.6, 1.4, '#fff')
  ),
  // インタビュー（SR）: 口元へ差し出されたハンドマイク（銀の網・金の輪・無地の角形フラッグ。文字は入れない）
  face_mic: face(
    '<g transform="translate(43.2 45) rotate(42) scale(1.2) translate(-43.4 -45.4)">'
    + '<path d="M41.8 48.6L42.6 60.4Q43.4 61.4 44.2 60.4L45 48.6z" fill="#3b3560" stroke-width="1.8"/>'
    + '<path d="M44.2 50L43.8 59.6" fill="none" stroke="#6f69a6" stroke-width=".7"/>'
    + '<rect x="40.2" y="50.4" width="6.4" height="4.8" rx=".7" fill="#e8424c" stroke-width="1.3"/>'
    + '<path d="M41 51.5H45.8" fill="none" stroke="#ff9a9e" stroke-width=".8"/>'
    + '<path d="M45.6 51.6V54.4" fill="none" stroke="#b52d3f" stroke-width=".8"/>'
    + '<rect x="41.2" y="47.4" width="4.4" height="1.8" rx=".6" fill="#ffd040" stroke-width="1.2"/>'
    + '<circle cx="43.4" cy="45.4" r="3" fill="#dfe4f2" stroke-width="1.5"/>'
    + '<path d="M41.1 44.4Q43.4 43.6 45.7 44.4M41.1 46.4Q43.4 47.2 45.7 46.4M42.3 43.1Q42 45.4 42.3 47.7M44.5 43.1Q44.8 45.4 44.5 47.7" fill="none" stroke="#8f98bf" stroke-width=".55"/>'
    + '<path d="M45.6 47.6A3 3 0 0 1 41 47.6A2.6 2.6 0 0 0 45.6 47.6z" fill="#aeb6d4" stroke="none"/>'
    + hl('M41.2 44.4q.4-1.4 1.8-1.8', 0.9)
    + '</g>'
    + sparkle(39.2, 41.4, 1.6, '#fff') + sparkle(32.4, 45.8, 1.8)
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
  neck_star: neck(starNecklace()),
  neck_bandana: neck(
    '<path d="M42.4 45.2Q50.8 50.2 59 44.6L50.8 58.6z" fill="#e8505e"/>'
    + '<g fill="#fff" stroke="none"><circle cx="47.4" cy="49.4" r=".9"/><circle cx="54" cy="49" r=".9"/><circle cx="50.6" cy="53.6" r=".9"/><circle cx="44.8" cy="47.4" r=".5"/><circle cx="56.8" cy="47" r=".5"/><circle cx="50.8" cy="50.4" r=".5"/></g>'
    + '<path d="M40.8 42.6Q50.6 47.6 60.6 42L61.2 45.4Q51 51.2 40.4 45.8z" fill="#d63c4c"/>'
    + hl('M43.2 45.2Q46.4 47 49.6 47.4', 1)
  ),
  neck_whistle: neck(
    '<path d="M41.6 43.4Q50.4 54.2 59.4 42.8" fill="none" stroke-width="2.2"/>'
    + '<path d="M41.6 43.4Q50.4 54.2 59.4 42.8" fill="none" stroke="#4f8de0" stroke-width="1"/>'
    + '<circle cx="50.4" cy="49.6" r="1.1" fill="none" stroke-width="1"/>'
    + '<path d="M50.4 51.2H57.2Q58.4 51.2 58.4 52.4V53.4Q58.4 54.6 57.2 54.6H52.4z" fill="#dfe4f2" stroke-width="1.6"/>'
    + '<circle cx="49.6" cy="55" r="3.9" fill="#dfe4f2" stroke-width="1.8"/>'
    + '<path d="M52.6 57.2A3.9 3.9 0 0 1 46.4 57.2A3.4 3.4 0 0 0 52.6 57.2z" fill="#aeb6d4" stroke="none"/>'
    + `<rect x="51.8" y="51.6" width="2.2" height="1.2" rx=".3" fill="${INK}" stroke="none"/>`
    + hl('M47 54q.4-1.4 1.8-1.8', 1)
  ),
  neck_school: neck(
    '<path d="M42.8 43L49.4 46.2L46.2 49.8z" fill="#fbfcff" stroke-width="1.6"/>'
    + '<path d="M58.4 42.4L51.8 46L54.8 49.4z" fill="#fbfcff" stroke-width="1.6"/>'
    + '<path d="M49.3 48.4H51.9L53.8 58.4L50.6 61.6L47.4 58.4z" fill="#d64553" stroke-width="1.7"/>'
    + '<path d="M48.7 52.6L52.4 51.2M48.1 55.8L53 54M47.9 58.6L53.3 56.6" fill="none" stroke="#ffd2d6" stroke-width=".9"/>'
    + '<path d="M48.6 45.2H52.6L51.9 48.6H49.3z" fill="#c23646" stroke-width="1.6"/>'
    + hl('M48.6 51.6l.4 3', 0.8)
  ),
  neck_lei: neck(lei()),
  neck_cape: neck(cape({
    cloth: '#e0414f', shade: '#b52d3f', trim: '#ffd36a', lining: '#ffd36a',
    clasp: '<circle cx="50.6" cy="49" r="2.8" fill="#ffd040" stroke-width="1.5"/>'
      + '<circle cx="50.6" cy="49" r="1.5" fill="#4fb8ef" stroke-width=".8"/>'
      + '<circle cx="50.1" cy="48.5" r=".45" fill="#fff" stroke="none"/>'
      + sparkle(54.6, 46.4, 1.6, '#fff')
  })),
  neck_furin: neck(cape({
    cloth: '#2a3f9a', shade: '#1f2f78', trim: '#ffd040', lining: '#ffd040',
    clasp: '<circle cx="50.6" cy="49" r="3" fill="#ffd040" stroke-width="1.5"/>'
      + takedaBishi(50.6, 49, 0.82, '#c8323c')
      // 風・林・火・山の4文字を、金の小さな紋様として左右の布に2つずつ
      + [[35.2, 55.6], [33.6, 60.6], [65.8, 55.6], [67.4, 60.6]].map(([x, y]) => `<g fill="none" stroke="#ffd040" stroke-width=".7"><rect x="${n(x - 1.3)}" y="${n(y - 1.4)}" width="2.6" height="2.8" rx=".3"/><path d="M${n(x - 1.3)} ${y}H${n(x + 1.3)}M${x} ${n(y - 1.4)}V${n(y + 1.4)}"/></g>`).join('')
      + sparkle(26, 56, 2.2) + sparkle(75.4, 52, 1.9) + sparkle(55.6, 45.6, 1.4)
  })),
  // 麻雀: 赤いひもに牌を5つ（二筒・索子・中・一筒・索子）
  neck_mahjong: neck((() => {
    const P = [[41.4, 43.6], [50.5, 53.4], [59.6, 43]];
    let s = '<path d="M41.4 43.6Q50.5 53.4 59.6 43" fill="none" stroke-width="2"/>'
      + '<path d="M41.4 43.6Q50.5 53.4 59.6 43" fill="none" stroke="#e8424c" stroke-width=".9"/>';
    const tiles = [[0.15, 3.4, 4.4, mjPin2], [0.32, 3.4, 4.4, mjSou], [0.5, 4.4, 5.6, mjChun], [0.68, 3.4, 4.4, mjPin1], [0.85, 3.4, 4.4, mjSou]];
    for (const [t, w, h, f] of tiles) {
      const [x, y] = qpt(...P, t);
      const dx = 2 * (1 - t) * (P[1][0] - P[0][0]) + 2 * t * (P[2][0] - P[1][0]);
      const dy = 2 * (1 - t) * (P[1][1] - P[0][1]) + 2 * t * (P[2][1] - P[1][1]);
      s += mjTile(x, y, (Math.atan2(dy, dx) * 180) / Math.PI, w, h, f);
    }
    return s;
  })()),
  // ダーツ: 細い銀のチェーンにダーツの矢のチャーム（先が下）
  neck_dart: neck(
    '<path d="M41.6 43.6Q50.4 54 59.4 43" fill="none" stroke-width="1.8"/>'
    + '<path d="M41.6 43.6Q50.4 54 59.4 43" fill="none" stroke="#e6eaf6" stroke-width=".8" stroke-dasharray="1.1 .6"/>'
    + '<g transform="translate(50.4 48.8) rotate(10) scale(1.2) translate(-50.4 -48.8)">'
    + '<circle cx="50.4" cy="48.8" r="1.1" fill="none" stroke-width=".9"/>'
    + '<path d="M50.4 50L53.2 51.6L52.8 54.8L50.4 53.8L48 54.8L47.6 51.6z" fill="#ff5c7a" stroke-width="1.2"/>'
    + '<path d="M50.4 50.4V53.6" fill="none" stroke="#ffd2dc" stroke-width=".7"/>'
    + '<rect x="49.95" y="53.8" width=".9" height="2.2" fill="#4fb8ef" stroke-width=".7"/>'
    + '<rect x="49.3" y="55.8" width="2.2" height="4" rx=".9" fill="#c9cfe8" stroke-width="1.1"/>'
    + '<path d="M49.5 57.2h1.8M49.5 58.5h1.8" fill="none" stroke="#7d86ad" stroke-width=".5"/>'
    + '<path d="M49.9 59.8H50.9L50.4 62.8z" fill="#e6eaf6" stroke-width=".9"/>'
    + '</g>'
  ),
  // 体を動かすゲーム（UR）: 白いリモコンを首から下げ、振った軌跡（汎用の白いリモコン。商標・ロゴ・固有の意匠は入れない）
  neck_remote: neck(
    '<path d="M42 44Q46 48.6 50.4 50.4Q55 48.4 59 43.4" fill="none" stroke-width="2.4"/>'
    + '<path d="M42 44Q46 48.6 50.4 50.4Q55 48.4 59 43.4" fill="none" stroke="#4fb8ef" stroke-width="1.1"/>'
    // 軌跡
    + '<path d="M60.4 56.6Q58.6 61.2 55.2 63M63 54.4Q61.2 61.6 55.6 65.4M57.6 58Q56.6 60.6 54.6 61.6" fill="none" stroke="#fff" stroke-width="2.6" opacity=".9"/>'
    + '<path d="M60.4 56.6Q58.6 61.2 55.2 63M63 54.4Q61.2 61.6 55.6 65.4M57.6 58Q56.6 60.6 54.6 61.6" fill="none" stroke="#8fd8f0" stroke-width="1.2"/>'
    + '<rect x="48" y="51" width="4.8" height="11.6" rx="2.1" transform="rotate(-28 50.4 50.4)" fill="#fff" fill-opacity=".45" stroke="#8fd8f0" stroke-width="1" stroke-dasharray="1.6 1"/>'
    + wand(50.4, 50.4, 18)
    + '<circle cx="50.4" cy="50.4" r="1.1" fill="#4fb8ef" stroke-width=".9"/>'
    + sparkle(62.6, 63.4, 2.4) + sparkle(38.4, 54.4, 2) + sparkle(65.4, 49, 1.5)
  ),
  // パーソナルカラー診断（SR）: 首元にかける診断ドレープ。春・夏・秋・冬の4色が扇形に重なる
  neck_drape: neck((() => {
    const cx = 50.5;
    const cy = 45;
    const R = 13.4;
    const blades = [[150, '#ff9e7d', '#ffc7b0'], [116, '#a9b8f2', '#d6defb'], [82, '#c8873a', '#e6b072'], [48, '#d6337f', '#f27bb0']];
    let s = '';
    for (const [deg, c, lite] of blades) {
      const a = (deg * Math.PI) / 180;
      const h = (21 * Math.PI) / 180;
      s += `<path d="M${polar(cx, cy, 2, a - h)}L${polar(cx, cy, R, a - h)}Q${polar(cx, cy, R + 1.6, a)} ${polar(cx, cy, R, a + h)}L${polar(cx, cy, 2, a + h)}z" fill="${c}" stroke-width="1.5"/>`
        + `<path d="M${polar(cx, cy, 5, a + h * 0.45)}L${polar(cx, cy, R - 1.4, a + h * 0.55)}" fill="none" stroke="${lite}" stroke-width="1"/>`;
    }
    return s
      + '<path d="M41.4 43.4Q50.6 49.4 59.6 42.8L60.2 46Q50.6 52.6 40.8 46.6z" fill="#fbfcff" stroke-width="1.7"/>'
      + '<path d="M42 45.2Q50.6 50.8 59.8 44.6" fill="none" stroke="#c9cde6" stroke-width=".7"/>'
      + '<rect x="48.6" y="47" width="4.2" height="3.4" rx="1" fill="#dfe4f2" stroke-width="1.3"/>'
      + '<path d="M49.4 48.7h2.6" fill="none" stroke="#8f98bf" stroke-width=".6"/>'
      + '<circle cx="49.6" cy="47.9" r=".45" fill="#fff" stroke="none"/>'
      + sparkle(54.8, 46.2, 1.6, '#fff') + sparkle(64.4, 57.8, 1.9);
  })())
};

export function renderAccessory(item, slot) {
  if (!item || typeof item.id !== 'string' || !item.id.startsWith(`${slot}_`) || !Object.hasOwn(parts, item.id)) return '';
  return `<svg class="miacis-part miacis-part-${slot}" aria-hidden="true" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;overflow:visible"><g stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${parts[item.id]}</g></svg>`;
}

// ===== 背景（台座の円の中の小さな風景） =====
// 平塗り中心。相棒（黄色と紺）が前に出るよう、真ん中は明るめにし、黄色の面は避ける。
const cloud = (x, y, s, fill = '#fff') => `<path d="M${n(x - 9 * s)} ${n(y)}a${n(4 * s)} ${n(4 * s)} 0 0 1 ${n(4 * s)} ${n(-4 * s)}a${n(5 * s)} ${n(5 * s)} 0 0 1 ${n(9 * s)} ${n(-2 * s)}a${n(4 * s)} ${n(4 * s)} 0 0 1 ${n(5 * s)} ${n(6 * s)}z" fill="${fill}"/>`;
const dots = (list, fill, r = 0.8) => list.map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr || r}" fill="${fill}"/>`).join('');

// ---- 背景: Miacis の遊び（麻雀・ダーツ・ゲーム大会・インタビュー）の部品（帽子の mjTile・dartboard とは別物） ----
/** 中心 (cx, cy) から放射状に伸びる光（背景用。オーラの rays と同じ形） */
function bgBurst(cx, cy, count, inner, outer, width, fill, opacity) {
  const p = (r, t) => `${n(cx + r * Math.cos(t))} ${n(cy + r * Math.sin(t))}`;
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    d += `M${p(inner, a)}L${p(outer, a - width / 2)}L${p(outer, a + width / 2)}z`;
  }
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

const BG_MJ_BACK = '#3f7fe0';
/** 表向きの麻雀牌（左上 (x, y)、幅 6.2・高さ 8.2。下に背の色の厚み）。kind: chun 中 / hatsu 發 / haku 白 / pin 一筒 */
function bgTile(x, y, kind) {
  const cx = x + 3.1;
  const cy = y + 4.1;
  const P = (dx, dy) => `${n(cx + dx)} ${n(cy + dy)}`;
  const mark = {
    chun: `<path d="M${P(-1.8, -1.4)}h3.6v2.5h-3.6zM${P(0, -3)}V${n(cy + 3)}" fill="none" stroke="#e23a44" stroke-width="1"/>`,
    hatsu: `<path d="M${P(-2, -2.2)}h4M${P(-1.1, -3.1)}l-.9 1.6M${P(1.1, -3.1)}l.9 1.6M${P(-2, -0.5)}h1.6v3h-1.6M${P(0.4, -0.5)}l1.6 3.1M${P(2, -0.5)}l-1.6 3.1" fill="none" stroke="#17944c" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"/>`,
    haku: `<rect x="${n(cx - 2)}" y="${n(cy - 2.8)}" width="4" height="5.6" rx=".5" fill="none" stroke="${BG_MJ_BACK}" stroke-width=".7"/>`,
    pin: `<circle cx="${n(cx)}" cy="${n(cy)}" r="2.3" fill="#fff" stroke="#2f6fd0" stroke-width=".7"/><circle cx="${n(cx)}" cy="${n(cy)}" r="1.3" fill="#e23a44"/><circle cx="${n(cx)}" cy="${n(cy)}" r=".45" fill="#fff"/>`
  }[kind];
  return `<rect x="${n(x)}" y="${n(y + 1.6)}" width="6.2" height="8.2" rx="1.1" fill="${BG_MJ_BACK}" stroke="${INK}" stroke-width=".7"/>`
    + `<rect x="${n(x)}" y="${n(y)}" width="6.2" height="8.2" rx="1.1" fill="#fffaf0" stroke="${INK}" stroke-width=".7"/>${mark}`;
}

/** 伏せた牌の山（左上 (x, y) から count 枚を横に並べる。手前に牌の白い腹） */
function bgWall(x, y, count) {
  const w = count * 4.4;
  let d = '';
  for (let i = 1; i < count; i++) d += `M${n(x + i * 4.4)} ${n(y + 0.6)}v4.2`;
  return `<rect x="${n(x)}" y="${n(y + 1.4)}" width="${n(w)}" height="5.4" rx="1" fill="#f6ead0" stroke="${INK}" stroke-width=".7"/>`
    + `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="5.4" rx="1" fill="${BG_MJ_BACK}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="${d}" fill="none" stroke="#2a5cb8" stroke-width=".6"/>`
    + `<path d="M${n(x + 1.2)} ${n(y + 1.3)}H${n(x + w - 1.2)}" fill="none" stroke="#a8ccff" stroke-width=".6" stroke-linecap="round"/>`;
}

/** さいころ（中心 (x, y)、rot 度。pips は [dx, dy, 色] の目） */
const bgDie = (x, y, rot, pips) => `<g transform="rotate(${rot} ${x} ${y})"><rect x="${n(x - 2.4)}" y="${n(y - 2.4)}" width="4.8" height="4.8" rx="1.1" fill="#fff" stroke="${INK}" stroke-width=".7"/>`
  + pips.map(([dx, dy, c]) => `<circle cx="${n(x + dx)}" cy="${n(y + dy)}" r="${c ? 0.9 : 0.5}" fill="${c || INK}"/>`).join('') + '</g>';

/** 壁のダーツボード（中心 (x, y)、半径 r） */
function bgDartboard(x, y, r) {
  const p = (rr, a) => `${n(x + rr * Math.cos(a))} ${n(y + rr * Math.sin(a))}`;
  const seg = (r0, r1, a0, a1) => `M${p(r0, a0)}L${p(r1, a0)}A${n(r1)} ${n(r1)} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}${r0 > 0 ? `A${n(r0)} ${n(r0)} 0 0 0 ${p(r0, a0)}` : ''}z`;
  const paint = { dark: '', light: '', red: '', green: '' };
  for (let i = 0; i < 20; i++) {
    const a0 = ((i - 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
    const a1 = a0 + Math.PI / 10;
    paint[i % 2 ? 'light' : 'dark'] += seg(0, r * 0.8, a0, a1);
    paint[i % 2 ? 'green' : 'red'] += seg(r * 0.8, r * 0.92, a0, a1) + seg(r * 0.47, r * 0.58, a0, a1);
  }
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#1c1840" stroke="${INK}" stroke-width=".9"/>`
    + `<path d="${paint.dark}" fill="#2e2a52"/><path d="${paint.light}" fill="#f6e8c8"/><path d="${paint.red}" fill="#ec4452"/><path d="${paint.green}" fill="#2fb06c"/>`
    + `<circle cx="${x}" cy="${y}" r="${n(r * 0.15)}" fill="#2fb06c"/><circle cx="${x}" cy="${y}" r="${n(r * 0.07)}" fill="#ec4452"/>`
    + `<path d="M${p(r * 0.96, -2.6)}A${n(r * 0.96)} ${n(r * 0.96)} 0 0 1 ${p(r * 0.96, -1.9)}" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".7"/>`;
}

/** 刺さった矢（先 (x, y) から ang 度の向きに手前へ伸びる。flight は羽の色） */
function bgDart(x, y, ang, len, flight) {
  const t = (ang * Math.PI) / 180;
  const ux = Math.cos(t);
  const uy = Math.sin(t);
  const P = (d, s = 0) => `${n(x + ux * d - uy * s)} ${n(y + uy * d + ux * s)}`;
  return `<path d="M${P(0.3)}L${P(len * 0.66)}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
    + `<path d="M${P(0.5)}L${P(len * 0.3)}" fill="none" stroke="#e4e9f4" stroke-width="1" stroke-linecap="round"/>`
    + `<path d="M${P(len * 0.3)}L${P(len * 0.64)}" fill="none" stroke="#9aa6c8" stroke-width="1.4"/>`
    + `<path d="M${P(len * 0.6)}L${P(len, -2.4)}L${P(len * 0.9)}L${P(len, 2.4)}z" fill="${flight}" stroke="${INK}" stroke-width=".7" stroke-linejoin="round"/>`;
}

/** ネオン管（にじんだ光の太線＋色の芯＋白い芯） */
const bgNeon = (d, c) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="4" opacity=".28" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="${d}" fill="none" stroke="#fff" stroke-width=".5" opacity=".85" stroke-linecap="round" stroke-linejoin="round"/>`;

/** ボウリングのピン（下の中心 (x, y)、高さ h） */
function bgPin(x, y, h) {
  const s = h / 10;
  const P = (dx, dy) => `${n(x + dx * s)} ${n(y + dy * s)}`;
  return `<path d="M${P(-1.1, 0)}C${P(-2.3, -2.4)} ${P(-2.1, -4.6)} ${P(-0.9, -6.2)}C${P(-0.6, -6.8)} ${P(-1.4, -7.8)} ${P(-1.1, -8.8)}A${n(1.15 * s)} ${n(1.15 * s)} 0 0 1 ${P(1.1, -8.8)}C${P(1.4, -7.8)} ${P(0.6, -6.8)} ${P(0.9, -6.2)}C${P(2.1, -4.6)} ${P(2.3, -2.4)} ${P(1.1, 0)}z" fill="#fff" stroke="${INK}" stroke-width="${n(Math.max(0.5, 0.11 * h))}" stroke-linejoin="round"/>`
    + `<path d="M${P(-0.8, -6.5)}L${P(0.8, -6.5)}M${P(-0.95, -7.3)}L${P(0.95, -7.3)}" fill="none" stroke="#e23a44" stroke-width="${n(0.45 * s)}"/>`;
}

/** 風船（中心 (x, y)、半径 r。ひもは (tx, ty) まで） */
const bgBalloon = (x, y, r, fill, tx, ty) => `<path d="M${x} ${n(y + r * 1.15)}Q${n(x - 2)} ${n((y + ty) / 2 + 2)} ${tx} ${ty}" fill="none" stroke="#b9a0c8" stroke-width=".8"/>`
  + `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${n(r * 1.15)}" fill="${fill}"/>`
  + `<path d="M${n(x - 1)} ${n(y + r * 1.25)}h2l-1-1.2z" fill="${fill}"/>`
  + `<ellipse cx="${n(x - r * 0.4)}" cy="${n(y - r * 0.45)}" rx="${n(r * 0.22)}" ry="${n(r * 0.34)}" transform="rotate(25 ${n(x - r * 0.4)} ${n(y - r * 0.45)})" fill="#fff" opacity=".75"/>`;

/** 紙吹雪（[x, y, 回転, 色] の小さな紙） */
const bgConfetti = (list) => list.map(([x, y, rot, c]) => `<rect x="${n(x - 1.3)}" y="${n(y - 0.7)}" width="2.6" height="1.4" rx=".3" transform="rotate(${rot} ${x} ${y})" fill="${c}"/>`).join('');

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
    + sparkle(88, 12, 2.2, '#fff'),

  // --- 韮崎とその周り ---
  bg_kamanashi: '<rect width="100" height="100" fill="#cdeafa"/>'
    + '<circle cx="50" cy="44" r="38" fill="#e0f3fc"/>'
    + cloud(80, 22, 0.8) + cloud(22, 30, 0.6)
    // 南アルプスの山なみ
    + '<path d="M0 56L10 46L18 50L30 36L40 44L48 40L58 47L70 38L82 47L92 43L100 48V62H0z" fill="#b3c4ec"/>'
    + '<path d="M26.6 40.2L30 36L33.4 39.4L31.6 38.6L30 40L28.4 38.8zM66.8 41.4L70 38L73.2 40.6L71.6 40L70 41.2L68.4 40.2z" fill="#fff"/>'
    + '<path d="M0 60Q50 55 100 59V64H0z" fill="#a8d890"/>'
    // 釜無川
    + '<rect y="63" width="100" height="12" fill="#8fd2f0"/>'
    + '<path d="M8 67h9M28 70.4h11M62 67h8M80 70.6h10M46 68.4h6" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>'
    // 土手と上の道
    + '<path d="M0 82L100 73V100H0z" fill="#88c972"/>'
    + '<path d="M0 79.6L100 70.6V74L0 83z" fill="#f2e2bb"/>'
    + '<path d="M0 92Q50 86 100 89V100H0z" fill="#6fb35e"/>'
    + dots([[12, 88], [30, 84, 0.9], [70, 82], [86, 80, 0.9], [78, 94]], '#fff', 1),

  bg_classroom: '<rect width="100" height="100" fill="#fbe6d0"/>'
    // 夕方の窓
    + '<rect x="66" y="12" width="40" height="48" fill="#ffc7a2"/>'
    + '<rect x="66" y="12" width="40" height="18" fill="#ffb3a6"/>'
    + '<circle cx="92" cy="50" r="6" fill="#ff9f7a"/>'
    + '<path d="M66 12h40M66 60h40M66 12v48M85 12v48M66 36h40" fill="none" stroke="#fff" stroke-width="2.2"/>'
    + '<path d="M66 60L52 78H76L100 60z" fill="#ffd9b8" opacity=".55"/>'
    // 黒板
    + '<rect x="-4" y="16" width="42" height="32" rx="1.4" fill="#3f7d63" stroke="#b5845a" stroke-width="2.4"/>'
    + '<rect x="-4" y="48" width="42" height="2.4" fill="#b5845a"/>'
    + '<path d="M6 24h12M6 29.4h18M6 34.8h9M24 34.8l3 3 5-6" fill="none" stroke="#e9f5ee" stroke-width="1.3" stroke-linecap="round"/>'
    + '<rect x="12" y="48.6" width="5" height="1.2" rx=".6" fill="#fff"/>'
    // 時計
    + '<circle cx="50" cy="8" r="4.4" fill="#fff" stroke="#b5845a" stroke-width="1.4"/>'
    + '<path d="M50 5.4V8l1.8 1.2" fill="none" stroke="#6b5a7a" stroke-width=".9" stroke-linecap="round"/>'
    // 腰板と床
    + '<rect y="68" width="100" height="10" fill="#f2d3b0"/>'
    + '<rect y="78" width="100" height="22" fill="#e2b98a"/>'
    + '<path d="M0 85h100M0 92.6h100M24 78v7M62 85v7.6M38 92.6V100M84 78v7" fill="none" stroke="#cfa274" stroke-width=".9"/>',

  bg_yatsu: '<rect width="100" height="100" fill="#cfe4ff"/>'
    + '<rect y="28" width="100" height="30" fill="#dfeaff"/>'
    + '<rect y="42" width="100" height="18" fill="#ffe4d8"/>'
    // 朝日と光
    + '<circle cx="18" cy="47" r="15" fill="#fff3e6" opacity=".55"/><circle cx="18" cy="47" r="10" fill="#fff3e6" opacity=".8"/><circle cx="18" cy="47" r="6.4" fill="#fffaf4"/>'
    // 八ヶ岳のぎざぎざの峰
    + '<path d="M-4 62L6 52L12 55L20 42L25 47L32 36L37 43L44 32L50 40L56 34L62 41L70 37L77 46L86 42L94 50L104 52V70H-4z" fill="#8f9fdc"/>'
    + '<path d="M17.8 45.6L20 42L22.6 45L21 44.4L19.6 45.8zM29.6 39.8L32 36L34.8 40L33.2 39.2L31.6 40.6zM41.4 36.2L44 32L47 36.6L45.2 35.6L43.6 37.2zM53.8 37.2L56 34L58.6 37.4L57 36.8L55.6 38zM67.6 39L70 37L72.6 40.4L71 39.6L69.6 40.6z" fill="#fff"/>'
    // すその朝もや
    + '<path d="M-4 64Q30 52 60 60T104 56V100H-4z" fill="#b5dd98"/>'
    + '<path d="M-4 62Q30 56 60 62T104 58V63Q70 68 40 64T-4 68z" fill="#fff" opacity=".7"/>'
    + '<path d="M0 80Q50 72 100 78V100H0z" fill="#8fcf7a"/>'
    + '<g fill="#5fae6a"><circle cx="8" cy="78" r="3.4"/><circle cx="13" cy="77" r="2.6"/><circle cx="86" cy="76" r="3.2"/><circle cx="92" cy="77.4" r="2.4"/></g>'
    + dots([[20, 90], [74, 88], [88, 94]], '#fff', 0.9),

  bg_fuji: '<rect width="100" height="100" fill="#bfe2fb"/>'
    + '<circle cx="50" cy="46" r="38" fill="#d2ecfc"/>'
    + cloud(24, 22, 0.9) + cloud(62, 14, 0.55)
    // 富士山
    + '<path d="M50 72L72 44Q79 37.6 86 44L110 72z" fill="#7d9de0"/>'
    + '<path d="M66.8 50.6L72 44Q79 37.6 86 44L91.2 50.6L88.4 49.2L85.6 52L82.4 49.4L79.4 52.4L76.2 49.2L73 52L70 49.4z" fill="#fff"/>'
    + '<path d="M86 44L91.2 50.6L88.4 49.2L86 51.2z" fill="#e3eafc"/>'
    + cloud(92, 66, 0.9, '#f4f9ff')
    + '<path d="M-4 72Q30 63 60 69T104 67V100H-4z" fill="#b9dfa0"/>'
    // 手前の丘と1本の木
    + '<path d="M-4 100V84Q30 72 70 80T104 82V100z" fill="#8cce76"/>'
    + '<path d="M16 80V70" fill="none" stroke="#9a7650" stroke-width="1.8"/>'
    + '<circle cx="16" cy="66" r="6" fill="#5fb36a"/><circle cx="13.6" cy="64" r="2.4" fill="#7fc87a"/>'
    + dots([[30, 88], [52, 92], [80, 90], [90, 96]], '#fff', 1)
    + dots([[40, 94], [66, 96]], '#ffb3cc', 1),

  bg_amari: '<rect width="100" height="100" fill="#cfe9fb"/>'
    + '<circle cx="50" cy="44" r="36" fill="#e0f2fc"/>'
    + cloud(78, 18, 0.7)
    + '<path d="M-4 52Q16 40 36 46T74 38T104 42V62H-4z" fill="#b9c6ee"/>'
    // 甘利山の斜面
    + '<path d="M-4 100V66Q40 48 104 40V100z" fill="#b4df8e"/>'
    + '<path d="M-4 100V82Q50 66 104 60V100z" fill="#99d27a"/>'
    // 朱色のレンゲツツジ（手前ほど大きい株）
    + [[86, 50, 2.6], [72, 56, 3], [94, 62, 3.4], [16, 70, 3.2], [80, 70, 4.4], [6, 84, 4.6], [24, 88, 5.6], [92, 84, 5.4], [66, 90, 5], [44, 96, 4.4]]
      .map(([x, y, r]) => `<circle cx="${n(x - r * 0.6)}" cy="${n(y + r * 0.2)}" r="${n(r * 0.7)}" fill="#ff6a3d"/><circle cx="${n(x + r * 0.6)}" cy="${n(y + r * 0.2)}" r="${n(r * 0.7)}" fill="#ff6a3d"/><circle cx="${x}" cy="${n(y - r * 0.2)}" r="${n(r * 0.8)}" fill="#ff7b4a"/>`
        + `<circle cx="${n(x - r * 0.3)}" cy="${n(y - r * 0.4)}" r="${n(r * 0.26)}" fill="#ffb08a"/><circle cx="${n(x + r * 0.5)}" cy="${n(y)}" r="${n(r * 0.2)}" fill="#ffb08a"/>`).join(''),

  bg_shichiri: '<rect width="100" height="100" fill="#ffc9a0"/>'
    + '<rect width="100" height="30" fill="#f9adaa"/>'
    + '<rect width="100" height="14" fill="#ee98a8"/>'
    + '<rect y="44" width="100" height="16" fill="#ffd8b2"/>'
    // 夕日
    + '<circle cx="24" cy="56" r="13" fill="#ff9a6a" opacity=".4"/><circle cx="24" cy="56" r="9" fill="#ff8a5a"/>'
    + '<path d="M-4 58L12 52L22 55L36 50L50 54L64 49L80 53L104 50V62H-4z" fill="#c99aac"/>'
    // 七里岩: 平らな台地と切り立った崖（縦の割れ目は不ぞろいに）
    + '<path d="M-4 56.6Q50 54.4 104 56V80H-4z" fill="#b57f8c"/>'
    + '<path d="M3 58L6 76L9 76L7 58zM15 57.6L17 70L21 75L19 57.6zM29 57.2L30 66L33 73L33 57.2zM68 57.2L70 72L73 74L71 57.2zM80 57.4L81 64L84 76L85 57.4zM92 57.6L93 70L97 74L95 57.6z" fill="#9d6878"/>'
    + '<path d="M-4 56.6Q4 53 10 55Q14 52.4 20 54.6Q26 52.2 32 54.4Q38 52 44 54Q50 52.2 56 53.8Q62 51.8 68 53.8Q74 52 80 53.8Q86 51.8 92 53.8Q98 52.2 104 55V58Q50 56.2 -4 58.6z" fill="#6f5a86"/>'
    + '<path d="M-4 74Q8 70 18 74Q30 71 40 75L60 75Q70 71 82 74Q92 70 104 73V82H-4z" fill="#c9928e"/>'
    + '<path d="M-4 78Q50 74 104 78V100H-4z" fill="#dba08e"/>'
    + '<path d="M-4 88Q50 84 104 88" fill="none" stroke="#f6c9a8" stroke-width="1.4"/>'
    + dots([[14, 82], [22, 84], [80, 82], [88, 85], [70, 94]], '#ffe6c4', 0.8)
    + dots([[12, 10], [32, 6], [86, 12]], '#fff0e6', 0.7),

  bg_wanizuka: '<rect width="100" height="100" fill="#cfe9fc"/>'
    + '<circle cx="46" cy="40" r="34" fill="#e2f3fd"/>'
    // 奥の八ヶ岳（雪）
    + '<path d="M-4 54L8 45L14 48L24 37L30 42L38 35L46 41L54 33L60 39L68 36L76 43L88 39L104 47V62H-4z" fill="#a3b2e8"/>'
    + '<path d="M21.6 39.8L24 37L27 40.4L25.4 39.6L23.8 41L22.6 40.2zM35.4 37.8L38 35L41 38.2L39.4 37.6L37.8 39zM51.4 35.8L54 33L57 36.4L55.4 35.6L53.8 37zM85.6 40.6L88 39L91.4 41.2L89.6 41L88 42z" fill="#fff"/>'
    // 田んぼ（水が張られて空を映す）
    + '<rect y="58" width="100" height="42" fill="#a9db8e"/>'
    + '<path d="M-4 62H104V66.4H-4zM-4 70H104V76H-4zM-4 80H104V88.4H-4zM-4 92.4H104V100H-4z" fill="#cdeefa"/>'
    + '<path d="M10 73h10M34 84h14M66 95h12" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round"/>'
    // 塚と一本桜
    + '<ellipse cx="78" cy="68.6" rx="15" ry="4.6" fill="#86c46c"/>'
    + '<ellipse cx="78" cy="73.6" rx="10" ry="2" fill="#ffc2d6" opacity=".7"/>'
    + '<path d="M77.4 68L76.6 56M76.8 60Q72 56 69.6 52M77 58.6Q82 55 85 51" fill="none" stroke="#8a5a4e" stroke-width="2.2" stroke-linecap="round"/>'
    + '<circle cx="78" cy="46" r="11" fill="#ffadc8"/><circle cx="68" cy="51.6" r="6.4" fill="#ffadc8"/><circle cx="88" cy="51" r="6.8" fill="#ffadc8"/>'
    + '<circle cx="72.6" cy="42.4" r="5.4" fill="#ffc6d8"/><circle cx="84.6" cy="44" r="4.6" fill="#ff98bb"/><circle cx="80" cy="53" r="4.4" fill="#ff98bb"/>'
    + dots([[74, 40, 1.1], [82, 38, 0.9], [68, 49, 0.9], [88, 48, 1]], '#fff', 1)
    + petal(60, 30, 30, '#ffa8c4') + petal(92, 30, -20, '#ffa8c4') + petal(18, 70, 60, '#ffa8c4') + petal(56, 80, -40, '#ffb8cf')
    + sparkle(90, 18, 2.2, '#fff'),

  bg_festival: '<rect width="100" height="100" fill="#3d48a6"/>'
    + '<circle cx="50" cy="52" r="40" fill="#4a59bc"/>'
    // 花火
    + [[20, 20, 12, '#ff8fc8'], [82, 16, 10, '#8fe8ff'], [72, 42, 6, '#ffb070']].map(([x, y, r, c]) => {
      let d = '';
      let tips = '';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        d += `M${n(x + r * 0.35 * Math.cos(a))} ${n(y + r * 0.35 * Math.sin(a))}L${n(x + r * 0.85 * Math.cos(a))} ${n(y + r * 0.85 * Math.sin(a))}`;
        tips += `<circle cx="${n(x + r * Math.cos(a))}" cy="${n(y + r * Math.sin(a))}" r="${n(Math.max(0.6, r * 0.08))}" fill="${c}"/>`;
      }
      return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(Math.max(0.8, r * 0.1))}" stroke-linecap="round"/>${tips}<circle cx="${x}" cy="${y}" r="${n(r * 0.14)}" fill="#fff"/>`;
    }).join('')
    + dots([[40, 8], [56, 22, 0.6], [8, 44, 0.7], [94, 34, 0.6]], '#fff', 0.8)
    // ちょうちん
    + '<path d="M-4 30Q50 50 104 30" fill="none" stroke="#2a2f6e" stroke-width="1"/>'
    + [[6, 32.4, '#ff5a4f'], [20, 37.6, '#fff1e2'], [34, 40.8, '#ff5a4f'], [66, 40.8, '#fff1e2'], [80, 37.6, '#ff5a4f'], [94, 32.4, '#fff1e2']].map(([x, y, c]) => {
      const cy = y + 5.4;
      return `<circle cx="${x}" cy="${n(cy)}" r="7" fill="#ffb27a" opacity=".3"/>`
        + `<path d="M${x} ${y}v1.4" fill="none" stroke="#2a2f6e" stroke-width=".9"/>`
        + `<ellipse cx="${x}" cy="${n(cy)}" rx="3.6" ry="4.4" fill="${c}"/>`
        + `<path d="M${n(x - 3.3)} ${n(cy - 1.6)}h6.6M${n(x - 3.6)} ${n(cy)}h7.2M${n(x - 3.3)} ${n(cy + 1.6)}h6.6" fill="none" stroke="${c === '#ff5a4f' ? '#d13f44' : '#f0c6a8'}" stroke-width=".6"/>`
        + `<rect x="${n(x - 2)}" y="${n(cy - 5)}" width="4" height="1.4" rx=".4" fill="#2a2f6e"/><rect x="${n(x - 2)}" y="${n(cy + 3.6)}" width="4" height="1.4" rx=".4" fill="#2a2f6e"/>`;
    }).join('')
    // 屋台の屋根
    + '<path d="M0 84Q50 79 100 84V100H0z" fill="#2f3784"/>'
    + '<path d="M-4 82H26L22 88H0zM74 82H104V88H78z" fill="#fff1e2"/>'
    + '<path d="M2 82l-2 6M8 82l-1.6 6M14 82l-1.2 6M20 82l-.8 6M80 82l.8 6M86 82l1.2 6M92 82l1.6 6M98 82l2 6" fill="none" stroke="#ff5a4f" stroke-width="2.4"/>'
    + '<rect x="2" y="90" width="18" height="6" fill="#ffcf9a" opacity=".55"/><rect x="80" y="90" width="18" height="6" fill="#ffcf9a" opacity=".55"/>'
    + sparkle(46, 14, 1.8, '#fff'),

  bg_space: '<rect width="100" height="100" fill="#251f66"/>'
    + '<ellipse cx="28" cy="30" rx="36" ry="20" transform="rotate(-24 28 30)" fill="#8a5ad8" opacity=".5"/>'
    + '<ellipse cx="74" cy="72" rx="36" ry="18" transform="rotate(-28 74 72)" fill="#e06fc4" opacity=".4"/>'
    + '<ellipse cx="50" cy="50" rx="30" ry="36" fill="#6f7cf0" opacity=".45"/>'
    + '<ellipse cx="50" cy="50" rx="20" ry="26" fill="#9aa6ff" opacity=".35"/>'
    // 渦巻き銀河
    + '<circle cx="80" cy="22" r="9" fill="#b9a6ff" opacity=".3"/><circle cx="80" cy="22" r="5" fill="#d6caff" opacity=".45"/>'
    + '<path d="M80 22Q80 16.4 85.4 17.4Q89.6 18.6 88.6 23M80 22Q80 27.6 74.6 26.6Q70.4 25.4 71.4 21M80 22Q85.6 22 84.6 27.4Q83.4 31.4 79 30.6M80 22Q74.4 22 75.4 16.6Q76.6 12.6 81 13.4" fill="none" stroke="#efe9ff" stroke-width="1.1" stroke-linecap="round"/><circle cx="80" cy="22" r="1.9" fill="#fff"/>'
    // 輪のある惑星
    + '<circle cx="18" cy="76" r="7.6" fill="#ff8fae"/>'
    + '<ellipse cx="18" cy="76" rx="13" ry="3.4" transform="rotate(-16 18 76)" fill="none" stroke="#ffe0c4" stroke-width="1.6"/>'
    + '<path d="M10.7 78.1A7.6 7.6 0 0 1 25.3 73.9z" fill="#ff8fae"/>'
    + '<path d="M11.4 72.4Q13 69.6 16.6 68.6" fill="none" stroke="#ffd0dc" stroke-width="1.2" stroke-linecap="round"/>'
    // 流れ星と星
    + '<path d="M62 6L44 16" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".75"/>'
    + dots([[8, 18, 1], [22, 8], [40, 30, 0.6], [12, 50, 0.7], [90, 44, 1], [84, 58, 0.6], [92, 86, 0.8], [56, 92, 0.7], [36, 88, 0.6], [6, 92, 0.6], [62, 30, 0.5], [32, 58, 0.5], [70, 50, 0.5]], '#fff', 0.8)
    + sparkle(36, 14, 2.4, '#fff') + sparkle(90, 72, 2.2, '#fff') + sparkle(12, 36, 1.8, '#fff') + sparkle(66, 88, 1.6, '#fff'),

  // --- Miacis の遊び ---
  // 上から見た雀卓。役満（大三元）が決まった瞬間、真ん中から金の光があふれる
  bg_mahjong: '<rect width="100" height="100" fill="#9a6440"/>'
    + '<rect x="5" y="5" width="90" height="90" rx="11" fill="#c98f5e"/>'
    + '<rect x="8" y="8" width="84" height="84" rx="8.6" fill="#1f7f55"/>'
    + '<circle cx="50" cy="52" r="40" fill="#28925f"/><circle cx="50" cy="52" r="31" fill="#33a36c"/>'
    + bgBurst(50, 52, 18, 8, 41, 0.15, '#ffe27a', 0.5)
    + '<circle cx="50" cy="52" r="26" fill="#fff0a0" opacity=".32"/><circle cx="50" cy="52" r="17" fill="#fff8d6" opacity=".5"/>'
    // 伏せた牌の山（上・左・右。白い腹を卓の内側へ）
    + bgWall(28, 8.6, 10)
    + `<g transform="rotate(-90 12 50)">${bgWall(-10, 47.3, 10)}</g>`
    + `<g transform="rotate(90 88 50)">${bgWall(66, 47.3, 10)}</g>`
    // さいころとリーチ棒
    + bgDie(25, 21, -14, [[0, 0, '#e23a44']]) + bgDie(30.6, 24.6, 10, [[-1.3, -1.3], [0, 0], [1.3, 1.3]])
    + '<g transform="rotate(24 74 22)"><rect x="68" y="21.1" width="12" height="1.8" rx=".9" fill="#fff" stroke="' + INK + '" stroke-width=".6"/><circle cx="74" cy="22" r=".6" fill="#e23a44"/></g>'
    // 倒した手牌: 中中中・發發發。後ろに金の光だまり
    + '<ellipse cx="24" cy="77" rx="15" ry="8" fill="#ffe27a" opacity=".55"/><ellipse cx="76" cy="77" rx="15" ry="8" fill="#ffe27a" opacity=".55"/>'
    + `<g transform="rotate(16 24 76)">${bgTile(14, 71, 'chun') + bgTile(20.6, 71, 'chun') + bgTile(27.2, 71, 'chun')}</g>`
    + `<g transform="rotate(-16 76 76)">${bgTile(66.6, 71, 'hatsu') + bgTile(73.2, 71, 'hatsu') + bgTile(79.8, 71, 'hatsu')}</g>`
    + dots([[18, 62, 0.9], [34, 66, 0.7], [66, 64, 0.8], [84, 62, 0.9], [40, 88, 0.7], [60, 90, 0.8], [16, 40, 0.6], [84, 36, 0.6]], '#fff6c0')
    + sparkle(13, 67, 2.6, '#fff8d0') + sparkle(87, 66, 2.4, '#fff8d0') + sparkle(32, 88, 1.8, '#fff8d0') + sparkle(70, 89, 1.6, '#fff8d0') + sparkle(80, 30, 1.6, '#fff8d0'),

  // ダーツバーの壁。ネオンの光と、ボードに刺さった矢
  bg_dartsbar: '<rect width="100" height="100" fill="#272361"/>'
    + '<circle cx="50" cy="46" r="40" fill="#302c78"/>'
    + '<path d="M14 0V80M30 0V80M70 0V80M86 0V80" fill="none" stroke="#211d56" stroke-width="1.2"/>'
    // ボードのまわりのネオンの輪とボード
    + '<circle cx="82" cy="38" r="15" fill="#4ff0ff" opacity=".1"/>'
    + bgNeon('M67 38a15 15 0 1 0 30 0a15 15 0 1 0-30 0', '#4fe6ff')
    + bgDartboard(82, 38, 11.6)
    + bgDart(82, 38, 200, 8.6, '#ff5fb0') + bgDart(85.4, 33, 230, 8, '#ffe066') + bgDart(84, 43.4, 150, 8, '#4fe6ff')
    // ネオンの矢（左）・ジグザグ（上）・星（左下）
    + bgNeon('M9 54L28 33M22.6 33.4L28 33L27.4 38.4M12.8 49.8l-3.6.5M12.8 49.8l-.2 3.6M15.2 47.2l-3.6.5M15.2 47.2l-.2 3.6', '#ff5fb0')
    + bgNeon('M28 9l3.6 3.6 3.6-3.6 3.6 3.6 3.6-3.6', '#ff5fb0')
    + bgNeon(star(19, 68, 5, 2.3), '#ffe066')
    + dots([[40, 6, 0.6], [6, 34, 0.7], [56, 66, 0.5], [34, 70, 0.6], [94, 62, 0.6]], '#fff', 0.6)
    // カウンター（ネオンが映る）
    + '<path d="M-4 80H104V100H-4z" fill="#5f3a3a"/>'
    + '<rect x="-4" y="78" width="108" height="4" fill="#a2624c"/><path d="M-4 79.2H104" fill="none" stroke="#d68e6c" stroke-width=".9"/>'
    + '<path d="M70 86h12M74 90h6M14 86h10M18 90h4" fill="none" stroke-width="1.2" stroke-linecap="round" opacity=".55" stroke="#4fe6ff"/>'
    + '<path d="M34 87h6M60 88h4" fill="none" stroke-width="1.2" stroke-linecap="round" opacity=".5" stroke="#ff5fb0"/>',

  // リビングでゲーム大会。テレビの中でストライク、床にクッション、紙吹雪
  bg_gameparty: '<rect width="100" height="100" fill="#ffe2cf"/>'
    + '<circle cx="50" cy="46" r="38" fill="#fff0e4"/>'
    // ガーランド
    + '<path d="M-4 12Q50 30 104 12" fill="none" stroke="#c99a8a" stroke-width=".8"/>'
    + [0.14, 0.24, 0.34, 0.66, 0.76, 0.86].map((t, i) => {
      const [x, y] = qpt([-4, 12], [50, 30], [104, 12], t);
      return `<path d="M${n(x - 2.6)} ${n(y - 0.4)}L${n(x + 2.6)} ${n(y + 0.4)}L${n(x + 0.2)} ${n(y + 5.6)}z" fill="${['#ff6f8f', '#4fc3f7', '#7fd36a', '#ffb347', '#b48cff', '#ff6f8f'][i]}"/>`;
    }).join('')
    // 風船（右）
    + bgBalloon(80, 30, 5.6, '#ff7fa8', 84, 60) + bgBalloon(90, 42, 4.8, '#5fc8ff', 85, 60) + bgBalloon(73, 19, 4, '#b48cff', 83, 60)
    // 床とラグ
    + '<rect y="66" width="100" height="3" fill="#fff"/>'
    + '<rect y="69" width="100" height="31" fill="#f0c294"/>'
    + '<path d="M0 76H100M0 85H100M0 94H100M20 69v7M60 76v9M34 85v9M80 69v7M74 94v6" fill="none" stroke="#dfab78" stroke-width=".8"/>'
    + '<ellipse cx="50" cy="89" rx="42" ry="9" fill="#ffb3c6"/><ellipse cx="50" cy="89" rx="34" ry="6.4" fill="none" stroke="#ffd3df" stroke-width="1.4"/>'
    // テレビ台とテレビ（中はボウリングのストライク）
    + '<rect x="3" y="54" width="34" height="6" rx="1.2" fill="#c98f5e"/><rect x="5" y="60" width="3" height="4" fill="#a8704a"/><rect x="32" y="60" width="3" height="4" fill="#a8704a"/>'
    + '<rect x="6" y="32" width="29" height="21.6" rx="2.4" fill="#3b3570"/>'
    + '<rect x="8.2" y="34.2" width="24.6" height="17.2" rx="1.2" fill="#7fb6ff"/>'
    + '<path d="M8.2 45H32.8V51.4H8.2z" fill="#ffd9a0"/><path d="M12 51.4L17 45M29 51.4L24 45" fill="none" stroke="#e6b47a" stroke-width=".6"/>'
    + `<path d="${star(20.5, 41.4, 7, 3.4)}" fill="#fff3a0"/>`
    + bgPin(16.6, 47, 6) + bgPin(24.4, 47, 6) + bgPin(20.5, 48.6, 6.8)
    + '<circle cx="11.4" cy="49" r="1.9" fill="#ff5f8f"/><path d="M7.6 48h1.6M7.2 50h1.8" fill="none" stroke="#fff" stroke-width=".6" stroke-linecap="round"/>'
    + '<path d="M26.6 35.6l3.6 3.6M28.8 35.6l3 3" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".6"/>'
    // クッション
    + '<g transform="rotate(-10 18 80)"><rect x="8" y="75" width="20" height="10" rx="4.4" fill="#6fc3ff"/><path d="M10 80h16" fill="none" stroke="#4fa6e6" stroke-width=".8"/><circle cx="18" cy="80" r="1" fill="#4fa6e6"/></g>'
    + '<g transform="rotate(8 82 81)"><rect x="73" y="76" width="18" height="10" rx="4.4" fill="#ff9a6a"/><path d="M75 81h14" fill="none" stroke="#f07a46" stroke-width=".8"/><circle cx="82" cy="81" r="1" fill="#f07a46"/></g>'
    // 紙吹雪
    + bgConfetti([[12, 22, 20, '#ff6f8f'], [26, 26, -30, '#4fc3f7'], [70, 30, 40, '#ffb347'], [92, 24, -20, '#7fd36a'], [8, 50, 60, '#b48cff'], [94, 56, -50, '#ff6f8f'], [38, 62, 30, '#ffb347'], [66, 58, 70, '#4fc3f7'], [36, 12, -60, '#7fd36a'], [62, 10, 15, '#b48cff'], [40, 30, 80, '#ff6f8f'], [64, 44, -40, '#7fd36a'], [22, 64, 10, '#4fc3f7']])
    + dots([[30, 18, 0.7], [56, 20, 0.6], [86, 50, 0.7], [16, 58, 0.6]], '#ffb347')
    + sparkle(36, 40, 1.8, '#fff') + sparkle(66, 24, 1.6, '#fff8d0'),

  // インタビューのスタジオ。背景パネル、上から2本のスポットライト、相棒に向いたマイク
  bg_interview: '<rect width="100" height="100" fill="#221f63"/>'
    + [-8, 16, 40, 64, 88].map((x) => [-6, 18, 42].map((y) => `<rect x="${x}" y="${y}" width="22" height="22" rx="1.6" fill="#2c2878"/><path d="M${x + 1.4} ${y + 1.2}h19.2" fill="none" stroke="#3b379a" stroke-width=".8"/>`
      + `<path d="M${x + 11} ${y + 8.6}l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#3e3aa0"/>`).join('')).join('')
    // 床
    + '<path d="M-4 66H104V100H-4z" fill="#191650"/><path d="M-4 66H104" fill="none" stroke="#3d3a9c" stroke-width="1.2"/>'
    // スポットライトの光（外側の淡い光＋内側の明るい光）。真ん中で重なって相棒を照らす
    + '<path d="M22 12L30 8.6L72 96L24 96z" fill="#fff3c4" opacity=".12"/><path d="M78 12L70 8.6L28 96L76 96z" fill="#fff3c4" opacity=".12"/>'
    + '<path d="M24 11.6L28.4 9.6L62 96L34 96z" fill="#fff3c4" opacity=".16"/><path d="M76 11.6L71.6 9.6L38 96L66 96z" fill="#fff3c4" opacity=".16"/>'
    + '<ellipse cx="50" cy="86" rx="32" ry="7.6" fill="#fff3c4" opacity=".26"/><ellipse cx="50" cy="86" rx="20" ry="4.6" fill="#fffbe6" opacity=".4"/>'
    // ライト本体
    + [[26, 10, -24], [74, 10, 24]].map(([x, y, r]) => `<g transform="rotate(${r} ${x} ${y})"><circle cx="${x}" cy="${y + 4}" r="5" fill="#fff3c4" opacity=".3"/><rect x="${x - 4}" y="${y - 4}" width="8" height="7" rx="1.6" fill="#141138"/><rect x="${x - 4.6}" y="${y + 2.2}" width="9.2" height="2.2" rx="1.1" fill="#fff8dc"/><path d="M${x - 5.6} ${y + 1}V${y - 2}Q${x} ${y - 7} ${x + 5.6} ${y - 2}V${y + 1}" fill="none" stroke="#141138" stroke-width="1"/></g>`).join('')
    // マイクスタンドのシルエット（右。ふちに光）
    + ['#8f8af0', '#0d0b2c'].map((c, i) => `<path d="M86 90L80 95M86 90L92 95M86 90V57M86 58.4L79 54.6" fill="none" stroke="${c}" stroke-width="${i ? 1.6 : 3}" stroke-linecap="round"/>`
      + `<g transform="rotate(28.5 76 53)"><rect x="${i ? 70.6 : 69.9}" y="${i ? 50.8 : 50.1}" width="${i ? 9.4 : 10.8}" height="${i ? 4.4 : 5.8}" rx="${i ? 2.2 : 2.9}" fill="${c}"/></g>`).join('')
    + '<path d="M72.4 50.4q.8-1.3 2.2-1.6" fill="none" stroke="#c9c4ff" stroke-width=".8" stroke-linecap="round"/>'
    // ON AIR のランプ（左の壁）
    + '<rect x="6.4" y="42" width="17" height="7" rx="1.6" fill="#ff4f6a" opacity=".3"/>'
    + '<rect x="7.4" y="43" width="15" height="5" rx="1.2" fill="#ff4f6a" stroke="#ffd0d8" stroke-width=".6"/>'
    + '<text x="14.9" y="46.7" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="3.4" fill="#fff">ON AIR</text>'
    // 光の粒
    + dots([[32, 28, 0.6], [38, 44, 0.5], [66, 34, 0.6], [70, 22, 0.5], [58, 62, 0.5], [42, 70, 0.6], [30, 56, 0.4], [72, 60, 0.4], [48, 10, 0.5]], '#fffbe6', 0.5)
    + sparkle(33, 38, 1.8, '#fffbe6') + sparkle(68, 28, 2, '#fffbe6') + sparkle(14, 58, 1.4, '#fffbe6') + sparkle(55, 74, 1.4, '#fffbe6')
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

// ---- 新しいオーラの部品 ----
const BUBBLES = [[16, 30, 5.2], [84, 24, 4.2], [11, 62, 3.4], [88, 58, 5.6], [25, 88, 3.4], [76, 88, 4.4], [50, 5, 2.8], [92, 40, 2.6], [32, 12, 2.4], [8, 46, 2]];
function bubble(x, y, r) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity=".35" stroke="#6fbfe8" stroke-width="${n(Math.max(0.7, r * 0.18))}"/>`
    + `<path d="M${n(x + r * 0.75)} ${n(y + r * 0.2)}A${n(r * 0.78)} ${n(r * 0.78)} 0 0 1 ${n(x + r * 0.1)} ${n(y + r * 0.76)}" fill="none" stroke="#ff9fd6" stroke-width="${n(Math.max(0.5, r * 0.14))}" stroke-linecap="round"/>`
    + `<path d="M${n(x - r * 0.62)} ${n(y - r * 0.05)}A${n(r * 0.64)} ${n(r * 0.64)} 0 0 1 ${n(x - r * 0.1)} ${n(y - r * 0.6)}" fill="none" stroke="#fff" stroke-width="${n(Math.max(0.6, r * 0.2))}" stroke-linecap="round"/>`;
}

const NOTES = [[14, 32, 1, '#ff5fa2'], [78, 24, 2, '#8f6cff'], [8, 62, 2, '#3fa8ec'], [86, 60, 1, '#ff5fa2'], [24, 92, 1, '#8f6cff'], [70, 94, 2, '#ff7f3f'], [48, 8, 1, '#3fa8ec']];
const noteHead = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="2.3" ry="1.7" transform="rotate(-22 ${x} ${y})"/>`;
const noteShine = (x, y) => `<circle cx="${n(x - 0.8)}" cy="${n(y - 0.5)}" r=".5" fill="#fff"/>`;
const eighthNote = (x, y, c) => outlined(noteHead(x, y)
  + `<rect x="${n(x + 1.2)}" y="${n(y - 8)}" width="1.1" height="8"/>`
  + `<path d="M${n(x + 1.2)} ${n(y - 8)}q3.8 1.2 3.2 5.2q-.8-2.6-3.2-2.8z"/>`, c, 1.6) + noteShine(x, y);
const beamedNotes = (x, y, c) => outlined(noteHead(x, y) + noteHead(n(x + 5.4), n(y - 1.4))
  + `<rect x="${n(x + 1.2)}" y="${n(y - 8)}" width="1.1" height="8"/>`
  + `<rect x="${n(x + 6.6)}" y="${n(y - 9.4)}" width="1.1" height="8"/>`
  + `<path d="M${n(x + 1.2)} ${n(y - 8)}L${n(x + 7.7)} ${n(y - 9.4)}V${n(y - 7.4)}L${n(x + 1.2)} ${n(y - 6)}z"/>`, c, 1.6) + noteShine(x, y) + noteShine(n(x + 5.4), n(y - 1.4));

const LEAVES = [[16, 28, -30, '#5fba6a'], [84, 24, 40, '#9ad86a'], [10, 60, 70, '#ff9a4d'], [90, 56, -50, '#5fba6a'], [24, 88, 20, '#9ad86a'], [76, 90, -70, '#5fba6a'], [50, 6, 90, '#ff9a4d'], [91, 82, 10, '#9ad86a']];

/** 炎1つ（(x, y) が根元、h が高さ、w が幅、tilt 度かたむける） */
function flame(x, y, h, w, tilt) {
  const shape = (hh, ww, by) => `M${x} ${n(by - hh)}C${n(x + ww * 0.12)} ${n(by - hh * 0.7)} ${n(x + ww * 0.6)} ${n(by - hh * 0.55)} ${n(x + ww * 0.5)} ${n(by - ww * 0.5)}A${n(ww * 0.5)} ${n(ww * 0.5)} 0 0 1 ${n(x - ww * 0.5)} ${n(by - ww * 0.5)}C${n(x - ww * 0.6)} ${n(by - hh * 0.55)} ${n(x - ww * 0.12)} ${n(by - hh * 0.7)} ${x} ${n(by - hh)}z`;
  return `<g transform="rotate(${tilt} ${x} ${y})"><path d="${shape(h, w, y)}" fill="#ff7a2f" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`
    + `<path d="${shape(h * 0.55, w * 0.5, y - w * 0.1)}" fill="#ffc24a"/></g>`;
}
const FLAMES = [[14, 92, 15, 8, -16], [9, 72, 17, 8, -10], [11, 50, 14, 7, -6], [18, 30, 11, 6, -4], [32, 16, 9, 5, -2], [86, 92, 15, 8, 16], [91, 72, 17, 8, 10], [89, 50, 14, 7, 6], [82, 30, 11, 6, 4], [68, 16, 9, 5, 2], [50, 10, 9, 5.4, 0], [34, 100, 12, 8, -6], [66, 100, 12, 8, 6]];

/** 雪の結晶（6本の枝） */
function snowflake(x, y, r) {
  const w = n(Math.max(0.9, r * 0.18));
  const at = (len, deg) => [x + len * Math.cos((deg * Math.PI) / 180), y + len * Math.sin((deg * Math.PI) / 180)];
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = i * 60 - 90;
    const [ex, ey] = at(r, a);
    const [bx, by] = at(r * 0.56, a);
    const k = r * 0.32;
    d += `M${x} ${y}L${n(ex)} ${n(ey)}`;
    for (const s of [50, -50]) d += `M${n(bx)} ${n(by)}l${n(k * Math.cos(((a + s) * Math.PI) / 180))} ${n(k * Math.sin(((a + s) * Math.PI) / 180))}`;
  }
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${n(w + 1.4)}" stroke-linecap="round"/>`
    + `<path d="${d}" fill="none" stroke="#f0fcff" stroke-width="${w}" stroke-linecap="round"/>`
    + `<circle cx="${x}" cy="${y}" r="${n(r * 0.2)}" fill="#9fe6ff" stroke="${INK}" stroke-width=".6"/>`;
}
const FLAKES = [[15, 26, 6], [86, 22, 5.2], [9, 60, 4.4], [90, 62, 6.4], [25, 90, 4.8], [76, 90, 5.2], [50, 4, 3.8]];
const SHARDS = [[26, 12, 3, 20], [93, 42, 2.6, -20], [7, 80, 2.8, 30], [60, 97, 2.4, -10], [40, 97, 2, 15]];

// ---- オーラ: Miacis の遊び（卓球・ヘアアイロン・パーソナルカラー）の部品 ----
/** (50, 50) 中心・半径 r の円の上の点（deg は度。0 が右、時計回り）。動く層はこの中心で回る */
const auAt = (r, deg) => [50 + r * Math.cos((deg * Math.PI) / 180), 50 + r * Math.sin((deg * Math.PI) / 180)];
/** 同じ中心の円弧（d0 → d1 を時計回り。180° 未満） */
function auArc(r, d0, d1, c, w, op) {
  const [x0, y0] = auAt(r, d0);
  const [x1, y1] = auAt(r, d1);
  return `<path d="M${n(x0)} ${n(y0)}A${r} ${r} 0 0 1 ${n(x1)} ${n(y1)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
}
/** 光の輪（softRing）の楕円の上の点。k は大きさの倍率 */
const auE = (deg, k = 1) => [AX + 41 * k * Math.cos((deg * Math.PI) / 180), AY + 46.5 * k * Math.sin((deg * Math.PI) / 180)];

/** 卓球のラケット（ブレードの中心 (x, y)。rot=0 で柄が下） */
function auPaddle(x, y, rot, rubber, op = 1) {
  return `<g transform="rotate(${n(rot)} ${n(x)} ${n(y)})"${op < 1 ? ` opacity="${op}"` : ''}>`
    + `<rect x="${n(x - 1.4)}" y="${n(y + 3.8)}" width="2.8" height="6.4" rx="1.1" fill="#eab878" stroke="${INK}" stroke-width="1"/>`
    + `<path d="M${n(x - 1.4)} ${n(y + 6.6)}h2.8" fill="none" stroke="#c98a4e" stroke-width=".8"/>`
    + `<ellipse cx="${n(x)}" cy="${n(y)}" rx="5.2" ry="5.6" fill="${rubber}" stroke="${INK}" stroke-width="1.1"/>`
    + `<path d="M${n(x - 3.2)} ${n(y - 1.6)}Q${n(x - 2.4)} ${n(y - 3.9)} ${n(x - 0.2)} ${n(y - 4.3)}" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".85"/>`
    + '</g>';
}
/** 振ったラケット: 半径 40・角度 deg に本体、後ろに残像2枚と風を切る弧、先に打った瞬間の線 */
function auSwing(deg, rubber) {
  const at = (d) => auAt(42, d);
  const seg = (r0, d0, r1, d1) => `M${auAt(r0, d0).map(n).join(' ')}L${auAt(r1, d1).map(n).join(' ')}`;
  const ghost = (d, op) => `<ellipse cx="${n(at(d)[0])}" cy="${n(at(d)[1])}" rx="5.2" ry="5.6" transform="rotate(${n(d + 90)} ${n(at(d)[0])} ${n(at(d)[1])})" fill="${rubber}" opacity="${op}"/>`;
  return auArc(48, deg - 52, deg - 6, '#ff8a2a', 3.6, 0.9) + auArc(48, deg - 46, deg - 7, '#fff', 1.8, 1)
    + auArc(43, deg - 40, deg - 9, '#fff', 2.6, 0.8) + auArc(37.5, deg - 30, deg - 11, '#ffd2a8', 1.8, 0.9)
    + ghost(deg - 30, 0.2) + ghost(deg - 15, 0.4) + auPaddle(...at(deg), deg + 90, rubber)
    + `<path d="${seg(49, deg + 10, 54, deg + 13) + seg(48, deg + 17, 51.6, deg + 23) + seg(50, deg + 4, 54, deg + 5)}" fill="none" stroke="#ff8a2a" stroke-width="1.3" stroke-linecap="round"/>`;
}
/** ピンポン球（半径 r の円を時計回りに飛ぶ。後ろに尾） */
function auBall(deg, r, fill, trail) {
  const [x, y] = auAt(r, deg);
  return auArc(r, deg - 36, deg - 4, trail, 3.8, 0.3) + auArc(r, deg - 20, deg - 4, trail, 2.8, 0.55)
    + `<circle cx="${n(x)}" cy="${n(y)}" r="3.1" fill="${fill}" stroke="${INK}" stroke-width="1"/>`
    + `<path d="M${n(x + 2)} ${n(y + 0.6)}A2.1 2.1 0 0 1 ${n(x + 0.6)} ${n(y + 2)}" fill="none" stroke="${fill === '#fff' ? '#d9d4f0' : '#e0661a'}" stroke-width=".8" stroke-linecap="round"/>`
    + `<circle cx="${n(x - 1)}" cy="${n(y - 1)}" r=".85" fill="#fff" opacity=".95"/>`;
}

/** 髪のつやのような光の筋（光の輪に沿った三日月。d0 → d1 度、k は輪の倍率、w は真ん中の太さ） */
function auGloss(d0, d1, k, w) {
  const mid = (d0 + d1) / 2;
  const p0 = auE(d0, k);
  const p2 = auE(d1, k);
  const ctrl = (m) => [2 * m[0] - (p0[0] + p2[0]) / 2, 2 * m[1] - (p0[1] + p2[1]) / 2];
  const c1 = ctrl(auE(mid, k));
  const c2 = ctrl(auE(mid, k - w / 44));
  const P = ([x, y]) => `${n(x)} ${n(y)}`;
  return `<path d="M${P(p0)}Q${P(c1)} ${P(p2)}" fill="none" stroke="#fff" stroke-width="${n(w * 2.6)}" stroke-linecap="round" opacity=".3"/>`
    + `<path d="M${P(p0)}Q${P(c1)} ${P(p2)}Q${P(c2)} ${P(p0)}z" fill="#fff"/>`;
}
/** ふわっと上がる湯気（(x, y) から高さ h の S 字） */
function auSteam(x, y, h) {
  const d = `M${x} ${y}q-2.2 ${n(-h / 4)} 0 ${n(-h / 2)}t0 ${n(-h / 2)}`;
  return `<path d="${d}" fill="none" stroke="#d9b4ec" stroke-width="2.6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`;
}
/** ヘアアイロン（ちょうつがい (x, y) から rot 度の向きに2本の腕。先の内側に銀のプレート） */
function auIron(x, y, rot) {
  const arm = (a, yy, py) => `<g transform="rotate(${a} ${x} ${y})"><rect x="${x}" y="${n(y + yy)}" width="17" height="3" rx="1.4" fill="#ff8fb8" stroke="${INK}" stroke-width="1"/>`
    + `<rect x="${n(x + 9.6)}" y="${n(y + py)}" width="6.6" height="1.2" rx=".4" fill="#eef2fa" stroke="${INK}" stroke-width=".5"/>`
    + `<path d="M${n(x + 3.4)} ${n(y + yy + 0.8)}v1.4M${n(x + 5)} ${n(y + yy + 0.8)}v1.4" fill="none" stroke="#e0679a" stroke-width=".7" stroke-linecap="round"/></g>`;
  return `<g transform="rotate(${rot} ${x} ${y})">`
    + `<path d="M${n(x - 1.6)} ${n(y + 1)}q-3 1.6-2.4 4.6t-1.6 4" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`
    + arm(-6, -3.4, -1.6) + arm(6, 0.4, 0.4)
    + `<circle cx="${x}" cy="${y}" r="2.4" fill="#d9668f" stroke="${INK}" stroke-width="1"/>`
    + '</g>';
}

// パーソナルカラーの4シーズン: [色, 淡い色, 印]
const SEASONS = [['#ff7f6e', '#ffc8bc', 'spring'], ['#ac96ee', '#e2d8ff', 'summer'], ['#c8643f', '#efbea0', 'autumn'], ['#2f55d4', '#b8c8ff', 'winter']];
function auSeasonIcon(x, y, kind) {
  if (kind === 'spring') {
    return [0, 72, 144, 216, 288].map((d) => `<circle cx="${n(x + 1.15 * Math.cos(((d - 90) * Math.PI) / 180))}" cy="${n(y + 1.15 * Math.sin(((d - 90) * Math.PI) / 180))}" r=".9" fill="#fff"/>`).join('')
      + `<circle cx="${x}" cy="${y}" r=".7" fill="#ffd25e"/>`;
  }
  if (kind === 'summer') return `<path d="M${n(x - 2.4)} ${n(y - 0.6)}q1.2-1.3 2.4 0t2.4 0M${n(x - 2.4)} ${n(y + 1.4)}q1.2-1.3 2.4 0t2.4 0" fill="none" stroke="#fff" stroke-width=".85" stroke-linecap="round"/>`;
  if (kind === 'autumn') {
    return `<g transform="rotate(35 ${x} ${y})"><path d="M${x} ${n(y - 2.7)}C${n(x + 2.1)} ${n(y - 1.4)} ${n(x + 1.9)} ${n(y + 1.3)} ${x} ${n(y + 2.3)}C${n(x - 1.9)} ${n(y + 1.3)} ${n(x - 2.1)} ${n(y - 1.4)} ${x} ${n(y - 2.7)}z" fill="#fff"/>`
      + `<path d="M${x} ${n(y - 1.6)}V${n(y + 3.2)}" fill="none" stroke="#c8643f" stroke-width=".55" stroke-linecap="round"/></g>`;
  }
  let d = '';
  for (let i = 0; i < 3; i++) {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    d += `M${n(x - 2.3 * Math.cos(a))} ${n(y - 2.3 * Math.sin(a))}L${n(x + 2.3 * Math.cos(a))} ${n(y + 2.3 * Math.sin(a))}`;
  }
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width=".8" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r=".6" fill="#fff"/>`;
}
/** 色見本のカード（中心 (x, y)。大きな色面に季節の印、下に淡い色と中くらいの色のチップ）。カードは公転しても立ったまま */
function auSeasonCard(x, y, [main, tint, kind]) {
  return '<g class="miacis-4s-card">'
    + `<rect x="${n(x - 4.8)}" y="${n(y - 6.2)}" width="9.6" height="12.4" rx="1.8" fill="#fff" stroke="${INK}" stroke-width="1.1"/>`
    + `<rect x="${n(x - 3.6)}" y="${n(y - 5)}" width="7.2" height="7.4" rx="1.1" fill="${main}"/>`
    + auSeasonIcon(n(x), n(y - 1.3), kind)
    + `<rect x="${n(x - 3.6)}" y="${n(y + 3.3)}" width="3.3" height="1.8" rx=".5" fill="${tint}"/><rect x="${n(x + 0.3)}" y="${n(y + 3.3)}" width="3.3" height="1.8" rx=".5" fill="${main}" opacity=".6"/>`
    + '</g>';
}
/** ふち取りした花びら（(x, y) が中心、rot 度） */
const auPetal = (x, y, rot, c) => `<g transform="rotate(${rot} ${n(x)} ${n(y)})"><path d="M${n(x)} ${n(y - 3)}C${n(x + 2.4)} ${n(y - 1.4)} ${n(x + 2)} ${n(y + 2)} ${n(x)} ${n(y + 3)}C${n(x - 2)} ${n(y + 2)} ${n(x - 2.4)} ${n(y - 1.4)} ${n(x)} ${n(y - 3)}z" fill="${c}" stroke="${INK}" stroke-width=".8"/>`
  + `<circle cx="${n(x - 0.6)}" cy="${n(y - 1)}" r=".55" fill="#fff" opacity=".9"/></g>`;
/** 4色の色相環（うっすらした4つの扇と、輪の4色の弧） */
function auSeasonWheel() {
  const P = ([x, y]) => `${n(x)} ${n(y)}`;
  return SEASONS.map(([c], i) => {
    const a0 = -135 + i * 90;
    const a1 = a0 + 90;
    return `<path d="M${AX} ${AY}L${P(auE(a0, 0.98))}A${n(41 * 0.98)} ${n(46.5 * 0.98)} 0 0 1 ${P(auE(a1, 0.98))}z" fill="${c}" opacity=".22"/>`
      + `<path d="M${P(auE(a0 + 2))}A41 46.5 0 0 1 ${P(auE(a1 - 2))}" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`;
  }).join('');
}

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
    + `<ellipse cx="${AX}" cy="${AY}" rx="34" ry="40" fill="#fff" opacity=".4"/>`,
  aura_bubble: softRing('#bfe6ff', 1) + BUBBLES.map(([x, y, r]) => bubble(x, y, r)).join(''),
  aura_note: softRing('#ffadd6', 0.9) + NOTES.map(([x, y, kind, c]) => (kind === 2 ? beamedNotes(x, y, c) : eighthNote(x, y, c))).join(''),
  aura_leaf: softRing('#9fe39a', 0.9)
    + '<path d="M8 40Q18 30 30 34M70 84Q82 80 92 70M74 14Q84 12 90 18" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>'
    + LEAVES.map(([x, y, rot, c]) => leafShape(x, y, rot, c, 4.4, 1.1)).join(''),
  aura_fire: rays('#ff9a4d', 14, 14, 47, 0.18, 0.5) + softRing('#ff7f45', 0.9),
  aura_ice: rays('#bff0ff', 12, 14, 47, 0.16, 0.6) + softRing('#8fdcff', 0.9)
    + SHARDS.map(([x, y, sz, rot]) => `<path transform="rotate(${rot} ${x} ${y})" d="M${x} ${n(y - sz)}L${n(x + sz * 0.4)} ${y}L${x} ${n(y + sz)}L${n(x - sz * 0.4)} ${y}z" fill="#e6fbff" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>`).join(''),

  // --- Miacis の遊び ---
  // 卓球: オレンジの光の輪。ラケットと球は動く層（auraMotion）
  aura_pingpong: rays('#ffffff', 12, 14, 46, 0.14, 0.42) + softRing('#ffa860', 0.9)
    + sparkle(14, 50, 2.2, '#fff6d8') + sparkle(86, 48, 2, '#fff6d8') + sparkle(50, 97, 1.8, '#fff6d8'),
  // ヘアアイロン: 髪のつやのような白い三日月の筋と、アイロンから上がる湯気
  aura_iron_shine: softRing('#ff9cc8', 1.1)
    + auGloss(146, 214, 0.9, 2.4) + auGloss(166, 200, 0.78, 1.3) + auGloss(-34, 34, 0.9, 2.4) + auGloss(-20, 14, 0.78, 1.3)
    + auGloss(-124, -56, 0.92, 1.8)
    + sparkle(...auE(146, 0.9).map(n), 1.8, '#fff') + sparkle(...auE(34, 0.9).map(n), 1.8, '#fff')
    + auSteam(14, 92, 12) + auSteam(20, 84, 8) + auSteam(85, 79, 10) + auSteam(91, 76, 8)
    + auIron(72, 92, -32)
    + sparkle(11, 34, 2, '#fff') + sparkle(89, 30, 2, '#fff') + sparkle(30, 7, 1.6, '#fff'),
  // パーソナルカラー: 春・夏・秋・冬の4色の色相環。色見本のカードと花びらは動く層
  aura_4season: auSeasonWheel() + `<ellipse cx="${AX}" cy="${AY}" rx="30" ry="36" fill="#fff" opacity=".35"/>`
    + sparkle(14, 16, 2, '#fff') + sparkle(87, 86, 2, '#fff') + sparkle(88, 16, 1.6, '#fff') + sparkle(13, 86, 1.6, '#fff')
};

const auraSvg = (cls, body) => `<svg class="miacis-aura-art${cls}" aria-hidden="true" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;overflow:visible">${body}</svg>`;
// 動く層（虹の輪の回転・炎のゆらぎ・氷の結晶の回転）。動きを減らす設定では止める
// （app.css / experience.css の一括停止とは別に、単体でも止まるように）
const SPIN_STYLE = '<style>@keyframes miacis-aura-spin{to{transform:rotate(360deg)}}.miacis-aura-spin{transform-origin:50% 50%;animation:miacis-aura-spin 18s linear infinite}@media (prefers-reduced-motion:reduce){.miacis-aura-spin{animation:none}}</style>';
const FLAME_STYLE = '<style>@keyframes miacis-flicker{0%,100%{transform:scale(1,1)}50%{transform:scale(.9,1.12)}}.miacis-flame{transform-box:fill-box;transform-origin:50% 100%;animation:miacis-flicker 1.6s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.miacis-flame{animation:none}}</style>';
const FLAKE_STYLE = '<style>@keyframes miacis-flake-spin{to{transform:rotate(360deg)}}.miacis-flake{transform-box:fill-box;transform-origin:50% 50%;animation:miacis-flake-spin 16s linear infinite}@media (prefers-reduced-motion:reduce){.miacis-flake{animation:none}}</style>';
// 卓球: 球は (50, 50) のまわりを速く回り、ラケットは行ったり来たり振る。4シーズン: カードはゆっくり公転し、自分は立ったまま
const PP_STYLE = '<style>@keyframes miacis-pp-orbit{to{transform:rotate(360deg)}}.miacis-pp-orbit{transform-origin:50px 50px;animation:miacis-pp-orbit 6s linear infinite}@keyframes miacis-pp-swing{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(6deg)}}.miacis-pp-swing{transform-origin:50px 50px;animation:miacis-pp-swing 1.5s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.miacis-pp-orbit,.miacis-pp-swing{animation:none}}</style>';
const SEASON_STYLE = '<style>@keyframes miacis-4s-orbit{to{transform:rotate(360deg)}}.miacis-4s-orbit{transform-origin:50% 50%;animation:miacis-4s-orbit 30s linear infinite}.miacis-4s-card{transform-box:fill-box;transform-origin:50% 50%;animation:miacis-4s-orbit 30s linear infinite reverse}@media (prefers-reduced-motion:reduce){.miacis-4s-orbit,.miacis-4s-card{animation:none}}</style>';

const auraMotion = {
  aura_rainbow: () => SPIN_STYLE + auraSvg(' miacis-aura-spin', rainbowRing() + sparkle(50, 4, 2.6, '#fff') + sparkle(94, 56, 2.2, '#fff') + sparkle(14, 80, 2, '#fff')),
  aura_fire: () => FLAME_STYLE + auraSvg('', FLAMES.map(([x, y, h, w, tilt], i) => `<g class="miacis-flame" style="animation-delay:-${n((i * 0.37) % 1.6)}s">${flame(x, y, h, w, tilt)}</g>`).join('')
    + sparkle(20, 12, 2.2, '#fff3d0') + sparkle(84, 84, 2, '#fff3d0')),
  aura_ice: () => FLAKE_STYLE + auraSvg('', FLAKES.map(([x, y, r], i) => `<g class="miacis-flake"${i % 2 ? ' style="animation-direction:reverse"' : ''}>${snowflake(x, y, r)}</g>`).join('')
    + sparkle(70, 8, 2, '#fff') + sparkle(5, 42, 1.8, '#fff') + sparkle(95, 80, 1.8, '#fff')),
  aura_pingpong: () => PP_STYLE + auraSvg('', `<g class="miacis-pp-swing">${auSwing(-130, '#e8424f') + auSwing(42, '#3a62d8')}</g>`
    + `<g class="miacis-pp-orbit">${auBall(-70, 45, '#ff8a2a', '#ffb070') + auBall(15, 45, '#fff', '#fff') + auBall(110, 45, '#ff8a2a', '#ffb070') + auBall(195, 45, '#fff', '#fff')}</g>`),
  aura_4season: () => SEASON_STYLE + auraSvg(' miacis-4s-orbit', SEASONS.map((s, i) => auSeasonCard(...auAt(42, -90 + i * 90), s)).join('')
    + SEASONS.map(([c], i) => {
      const g = -45 + i * 90;
      return auPetal(...auAt(45, g - 12), g + 78, c) + auPetal(...auAt(40.5, g + 9), g + 99, SEASONS[(i + 1) % 4][0]);
    }).join(''))
};

/** オーラ id ごとの SVG（相棒の後ろに置く）。未知の id は空文字。動く層があれば後ろに重ねる */
export function renderAuraArt(item) {
  if (!item || typeof item.id !== 'string' || !Object.hasOwn(auras, item.id)) return '';
  const base = auraSvg('', auras[item.id]);
  return Object.hasOwn(auraMotion, item.id) ? base + auraMotion[item.id]() : base;
}
