/**
 * miacis-forms.js - すがた（form）: 相棒がミアキスの子孫の動物に変身した全身の絵
 *
 * 相棒の画像（assets/miacis-avatar.png）の代わりに、アバターの箱いっぱい（100×100）に描く。
 * 座標は miacis-accessories.js と同じ: 左目 (43.4, 37.0) / 右目 (49.9, 37.3) / 鼻 (45.5, 41.3)
 * 頭のてっぺん y≈20、あご y≈43.5、両手 (38, 40)・(61, 40)。座りポーズ・頭・首の位置は全種で共通なので、
 * 帽子・メガネ・首の物はそのまま合う。
 *
 * 絵柄は相棒に合わせる: 太い紺のふち（ステッカーの台紙）＋紺の線＋平塗り＋白いハイライト1つ。
 * レア度で手間を変える: SR 素直な形 / UR 模様と毛並みを描き込む / SECRET きらめきの星を添える。
 * 中身は固定の文字列だけ（利用者の入力を一切含まない）。
 */
const INK = '#372a98';
const n = (v) => Math.round(v * 100) / 100;
const pt = ([x, y]) => `${n(x)} ${n(y)}`;

/** 白いハイライト（ふち取りなし） */
const hl = (d, w = 1.4) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" opacity=".9"/>`;

/** 4つ角のきらめき（SECRET の飾り） */
function sparkle(x, y, r, fill = '#fff3a6') {
  const k = r * 0.22;
  return `<path d="M${n(x)} ${n(y - r)}Q${n(x + k)} ${n(y - k)} ${n(x + r)} ${n(y)}Q${n(x + k)} ${n(y + k)} ${n(x)} ${n(y + r)}Q${n(x - k)} ${n(y + k)} ${n(x - r)} ${n(y)}Q${n(x - k)} ${n(y - k)} ${n(x)} ${n(y - r)}Z" fill="${fill}" stroke="${INK}" stroke-width="${n(Math.max(0.6, r * 0.26))}" stroke-linejoin="round"/>`;
}

// ---- しっぽ: 3次ベジェの芯に沿って太さの変わる帯を作る（縞や先の色も同じ式で切り出せる） ----
function bez(p, t) {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i]);
}
function bezD(p, t) {
  const u = 1 - t;
  return [0, 1].map((i) => 3 * u * u * (p[1][i] - p[0][i]) + 6 * u * t * (p[2][i] - p[1][i]) + 3 * t * t * (p[3][i] - p[2][i]));
}
function tube(p, hw, t0 = 0, t1 = 1, steps = 22) {
  const a = [];
  const b = [];
  for (let k = 0; k <= steps; k++) {
    const t = t0 + ((t1 - t0) * k) / steps;
    const [x, y] = bez(p, t);
    const [dx, dy] = bezD(p, t);
    const m = Math.hypot(dx, dy) || 1;
    const w = hw(t);
    a.push([x - (dy / m) * w, y + (dx / m) * w]);
    b.push([x + (dy / m) * w, y - (dx / m) * w]);
  }
  return `M${[...a, ...b.reverse()].map(pt).join('L')}Z`;
}

/** しっぽ1本: 地の色、縞（[t0, t1, 色]）、先の色（[t0, 色]） */
function tail(S, p, hw, fill, { bands = [], tip = null } = {}) {
  const inner = bands.map(([a, b, c]) => `<path d="${tube(p, hw, a, b, 8)}" fill="${c}" stroke="none"/>`).join('')
    + (tip ? `<path d="${tube(p, hw, tip[0], 1, 10)}" fill="${tip[1]}" stroke="none"/>` : '');
  S.shape(`<path d="${tube(p, hw)}"/>`, fill, inner);
}

// ---- 共通の形（全種で同じ位置） ----
const HEAD = 'M40.2 33.5C39.6 25 45.4 19.8 52 19.8C59.2 19.8 64 25 63.6 32C63.2 38.6 58.4 43.6 51.6 43.8L47.6 44C43 44 40.6 40 40.2 33.5Z';
const TORSO = 'M50 38C60 35.6 67.6 42 67.4 52C67.2 60.6 62 65.6 54 65.4L45 64.6C42.6 57 43.4 44 50 38Z';
const TAIL_THIN = [[60, 60], [64, 68], [58, 76], [44.4, 79]];
const BELLY = '<ellipse cx="54.6" cy="52.6" rx="6.8" ry="8.4"/>';
/** 鼻より下（口もと〜あご）の明るい面。頭のふちに沿う */
const MUZZLE = 'M40.4 35.8C42.4 38.6 44.6 38.8 46.8 38.6C49.4 38.4 52 39.8 54.8 38.4C55.4 41.8 52.8 43.7 51.6 43.8L47.6 44C43 44 40.7 40.4 40.4 35.8Z';
const HEAD_HL = hl('M44.6 24.8Q46.6 22.2 50.4 21.6');

/** 部品を「台紙（太い紺のふち）」と「絵」に分けて積む */
function sticker(draw) {
  const sil = [];
  let art = '';
  const S = {
    shape(el, fill, inner = '', sw = 2) {
      sil.push(el);
      art += el.replace('/>', ` fill="${fill}" stroke="none"/>`) + inner + el.replace('/>', ` fill="none" stroke-width="${sw}"/>`);
    },
    add(s) { art += s; }
  };
  draw(S);
  return `<g fill="${INK}" stroke-width="7">${sil.join('')}</g>${art}`;
}

/** 頭（地の色・模様・目と鼻） */
function head(S, fill, marks = '', { eyes = 'dot', nose = INK, noseScale = 1 } = {}) {
  const eye = eyes === 'ring'
    ? '<circle cx="43.4" cy="37" r="1.75" fill="#fff" stroke="none"/><circle cx="49.9" cy="37.3" r="1.75" fill="#fff" stroke="none"/><circle cx="43.5" cy="37.2" r="1.05" fill="#221b55" stroke="none"/><circle cx="50" cy="37.5" r="1.05" fill="#221b55" stroke="none"/>'
    : `<ellipse cx="43.4" cy="37" rx="1.15" ry="1.4" fill="${INK}" stroke="none"/><ellipse cx="49.9" cy="37.3" rx="1.15" ry="1.4" fill="${INK}" stroke="none"/>`;
  const noseEl = `<path transform="translate(45.5 41.2) scale(${noseScale}) translate(-45.5 -41.2)" d="M44 40.6Q45.5 39.8 47 40.6Q46.6 42.2 45.5 42.4Q44.4 42.2 44 40.6Z" fill="${nose}" stroke="${INK}" stroke-width=".8"/>`;
  S.shape(`<path d="${HEAD}"/>`, fill, marks + eye + noseEl + HEAD_HL);
}

/** 胴体 */
function torso(S, fill, marks = '', d = TORSO) {
  S.shape(`<path d="${d}"/>`, fill, marks);
}

/** 両手（頭の左右にかける） */
function paws(S, fill) {
  S.shape('<ellipse cx="38.2" cy="40.6" rx="3.1" ry="2.7"/>', fill, '<path d="M37.2 43.1v-1.5M39.3 43.1v-1.5" fill="none" stroke-width="1"/>');
  S.shape('<ellipse cx="60.8" cy="40.4" rx="3.6" ry="2.8"/>', fill, '<path d="M59.6 43v-1.5M62 43v-1.5" fill="none" stroke-width="1"/>');
}

/** 足の裏（肉球つき） */
function feet(S, fill, pad = INK, { y = 0, s = 1 } = {}) {
  const one = (cx, cy, rot) => {
    const g = (body) => `<g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})">${body}</g>`;
    const inner = g(`<path d="M-2.1 3.9Q-2.6 .9 0 .7Q2.6 .9 2.1 3.9Q0 5 -2.1 3.9Z" fill="${pad}" stroke="none"/>`
      + `<circle cx="-2.3" cy="-1.9" r="1" fill="${pad}" stroke="none"/><circle cx="0" cy="-3.2" r="1.05" fill="${pad}" stroke="none"/><circle cx="2.3" cy="-1.9" r="1" fill="${pad}" stroke="none"/>`);
    S.shape(`<ellipse cx="${cx}" cy="${cy}" rx="${n(4.9 * s)}" ry="${n(6.5 * s)}" transform="rotate(${rot} ${cx} ${cy})"/>`, fill, inner);
  };
  one(38.8, 58.2 + y, -14);
  one(49.6, 58.6 + y, -7);
}

/** 三角の耳（左右）。inner は耳の内側、tipColor は耳の先 */
function pointEars(S, L, R, fill, inner, tipColor = '') {
  for (const [d, c, tip] of [L, R]) {
    const innerEl = `<path transform="translate(${c[0]} ${c[1]}) scale(.58) translate(${-c[0]} ${-c[1]})" d="${d}" fill="${inner}" stroke="none"/>`;
    const tipEl = tipColor ? `<path transform="translate(${tip[0]} ${tip[1]}) scale(.42) translate(${-tip[0]} ${-tip[1]})" d="${d}" fill="${tipColor}" stroke="none"/>` : '';
    S.shape(`<path d="${d}"/>`, fill, innerEl + tipEl);
  }
}

/** 丸い耳（左右） */
function roundEars(S, r, fill, inner, L = [41.4, 22.4], R = [61.8, 22]) {
  for (const [x, y] of [L, R]) {
    S.shape(`<circle cx="${x}" cy="${y}" r="${r}"/>`, fill, `<circle cx="${n(x + (x < 50 ? 0.3 : -0.3))}" cy="${n(y + 0.4)}" r="${n(r * 0.52)}" fill="${inner}" stroke="none"/>`);
  }
}

// 耳の形（[path, 内側を縮める中心, 先]）
const EAR = {
  fox: [['M40.4 29.6Q36 22 35.4 14Q42.6 15.4 47.2 21.2Z', [41.6, 23.4], [35.4, 14]], ['M55.4 20.6Q60.4 14.8 66.4 13.4Q66.8 21.4 63.6 28.6Z', [62.2, 22], [66.4, 13.4]]],
  wolf: [['M40.4 29.6Q36.6 22.6 36.4 15.4Q42.8 16.4 47.2 21.2Z', [41.8, 23.6], [36.4, 15.4]], ['M55.4 20.6Q60.2 15.6 65.6 14.6Q66.2 21.8 63.6 28.6Z', [61.8, 22.2], [65.6, 14.6]]],
  cat: [['M40.6 28.4Q38.2 22.4 37.8 16.6Q43.2 17.6 46.8 21.4Z', [41.6, 23.4], [37.8, 16.6]], ['M55.8 20.8Q60 17.2 64.8 16.2Q65.4 21.8 63.4 27.2Z', [61.6, 21.8], [64.8, 16.2]]],
  tiger: [['M40.2 28.8C37.6 23.6 39 18.6 42.6 18.4C45 18.4 46.6 19.8 47.2 21.4Z', [42.4, 22.6], [41, 18.6]], ['M55.6 20.6C57 18.4 59.6 17.4 61.8 18.4C64.4 20 64.8 24.6 63.4 27.8Z', [60.6, 22], [62, 18.6]]],
  round: [['M40.2 29C37.2 23.4 37.8 17.6 41 16.8C43.4 16.2 45.8 18.6 47.2 21.2Z', [42, 22.6], [40.6, 17]], ['M55.4 20.6C57.2 17.8 60.2 16.2 62.6 17C65.6 18.2 65.4 23.8 63.6 28.6Z', [61.2, 21.6], [62.6, 17]]]
};

const SECRET_SPARKLES = sparkle(28.6, 22, 3.2) + sparkle(74, 30, 2.3) + sparkle(25.6, 66, 2.2) + sparkle(75.4, 74, 2.8)
  + '<circle cx="31.4" cy="31.6" r=".9" fill="#fff3a6" stroke="#372a98" stroke-width=".5"/><circle cx="70.4" cy="20.6" r=".9" fill="#fff3a6" stroke="#372a98" stroke-width=".5"/>';

// ===== 10種 =====
const forms = {
  // ---- SR: 素直な形 ----
  form_fox: () => sticker((S) => {
    const fur = '#f39a3d';
    const white = '#fff8ec';
    tail(S, [[58, 58], [72, 64], [62, 80], [41.6, 79.4]], (t) => 6.6 * Math.sin(Math.PI * (0.16 + 0.84 * t)) ** 0.7, fur, { tip: [0.74, white] });
    torso(S, fur, `<path d="M48.4 41C53 44 57 48 58.4 54C59.4 59 57.4 63 54 65.4L45 64.6C42.6 57 43.4 46 48.4 41Z" fill="${white}" stroke="none"/>`);
    pointEars(S, EAR.fox[0], EAR.fox[1], fur, '#fff1dc', '#4a2f45');
    head(S, fur, `<path d="${MUZZLE}" fill="${white}" stroke="none"/>`);
    paws(S, fur);
    feet(S, fur);
  }),

  form_raccoon: () => sticker((S) => {
    const fur = '#aaa5b8';
    const dark = '#3a3456';
    const light = '#f5f3f8';
    const hw = (t) => 3.9 * Math.sqrt(Math.max(0, 1 - t ** 6));
    tail(S, [[58, 58], [70, 64], [61, 79], [43.6, 79.2]], hw, fur, { bands: [[0.18, 0.3, dark], [0.42, 0.54, dark], [0.66, 0.78, dark]], tip: [0.88, dark] });
    torso(S, fur, BELLY.replace('/>', ` fill="${light}" stroke="none"/>`));
    pointEars(S, EAR.round[0], EAR.round[1], light, fur);
    head(S, fur,
      `<path d="M40.1 31.4C44 29.6 50 29.8 55.6 32.6C56.4 38 54.6 43.4 51.6 43.8L47.6 44C43 44 40.6 40 40.2 33.5Z" fill="${light}" stroke="none"/>`
      + `<path d="M39.8 34.4C42 33.6 44.4 34.2 46.6 35.8C48.4 34.2 51.2 33.8 53.6 35C55.2 36.6 54 39.8 51 40C49 40.1 47.8 39 46.6 38.6C45.4 39.8 43.4 40.8 41.2 40.2C40.4 38.4 40 36.6 39.8 34.4Z" fill="${dark}" stroke="none"/>`,
      { eyes: 'ring', noseScale: 1.15 });
    paws(S, fur);
    feet(S, dark, '#8c86a0');
  }),

  form_redpanda: () => sticker((S) => {
    const fur = '#d4622e';
    const dark = '#4b2a26';
    const white = '#fff6ea';
    const hw = (t) => 3.9 * Math.sqrt(Math.max(0, 1 - t ** 6));
    tail(S, [[58, 58], [70, 64], [61, 79], [43.6, 79.2]], hw, fur, { bands: [[0.18, 0.3, '#f2a364'], [0.42, 0.54, '#f2a364'], [0.66, 0.78, '#f2a364']], tip: [0.9, dark] });
    torso(S, fur, `<path d="M45 64.6C44 60 44.4 55 46 51C49 55 53.6 58 58 59.4C57 62.6 55.6 64.6 54 65.4Z" fill="${dark}" stroke="none"/>`);
    pointEars(S, EAR.round[0], EAR.round[1], white, dark);
    head(S, fur,
      `<path d="${MUZZLE}" fill="${white}" stroke="none"/>`
      + `<ellipse cx="43" cy="33.4" rx="1.8" ry="1.3" fill="${white}" stroke="none"/><ellipse cx="50.2" cy="33.6" rx="1.8" ry="1.3" fill="${white}" stroke="none"/>`
      + `<path d="M55.4 33.6C58 32.6 61.4 33 63.5 33.8C63 38 60.6 40.4 57.6 40.2C55.6 39 55 36 55.4 33.6Z" fill="${white}" stroke="none"/>`
      + `<path d="M43.2 38.6Q43 40 42.2 41M50 38.8Q50.6 40 51.6 40.6" fill="none" stroke="#8a3a20" stroke-width="1.2"/>`);
    paws(S, dark);
    feet(S, dark, '#a8735f');
  }),

  form_weasel: () => sticker((S) => {
    const fur = '#b87a44';
    const cream = '#fff0cf';
    tail(S, [[59, 64], [70, 74], [60, 84], [40.4, 80.6]], (t) => 2.5 - 1.1 * t, fur, { tip: [0.8, '#4a2f45'] });
    torso(S, fur,
      `<path d="M47.6 40.6C52 42 55 48 55.6 56C56 63 55.4 68 53 71L46.6 70.4C43.6 62 43.8 47 47.6 40.6Z" fill="${cream}" stroke="none"/>`,
      'M50.6 38C59 36.6 63.8 42 63.4 52C63 62 60.8 70.6 54 71.4L46.6 70.6C43.4 62 44.2 45 50.6 38Z');
    roundEars(S, 2.9, fur, '#f3c6a0', [41.4, 23.4], [62, 23.2]);
    head(S, fur, `<path d="${MUZZLE}" fill="${cream}" stroke="none"/>`);
    paws(S, fur);
    feet(S, fur, INK, { y: 5, s: 0.86 });
  }),

  // ---- UR: 模様と毛並みを1段描き込む ----
  form_tiger: () => sticker((S) => {
    const fur = '#f7922f';
    const white = '#fffaf0';
    const st = INK;
    tail(S, TAIL_THIN, (t) => 2.9 - 1.6 * t, fur, { bands: [[0.2, 0.28, st], [0.4, 0.48, st], [0.6, 0.68, st]], tip: [0.84, st] });
    const back = [46, 51, 56, 60.6].map((y, i) => `<path d="M68 ${y}Q${63.6 - (i % 2)} ${n(y + 0.6)} ${61 + i * 0.4} ${n(y + 2.4)}Q${64.4} ${n(y + 2)} 68 ${n(y + 2.2)}Z" fill="${st}" stroke="none"/>`).join('');
    torso(S, fur, BELLY.replace('/>', ` fill="${white}" stroke="none"/>`) + back
      + '<path d="M44 50Q46.4 50.6 47.4 52.4Q45.6 52.2 43.6 52.6Z" fill="#372a98" stroke="none"/>');
    pointEars(S, EAR.tiger[0], EAR.tiger[1], fur, white);
    head(S, fur,
      `<path d="${MUZZLE}" fill="${white}" stroke="none"/>`
      + `<path d="M40.6 38.6L38.6 40.2L41.4 40.8z" fill="${white}" stroke="none"/>`
      + `<ellipse cx="42.6" cy="33.4" rx="1.5" ry="1" fill="${white}" stroke="none"/><ellipse cx="49.8" cy="33.6" rx="1.5" ry="1" fill="${white}" stroke="none"/>`
      + `<path d="M51.6 19.6Q50.4 22.6 51.2 25.8Q52.6 22.6 53.6 19.8ZM46.8 20.6Q46.8 23.2 48.2 25Q48.8 22.6 48.8 20.2ZM56.6 20.4Q55.4 22.8 55.6 25.4Q57.6 23.2 58.6 21.2Z" fill="${st}" stroke="none"/>`
      + `<path d="M64 29Q60.6 29.4 58.6 31.2Q61.2 31 64 31.4ZM63.8 33.4Q60.8 33.8 59 35.4Q61.4 35.2 63.6 35.6ZM39.8 29.6Q42 30 43.6 31.6Q41.6 31.6 39.8 31.8Z" fill="${st}" stroke="none"/>`);
    paws(S, fur);
    feet(S, fur);
  }),

  form_wolf: () => sticker((S) => {
    const fur = '#8f9aaf';
    const light = '#edf0f6';
    const dark = '#636d88';
    tail(S, [[58, 58], [72, 64], [62, 81], [41.6, 79.8]], (t) => 6.4 * Math.sin(Math.PI * (0.16 + 0.84 * t)) ** 0.7, fur, { tip: [0.8, dark] });
    torso(S, fur,
      `<path d="M60.5 39C64.8 41 67.6 46 67.4 52C67.3 55 66.6 57.6 65.4 59.6C62.4 55 60.8 47 60.5 39Z" fill="${dark}" stroke="none"/>`
      + BELLY.replace('/>', ` fill="${light}" stroke="none"/>`)
      + '<path d="M51 47.6l1 1.6 1-1.6M55.4 47.6l1 1.6 1-1.6M53 51.6l1 1.6 1-1.6" fill="none" stroke="#9aa3b6" stroke-width="1"/>');
    // ほおの毛（UR の毛並み）
    S.shape('<path d="M62.4 29.4L67.2 31.4L63.8 33.4L67 36.4L62.8 37.4L64.6 41L59.4 41Z"/>', fur, '');
    S.shape('<path d="M41 32.6L36.8 35L40 36.2L37.4 38.8L41.4 39.2Z"/>', fur, '');
    pointEars(S, EAR.wolf[0], EAR.wolf[1], fur, light, dark);
    head(S, light,
      `<path d="M40.3 30.4C40.6 24 45.6 19.8 52 19.8C59.2 19.8 64 25 63.7 30.8C61 31.4 58.4 31.2 56 32.6C54 33.8 52.2 35 50.6 34.4C49.2 33.8 48.2 32.8 46.8 33C45.2 33.2 44.4 34.8 42.8 34.6C41.6 34.4 40.8 32.6 40.3 30.4Z" fill="${fur}" stroke="none"/>`
      + `<path d="M47.6 20.2Q48.4 24 48.6 28.4Q49.4 24 51.6 19.9Z" fill="${dark}" stroke="none"/>`
      + `<path d="M58.6 38.4l2 1.6M57.6 40.2l1.8 1.6" fill="none" stroke="#a9b2c4" stroke-width=".9"/>`);
    paws(S, fur);
    feet(S, fur);
  }),

  form_lion: () => sticker((S) => {
    const fur = '#f2c25e';
    const mane = '#c8622a';
    const maneIn = '#e88f34';
    const light = '#fff3d6';
    const tuft = (t) => (t > 0.76 ? 1.2 + 2.6 * Math.sin(Math.PI * Math.min(1, (t - 0.76) / 0.3)) ** 0.6 : 1.6 - 0.5 * t);
    tail(S, TAIL_THIN, tuft, fur, { tip: [0.77, mane] });
    torso(S, fur, BELLY.replace('/>', ` fill="${light}" stroke="none"/>`)
      + '<path d="M62.8 47.6q1.6 .6 2.2 2M63.4 55.4q1.4 .8 1.6 2.2" fill="none" stroke="#c99a3c" stroke-width="1"/>');
    // たてがみ（外側の濃い色と内側の明るい色の2段）
    const scallop = (cx, cy, rx, ry, count, rot = 0) => {
      const P = [];
      for (let i = 0; i < count; i++) {
        const a = ((rot + (i * 360) / count) * Math.PI) / 180;
        P.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      const r = n(Math.PI * rx / count * 1.15);
      return `M${pt(P[0])}${P.slice(1).concat([P[0]]).map((p) => `A${r} ${r} 0 0 1 ${pt(p)}`).join('')}Z`;
    };
    S.shape(`<path d="${scallop(51.8, 32.4, 15.6, 15.4, 15, -78)}"/>`, mane,
      `<path d="${scallop(51.8, 32.4, 12.6, 12.4, 13, -64)}" fill="${maneIn}" stroke="${mane}" stroke-width="1"/>`);
    roundEars(S, 3.2, fur, '#d98b3a', [42, 21.6], [61.6, 21.2]);
    head(S, fur,
      `<path d="${MUZZLE}" fill="${light}" stroke="none"/>`
      + '<circle cx="42.6" cy="40.8" r=".45" fill="#b0802c" stroke="none"/><circle cx="48.6" cy="40.6" r=".45" fill="#b0802c" stroke="none"/><circle cx="49.8" cy="41.8" r=".45" fill="#b0802c" stroke="none"/>');
    paws(S, fur);
    feet(S, fur);
  }),

  form_bear: () => sticker((S) => {
    const fur = '#a8693a';
    const light = '#f0d3a4';
    const dark = '#6d3f22';
    S.shape('<circle cx="64.6" cy="62" r="3.8"/>', fur, '');
    torso(S, fur,
      BELLY.replace('/>', ` fill="#c98d58" stroke="none"/>`)
      + `<path d="M63.4 45.6l1.4 1.4M64.6 50.6l1.4 1.2M62.4 56.6l1.6 1M57.6 61.4l1.2 1.4" fill="none" stroke="${dark}" stroke-width="1"/>`);
    roundEars(S, 4.4, fur, light);
    head(S, fur,
      `<ellipse cx="46.6" cy="40.7" rx="5.4" ry="3.3" transform="rotate(-6 46.6 40.7)" fill="${light}" stroke="none"/>`
      + `<path d="M56.4 24.2l1.6 1.2M59.8 27.2l1.4 1.4M53.2 22.6l1.2 1.4" fill="none" stroke="${dark}" stroke-width="1"/>`,
      { noseScale: 1.3 });
    paws(S, fur);
    feet(S, fur, dark);
  }),

  // ---- SECRET: きらめきを添える ----
  form_cat: () => sticker((S) => {
    const white = '#fffdf8';
    const orange = '#f2913a';
    const black = '#3d3556';
    // 三毛の長いしっぽ（足の前をまわって左に巻き上がる）
    tail(S, [[60, 60], [70, 76], [44, 84], [33.4, 69]], (t) => 2.5 - 1 * t, black, { bands: [[0.36, 0.56, orange]], tip: [0.86, white] });
    torso(S, white,
      `<path d="M60.5 39C64.8 41 67.6 46 67.4 52C64.4 51.6 61.4 48 60.5 39Z" fill="${orange}" stroke="none"/>`
      + `<path d="M58.4 64.6C61.4 61 65.4 59.6 66.6 57C65.6 62 62 65.4 58.4 64.6Z" fill="${black}" stroke="none"/>`);
    pointEars(S, EAR.cat[0], EAR.cat[1], white, '#ffb7c5');
    head(S, white,
      `<path d="M40.2 33.5C39.6 25 45.4 19.8 52 19.8C49.6 22.4 48.4 25.4 46.2 27.2C44.4 28.8 42 30.2 40.2 33.5Z" fill="${orange}" stroke="none"/>`
      + `<path d="M52 19.8C59.2 19.8 64 25 63.6 32C61 30.6 58.6 28.2 57.4 25.6C56.4 23.4 54.6 21.4 52 19.8Z" fill="${black}" stroke="none"/>`,
      { nose: '#ff8fa8' });
    paws(S, white);
    feet(S, white, '#ff9fb4');
    S.add(`<path d="M42.6 40.2L35.2 38.6M42.6 41.4L35.4 42M49.6 40.4L56.4 38.8M49.8 41.6L56.6 41.6" fill="none" stroke="${INK}" stroke-width=".8"/>`);
    S.add(SECRET_SPARKLES);
  }),

  form_dog: () => sticker((S) => {
    const fur = '#eaa95e';
    const white = '#fffaf0';
    const ear = '#8a4f2c';
    tail(S, [[62, 58], [72, 60], [70, 70], [64.4, 72]], (t) => 2.6 - 1.2 * t, fur, { tip: [0.8, white] });
    torso(S, fur, BELLY.replace('/>', ` fill="${white}" stroke="none"/>`));
    head(S, fur, `<path d="${MUZZLE}" fill="${white}" stroke="none"/><path d="M48.2 20Q47 26 47.6 31.6Q49 33 50.6 31.6Q50.8 25.6 50.6 19.8Z" fill="${white}" stroke="none"/>`, { noseScale: 1.45 });
    // たれ耳（頭の前に垂れる）
    S.shape('<path d="M45.4 21.6C40.6 21 36.4 24 35.8 29.8C35.4 33.6 36.6 35.8 38.8 35.4C41 35 41.2 31.2 42.2 28.4C43 25.8 44.8 24.2 46.4 23.4Z"/>', ear, '');
    S.shape('<path d="M56 21.2C61 20.4 65.2 23.6 66 29.2C66.6 33.2 65.4 35.6 63.2 35.4C61 35.2 60.6 31.6 59.6 28.8C58.8 26.2 57.4 24.4 55.6 23.2Z"/>', ear, '');
    // 首輪
    S.shape('<path d="M42.8 43.4Q51 47.8 60 43.2L60.4 46Q51 50.6 42.4 46.2Z"/>', '#e8414f', '', 1.6);
    S.shape('<circle cx="51.2" cy="50" r="2"/>', '#ffd84a', hl('M50.2 49.4q.3-.8 1-1', 0.7), 1.4);
    paws(S, fur);
    feet(S, fur);
    S.add(SECRET_SPARKLES);
  })
};

// ===== 館のスタッフ（SECRET 7種）: ミアキスくん本人（黄色・紺のしま）に衣装と持ち物を足す =====
// 別の動物にはしない。体の座り方・頭・目・首の位置は上の10種と同じ（帽子・メガネ・首の物がそのまま合う）。
// 決め手（ベレー帽・旗・リュック・ハサミ・パソコン・シーサー頭・犬）は 36px でも読めるよう大きめに描く。
const YEL = '#fcf475';
const YEL_IN = '#f3d65c';
const BLUSH = '#ff9fb4';

/** 星（k 角。オーストラリア国旗の星は7角） */
function starD(cx, cy, ro, ri, k = 5, rot = -90) {
  const P = [];
  for (let i = 0; i < k * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = ((rot + (i * 180) / k) * Math.PI) / 180;
    P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return `M${P.map(pt).join('L')}Z`;
}

/** 小さなリボン（中心 x, y） */
function bow(S, x, y, fill = '#ff6f9f', s = 1) {
  const g = (d) => `<path transform="translate(${x} ${y}) scale(${s})" d="${d}"/>`;
  S.shape(g('M0 0L-4.2-2.8Q-5.2 0-4.2 2.8ZM0 0L4.2-2.8Q5.2 0 4.2 2.8Z'), fill, '', 1.4);
  S.shape(g('M-1.3 -1.2h2.6v2.4h-2.6Z'), fill, '', 1.2);
}

/** 「ちゃん」の顔: 長めのまつげとほおの赤み */
const GIRL_FACE = `<path d="M42.5 35.9L41.2 35M42.2 36.7L40.8 36.4M50.9 36.2L52.2 35.4M51.1 37L52.5 36.8" fill="none" stroke="${INK}" stroke-width=".8"/>`
  + `<ellipse cx="41.6" cy="40.2" rx="1.3" ry=".8" fill="${BLUSH}" stroke="none" opacity=".9"/><ellipse cx="53.8" cy="40.2" rx="1.7" ry=".9" fill="${BLUSH}" stroke="none" opacity=".9"/>`;

/** 頭と体と尾のしま（相棒の画像と同じく、背中側＝右に紺の筆あと） */
const HEAD_STRIPES = `<path d="M64 28.8Q60.6 29.2 58.6 31Q61.2 30.8 64 31.2ZM63.8 33.2Q60.8 33.6 59 35.2Q61.4 35 63.6 35.4ZM59.4 21.4Q57.4 23.2 56.8 25.6Q59 24 61.2 22.8Z" fill="${INK}" stroke="none"/>`;
const BODY_STRIPES = [45, 50.4, 55.8].map((y, i) => `<path d="M68 ${y}Q${63.4 - (i % 2)} ${n(y + 0.6)} ${61 + i * 0.4} ${n(y + 2.4)}Q64.4 ${n(y + 2)} 68 ${n(y + 2.2)}Z" fill="${INK}" stroke="none"/>`).join('');
const TAIL_BANDS = [[0.2, 0.27, INK], [0.4, 0.47, INK], [0.6, 0.67, INK]];

/** ミアキスくん本人。o.back（体の後ろ）→ 尾 → 胴 → o.overTorso → 耳 → 頭 → o.overHead → o.hold（手の物）→ 手 → 足 → o.front */
function miacis(S, o = {}) {
  o.back?.(S);
  tail(S, TAIL_THIN, (t) => 2.9 - 1.6 * t, YEL, { bands: TAIL_BANDS });
  torso(S, o.body || YEL, o.bodyMarks ?? BODY_STRIPES);
  o.overTorso?.(S);
  if (o.ears !== false) pointEars(S, EAR.cat[0], EAR.cat[1], YEL, YEL_IN);
  head(S, YEL, HEAD_STRIPES + (o.face || ''));
  o.overHead?.(S);
  o.hold?.(S);
  paws(S, YEL);
  feet(S, YEL);
  o.front?.(S);
  S.add(o.sparkles ?? SECRET_SPARKLES);
}

/** きらめきの並び（[x, y, r]）と小さな点（[x, y]） */
const sparkles = (big, dots = []) => big.map(([x, y, r]) => sparkle(x, y, r)).join('')
  + dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#fff3a6" stroke="${INK}" stroke-width=".5"/>`).join('');

Object.assign(forms, {
  // デザイナー: ベレー帽・絵筆・パレット ＋ まつげ・ほお・リボン
  staff_designer: () => sticker((S) => miacis(S, {
    face: GIRL_FACE,
    overHead: (S) => {
      S.shape('<path d="M38.4 25.6C36.4 19.4 43.6 14.2 52.8 14C62 13.8 68 18.2 66.4 22.8C65.2 26.2 58.4 27 52 26.8C45.8 26.6 40.2 27.6 38.4 25.6Z"/>', '#e2475f',
        '<path d="M39.6 24.4Q52 22.6 65.4 22.4" fill="none" stroke="#a82a45" stroke-width="1.2"/>' + hl('M44 18.6Q47.4 16 52.4 15.8'));
      S.shape('<path d="M52 14.4L53 11.2L54.6 11.6L54.2 14.4Z"/>', '#e2475f', '', 1.2);
      bow(S, 41.2, 25.4, '#ff7fae', 0.9);
    },
    hold: (S) => {
      // パレット（左手）
      S.shape('<path d="M21.6 42.6C21.4 37.4 27.4 34.6 33.2 35.6C38.8 36.6 40.8 40.4 38.6 43.2C37.4 44.8 38 46.4 38.8 47.6C39.8 49.8 36.6 51.6 31.6 51.4C25.8 51.2 21.8 47.6 21.6 42.6Z"/>', '#f0cf98',
        '<ellipse cx="35.2" cy="45.4" rx="1.5" ry="1.2" fill="#c99a5c" stroke-width=".8"/>'
        + ['#e8414f,25.6,42.4', '#3f8de0,29.4,39.2', '#36b56a,33.6,39.4', '#ffd84a,25.6,47', '#9a5ad8,30.4,48'].map((s) => { const [c, x, y] = s.split(','); return `<circle cx="${x}" cy="${y}" r="1.9" fill="${c}" stroke-width=".8"/>`; }).join('')
        + hl('M24 40.4Q25.4 37.8 28.6 37', 1.1));
      // 絵筆（右手。先に青い絵の具）
      const r = 'transform="translate(61 40) rotate(30)"';
      S.shape(`<path ${r} d="M-1.3-13.6Q0-14.8 1.3-13.6L1.2 2.4H-1.2Z"/>`, '#e8414f', '', 1.4);
      S.shape(`<path ${r} d="M-1.4 2.2H1.4L1.5 5.4H-1.5Z"/>`, '#d6dbe6', '', 1.2);
      S.shape(`<path ${r} d="M-1.6 5.2H1.6Q2 8.6 0 11.4Q-2 8.6-1.6 5.2Z"/>`, '#3f8de0', '', 1.2);
    }
  })),

  // オーストラリア国旗をマントに: 紺地・左上にユニオンジャック・下に連邦の星・右に南十字星
  staff_aussie: () => sticker((S) => miacis(S, {
    back: (S) => {
      const navy = '#16288a';
      const uj = '<svg x="14.6" y="38.6" width="22" height="12.4" viewBox="0 0 60 30" preserveAspectRatio="none">'
        + '<rect width="60" height="30" fill="#012169" stroke="none"/>'
        + '<path d="M0 0L60 30M60 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0L60 30M60 0L0 30" stroke="#e4002b" stroke-width="2.4"/>'
        + '<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#e4002b" stroke-width="6"/></svg>';
      const w = (x, y, r, k = 7) => `<path d="${starD(x, y, r, r * 0.45, k)}" fill="#fff" stroke="none"/>`;
      S.shape('<path d="M45.6 41.2C40 38.6 26 37.6 13.6 37.6L14.8 72C27 74.6 40 73.4 50 71C61 73.6 76 74.6 88.4 71.6L87.4 36.6C78 35.6 64 37.4 57.4 41.2Z"/>', navy,
        uj + w(25.6, 61.6, 4.8) + w(78.2, 41.8, 2.6) + w(71.6, 51.4, 2.6) + w(84, 49.8, 2.4) + w(77.6, 64, 2.9) + w(80.6, 56, 1.5, 5)
        + '<path d="M17 66Q24 70 34 69.6M70 70.4Q78 71.6 86 68.6" fill="none" stroke="#0d1a63" stroke-width="1"/>');
    },
    hold: (S) => {
      // 首の結び目
      S.shape('<path d="M47.2 44.4Q51.4 47.6 56.2 44.2L55.4 48.6Q51.4 50.4 47.6 48.4Z"/>', '#16288a', '<circle cx="51.6" cy="47.2" r="1.3" fill="#ffd84a" stroke-width=".8"/>', 1.4);
    },
    sparkles: sparkles([[28.6, 22, 3.2], [72.6, 24.6, 2.4], [9.6, 52, 2.2], [91, 80, 2.6]], [[33.4, 29.6], [92.6, 30]])
  })),

  // バックパッカー: 体より大きいリュック（寝袋つき）・地図・ハット
  staff_backpacker: () => sticker((S) => miacis(S, {
    ears: false,
    back: (S) => {
      const pack = '#2f9d8f';
      const dark = '#1f6f67';
      S.shape('<path d="M56.6 30.6C56.6 26 60 23.6 65.4 23.6H77.2C82 23.6 85.4 26.4 85.4 31.4L86 67C86 71.8 82.6 74.6 77.6 74.6H65C60 74.6 57.4 71.4 57.2 67Z"/>', pack,
        `<path d="M57 32.6Q71 27.4 85.6 32.6L85.7 41Q71 36.6 57 42Z" fill="${dark}" stroke-width="1.4"/>`
        + '<rect x="69.4" y="38" width="4" height="5" rx="1" fill="#ffd84a" stroke-width="1"/>'
        + `<rect x="64.6" y="50" width="17.6" height="17" rx="3" fill="${dark}" stroke-width="1.4"/><path d="M64.8 55.6H82" fill="none" stroke-width="1"/>`
        + hl('M60.6 29.6Q61.6 27 64.4 26.4', 1.2));
      // 寝袋（上に巻いて結ぶ）
      S.shape('<rect x="55.4" y="14.6" width="32.6" height="10" rx="5"/>', '#e8414f',
        '<ellipse cx="83" cy="19.6" rx="4.4" ry="4.4" fill="#f27a85" stroke-width="1.2"/><path d="M83 19.6m-2.2 0a2.2 2.2 0 1 1 2.2 2.2" fill="none" stroke-width=".9"/>'
        + '<path d="M66.6 14.6v10M76 14.6v10" fill="none" stroke="#7a4a2a" stroke-width="2"/>');
    },
    overTorso: (S) => {
      S.shape('<path d="M58.4 41.8Q61.8 50.4 59.4 61L62.8 61.2Q65 50.4 61.8 41.2Z"/>', '#1f6f67', '<rect x="58.8" y="51" width="4.4" height="3" rx=".8" fill="#ffd84a" stroke-width=".8"/>', 1.4);
    },
    overHead: (S) => {
      const hat = '#d8b06a';
      S.shape('<path d="M33.4 25C34.6 21.6 43.6 20.2 52 20.2C60.6 20.2 69 21.2 70.2 24.2C71 26.6 64 27.4 52 27.4C40 27.4 32.8 27.2 33.4 25Z"/>', hat, '');
      S.shape('<path d="M40.8 22.8C40.2 15.4 45 11.4 51.6 11.4C58.6 11.4 63.2 15.4 62.8 22.8Q51.8 25 40.8 22.8Z"/>', hat,
        '<path d="M40.6 19.4Q51.8 21.8 62.9 19.4L62.8 22.8Q51.8 25 40.8 22.8Z" fill="#8a5a2c" stroke="none"/>'
        + '<path d="M40.6 19.4Q51.8 21.8 62.9 19.4" fill="none" stroke-width="1"/>' + hl('M44 16.4Q46 13.6 49.6 13'));
    },
    hold: (S) => {
      // 地図（左手。折り目つき）
      S.shape('<path d="M21.4 39L27.6 36.8L33.6 39L40 36.8L40.4 51.6L34 53.8L28 51.6L21.8 53.8Z"/>', '#fff1c8',
        '<path d="M23.4 42.6Q26 40 28.6 42Q30 45 27 46.4Q24 47 23.4 42.6Z" fill="#9ed37a" stroke="none"/>'
        + '<path d="M33.8 40.4Q36.4 43.6 34.6 46.4Q33.4 49.4 36.6 51.4" fill="none" stroke="#5aaee8" stroke-width="1.3"/>'
        + '<path d="M24.6 50.2Q28.8 47.6 31 49.2Q33.4 45 36.6 43.4" fill="none" stroke="#e8414f" stroke-width="1" stroke-dasharray="1.4 1.2"/>'
        + '<path d="M35.6 41.6l2 2M37.6 41.6l-2 2" fill="none" stroke="#e8414f" stroke-width="1"/>'
        + '<path d="M27.6 36.8L28 51.6M33.6 39L34 53.8" fill="none" stroke="#d9c38c" stroke-width=".9"/>', 1.6);
    },
    sparkles: sparkles([[26.6, 22, 3], [90.4, 44, 2.4], [25.6, 64, 2.2], [91.4, 76, 2.4]], [[31.4, 30.8], [92, 30]])
  })),

  // スタイリスト: ハサミとくし・腰のシザーケース・整えた前髪 ＋ まつげ・ほお・リボン
  staff_stylist: () => sticker((S) => miacis(S, {
    face: GIRL_FACE,
    overTorso: (S) => {
      // ベルトと腰のシザーケース（くしの柄と予備のハサミの輪がのぞく）
      S.shape('<path d="M45 51.6Q56 54.6 67.6 52L67.4 55Q56 57.6 45.2 54.6Z"/>', '#3a3456', '', 1.2);
      S.shape('<path d="M61.4 46.4h2.4v5h-2.4Z"/>', '#ff8fb0', '', 1);
      S.shape('<circle cx="66.4" cy="47.8" r="1.8"/>', '#dfe4ee', '<circle cx="66.4" cy="47.8" r=".7" fill="#7a4a2a" stroke="none"/>', 1);
      S.shape('<path d="M59.6 50.4H69.2L68.6 61.6Q64.6 64.4 60.4 61.6Z"/>', '#7a4a2a',
        '<path d="M59.8 54.2H69" fill="none" stroke-width="1"/><circle cx="64.4" cy="57.8" r="1" fill="#ffd84a" stroke-width=".7"/>', 1.6);
    },
    overHead: (S) => {
      // 整えた前髪（横に流して、毛先をそろえる）
      S.shape('<path d="M40.8 30.6C40.2 25.2 43.6 21 49 20.2C53.4 19.6 57.8 20.6 60.6 22.8Q63.2 25 63.6 29Q61.8 27.6 60.2 28.8Q58.6 27.4 56.8 28.6Q55.2 27.2 53.4 28.4Q51.6 27 49.8 28.2Q48 26.8 46.2 28Q44.6 27 43 28.4Q41.8 28.8 40.8 30.6Z"/>', '#f7cf4f',
        '<path d="M58.6 21.8Q53.4 23 49.4 27.6M54.6 20.6Q49 22 45 27.4" fill="none" stroke="#d9a520" stroke-width=".9"/>' + hl('M43.4 25.4Q45 22.4 48.8 21.6', 1.3));
      bow(S, 60.4, 21.4, '#ff6f9f', 1);
    },
    hold: (S) => {
      // くし（左手）
      S.shape('<path transform="rotate(-14 31 42)" d="M23.6 38.6H38.4V42L38 46H24.2L23.6 42Z"/>', '#ff8fb0',
        `<path transform="rotate(-14 31 42)" d="M23.8 42H38.2M25.8 42.2V46M27.6 42.2V46M29.4 42.2V46M31.2 42.2V46M33 42.2V46M34.8 42.2V46M36.6 42.2V46" fill="none" stroke="${INK}" stroke-width=".8"/>`
        + hl('M25.4 39.6Q28 38.6 31 38.6', 1), 1.6);
      // ハサミの刃（右手から右上へ大きく開く）
      S.shape('<path d="M62.4 38.4L71.6 21.4Q68.4 31.4 66.2 40.2Z"/>', '#e6eaf2', hl('M66.6 32.2L70.2 24.4', .8), 1.4);
      S.shape('<path d="M63.2 37.4L78.6 27Q71.8 35.2 66 40.6Z"/>', '#e6eaf2', '', 1.4);
    },
    front: (S) => {
      // ハサミの持ち手（指を通した輪）とねじ
      S.shape('<circle cx="64.4" cy="39.2" r="1.3"/>', '#9aa3b6', '', .9);
      S.shape('<path d="M59.4 44.6m-2.8 0a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0-5.6 0Z"/>', '#e8414f', '<circle cx="59.4" cy="44.6" r="1.2" fill="#fff" stroke-width=".7"/>', 1.2);
      S.shape('<path d="M65.6 44.6m-2.8 0a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0-5.6 0Z"/>', '#e8414f', '<circle cx="65.6" cy="44.6" r="1.2" fill="#fff" stroke-width=".7"/>', 1.2);
    },
    sparkles: sparkles([[28.6, 22, 3.2], [80.4, 33, 2.4], [24.6, 62, 2.2], [75.4, 74, 2.8]], [[33.4, 30.6], [72, 14]])
  })),

  // エンジニア: ノートパソコン（画面に </>）・ヘッドセット・パーカー
  staff_engineer: () => sticker((S) => miacis(S, {
    body: '#4c8be0',
    bodyMarks: '<path d="M49 64.4Q52 58.6 58.4 58.6Q63.6 58.8 65 62.6" fill="none" stroke="#2f62b0" stroke-width="1"/>',
    back: (S) => {
      // フード（背中側）
      S.shape('<path d="M55.6 37.6C61.6 32.6 70.6 35.6 70.8 43.4C71 49.4 66 52.4 61.4 50.4Z"/>', '#3a73c8', '<path d="M60 39.4Q66.6 38 68 44.6" fill="none" stroke="#2f62b0" stroke-width="1"/>');
    },
    overTorso: (S) => {
      // フードのふち（首まわり）とひも
      S.shape('<path d="M42.8 42Q52 49.4 64 40.2L66.2 43.4Q53 54 42 45.2Z"/>', '#3a73c8', '', 1.6);
      S.add('<path d="M48.6 44.6Q48 49 48.6 53.4M54.4 44.8Q55.2 49 54.6 53" fill="none" stroke="#fff" stroke-width="1.1"/>'
        + '<rect x="47.6" y="53" width="2" height="2.6" rx=".6" fill="#d6dbe6" stroke-width=".7"/><rect x="53.6" y="52.6" width="2" height="2.6" rx=".6" fill="#d6dbe6" stroke-width=".7"/>');
    },
    overHead: (S) => {
      // ヘッドセット（頭の上のバンド・両耳のカップ・口もとのマイク）
      S.shape('<path d="M39.6 30C38.8 20.4 45.4 15.4 52 15.4C59 15.4 65.4 20.4 65 30L62.8 29.8C63 22.4 58 17.8 52 17.8C46.2 17.8 41.2 22 41.8 30Z"/>', '#3a3456', '', 1.4);
      S.shape('<rect x="60.4" y="26.4" width="6" height="8.6" rx="2.6"/>', '#3a3456', '<rect x="62.4" y="28.2" width="2.2" height="5" rx="1" fill="#4fd0e0" stroke="none"/>', 1.4);
      S.shape('<rect x="37.4" y="26.8" width="4.6" height="7.4" rx="2.2"/>', '#3a3456', '', 1.4);
      S.add('<path d="M39.4 33.6Q38.6 40.4 42.6 42.4" fill="none" stroke="#3a3456" stroke-width="1.4"/><circle cx="43.2" cy="42.6" r="1.3" fill="#3a3456" stroke-width=".8"/>');
    },
    front: (S) => {
      // ノートパソコン（画面をこちらに向けて膝の上）
      S.shape('<rect x="23.6" y="46.6" width="27.4" height="17.4" rx="2"/>', '#cfd5e2',
        '<rect x="25.8" y="48.6" width="23" height="13.4" rx="1" fill="#25304f" stroke="none"/>'
        + '<path d="M32.4 51.8L29 55.4L32.4 59M36 59.6L38.6 51.2M42.2 51.8L45.6 55.4L42.2 59" fill="none" stroke="#6ff0a0" stroke-width="1.6"/>'
        + hl('M27.4 50.4Q29 49.6 31 49.6', 1));
      S.shape('<path d="M21.6 63.4H53L56.4 68.4H18.2Z"/>', '#aab3c6', '<path d="M33.6 66.2h7.4" fill="none" stroke-width="1"/>', 1.6);
    },
    sparkles: sparkles([[28.6, 20, 3.2], [76.4, 26, 2.4], [14.6, 54, 2.2], [75.4, 74, 2.8]], [[31.4, 30.4], [72.4, 16.6]])
  })),

  // シーサーの被り物: たてがみの渦巻き・大きな口。顔は口の中からのぞく
  staff_shisa: () => sticker((S) => {
    const red = '#e8743c';
    const mane = '#b9472a';
    const cream = '#ffe0a8';
    const curl = (x, y, r = 2.2) => `<path d="M${n(x - r)} ${y}a${r} ${r} 0 1 1 ${r} ${r}a${n(r * 0.55)} ${n(r * 0.55)} 0 1 1 ${n(r * 0.3)} ${n(-r * 0.9)}" fill="none" stroke="${cream}" stroke-width="1.1"/>`;
    const scallop = (cx, cy, rx, ry, count, rot) => {
      const P = [];
      for (let i = 0; i < count; i++) {
        const a = ((rot + (i * 360) / count) * Math.PI) / 180;
        P.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      const r = n((Math.PI * rx) / count * 1.2);
      return `M${pt(P[0])}${P.slice(1).concat([P[0]]).map((p) => `A${r} ${r} 0 0 1 ${pt(p)}`).join('')}Z`;
    };
    miacis(S, {
      ears: false,
      back: (S) => {
        // たてがみ（頭をぐるりと囲む）
        S.shape(`<path d="${scallop(52, 30, 20.4, 19.6, 14, -90)}"/>`, mane,
          [[34.6, 26], [35.4, 37.6], [38.4, 46], [69, 25.4], [68.6, 37], [65.4, 45.6], [42, 15], [62, 14.6]].map(([x, y]) => curl(x, y)).join(''));
      },
      overTorso: (S) => {
        // 口の中（顔のまわりのすき間を暗い赤でうめる）
        S.shape('<ellipse cx="52" cy="38.6" rx="15.6" ry="8.6"/>', '#8a2f3c', '', 1.2);
      },
      overHead: (S) => {
        // 耳
        S.shape('<path d="M37.6 15.6Q36.4 9.6 40.6 8.2Q43.6 9 44 13Z"/>', red, '', 1.6);
        S.shape('<path d="M66.4 15.4Q67.6 9.4 63.4 8Q60.4 8.8 60 12.8Z"/>', red, '', 1.6);
        // 上あご（目・眉の渦・大きな鼻・上の歯）
        S.shape('<path d="M35.4 31.8C34 18.4 41.8 9.6 52 9.6C62.2 9.6 70 18.4 68.6 31.8C66.4 33 63.6 32.6 62 32Q52 33.4 42 32C40.4 32.6 37.6 33 35.4 31.8Z"/>', red,
          '<circle cx="44.4" cy="21.2" r="3.6" fill="#fff" stroke-width="1.2"/><circle cx="59.6" cy="21.2" r="3.6" fill="#fff" stroke-width="1.2"/>'
          + '<circle cx="45" cy="21.6" r="1.8" fill="#221b55" stroke="none"/><circle cx="59" cy="21.6" r="1.8" fill="#221b55" stroke="none"/>'
          + `<path d="M39.6 17.6Q41 13.8 45 14.4Q47.6 15 47.2 17.4M64.4 17.6Q63 13.8 59 14.4Q56.4 15 56.8 17.4" fill="none" stroke="${mane}" stroke-width="1.6"/>`
          + `<ellipse cx="52" cy="27.4" rx="4.6" ry="3.1" fill="${mane}" stroke-width="1.2"/><circle cx="50.2" cy="28.2" r=".8" fill="#221b55" stroke="none"/><circle cx="53.8" cy="28.2" r=".8" fill="#221b55" stroke="none"/>`
          + hl('M41.4 14.2Q45 10.8 50 10.6'));
        S.shape('<path d="M42.6 32L44 34.4L45.4 32.3L46.8 34.4L48.2 32.5L49.6 34.4L51 32.6L52.4 34.4L53.8 32.6L55.2 34.4L56.6 32.5L58 34.4L59.4 32.3L60.8 34.4L62.2 32Z"/>', '#fff', '', 1);
        S.shape('<path d="M36.6 33.2L38.6 38.6L40.6 33.6Z"/>', '#fff', '', 1.2);
        S.shape('<path d="M67.4 33.2L65.4 38.6L63.4 33.6Z"/>', '#fff', '', 1.2);
        // 下あご（あごの下から口を受ける。歯は上向き）
        S.shape('<path d="M36 40.4C37.6 47.6 44 51.6 52 51.6C60 51.6 66.6 47.6 68 40.4C65 43.4 61 45.2 56.4 45.6Q52 46.4 47.4 45.8C42.6 45.2 38.6 43.2 36 40.4Z"/>', red,
          `<path d="M44 49.6Q52 51.6 60 49.4" fill="none" stroke="${mane}" stroke-width="1.2"/>`);
        S.shape('<path d="M37.6 42.2L39.8 37.6L41.2 43.8Z"/>', '#fff', '', 1.2);
        S.shape('<path d="M66.4 42.2L64.2 37.6L62.8 43.8Z"/>', '#fff', '', 1.2);
      },
      sparkles: sparkles([[26.6, 18, 3], [78.4, 30, 2.3], [25.6, 64, 2.2], [75.4, 74, 2.8]], [[30.4, 49.6], [76.4, 14.6]])
    });
  }),

  // 赤ちゃん（小さなミアキス）を抱っこひもで抱え、横にミニチュア・シュナウザー
  staff_family: () => sticker((S) => miacis(S, {
    overTorso: (S) => {
      const sling = '#7cc6ef';
      const strap = '#3f8fd0';
      S.shape('<path d="M63.4 41.4L66.4 40.6L67 51.4L64 52Z"/>', strap, '', 1.4);
      // 赤ちゃん（耳・閉じた目・ほお）
      S.shape('<path d="M55.4 47L55.2 41.8L59 44.8Z"/>', YEL, `<path d="M55.8 45.6L55.7 43.4L57.4 44.8Z" fill="${YEL_IN}" stroke="none"/>`, 1.4);
      S.shape('<path d="M61.6 44.4L65.4 42.2L65 47.4Z"/>', YEL, `<path d="M62.8 44.6L64.6 43.6L64.4 45.8Z" fill="${YEL_IN}" stroke="none"/>`, 1.4);
      S.shape('<ellipse cx="60.2" cy="48.8" rx="5.6" ry="4.6"/>', YEL,
        `<path d="M56.8 48.4Q57.8 47.4 58.8 48.4M61.2 48.6Q62.2 47.6 63.2 48.6" fill="none" stroke="${INK}" stroke-width=".8"/>`
        + `<path d="M59.4 50.2Q60 49.8 60.6 50.2Q60.4 50.9 60 50.9Q59.6 50.9 59.4 50.2Z" fill="${INK}" stroke="none"/>`
        + `<ellipse cx="56.6" cy="50.4" rx="1" ry=".6" fill="${BLUSH}" stroke="none"/><ellipse cx="63.6" cy="50.6" rx="1" ry=".6" fill="${BLUSH}" stroke="none"/>`
        + `<path d="M63.2 45.2Q64.2 46.2 64.6 47.6" fill="none" stroke="${INK}" stroke-width=".8"/>`, 1.6);
      // 抱っこひも（前の袋）
      S.shape('<path d="M46.6 52.6C50 51 54 50.8 58 52C61.6 53 65 52.2 67 50.8L66 60.4C62.4 64.2 52 64.2 47.2 61.4Z"/>', sling,
        `<path d="M48.4 54.4C51.6 53.2 55 53.2 58.2 54.2C61.4 55 64 54.4 65.8 53.4" fill="none" stroke="${strap}" stroke-width="1" stroke-dasharray="1.4 1"/>`
        + `<path d="M60.6 57.6C59.6 56.4 60.4 55.4 61.4 55.8C62.4 55.4 63.2 56.4 62.2 57.6L61.4 58.4Z" fill="#ff7fae" stroke="none"/>`);
      S.shape('<circle cx="55.6" cy="52.4" r="1.6"/>', YEL, '', 1.2);
      S.shape('<circle cx="64.4" cy="51.6" r="1.6"/>', YEL, '', 1.2);
    },
    front: (S) => {
      // ミニチュア・シュナウザー（灰色・眉毛・あごひげ）
      const g = '#8d92a6';
      const light = '#eceef4';
      const dark = '#555a70';
      S.shape('<path d="M16 81C14.6 72 17 63.4 24.6 61.6C32.2 63.4 34.8 72 33.4 81Z"/>', g,
        `<path d="M20.6 66.4C22.8 69 26.4 69 28.6 66.4C29.6 71 27.8 75 24.6 75.4C21.4 75 19.6 71 20.6 66.4Z" fill="${light}" stroke="none"/>`);
      S.shape('<rect x="19" y="72.6" width="4.6" height="9" rx="2"/>', light, '<path d="M20.4 81.4v-1.6M22.2 81.4v-1.6" fill="none" stroke-width=".8"/>', 1.4);
      S.shape('<rect x="25.8" y="72.6" width="4.6" height="9" rx="2"/>', light, '<path d="M27.2 81.4v-1.6M29 81.4v-1.6" fill="none" stroke-width=".8"/>', 1.4);
      S.shape('<path d="M15.6 52C15.6 46.4 19.4 43.8 24.6 43.8C29.8 43.8 33.6 46.4 33.6 52L33.4 57.6C33.4 60.6 29.8 62 24.6 62C19.4 62 15.8 60.6 15.8 57.6Z"/>', g,
        // 眉毛・目・あごひげ・鼻
        `<path d="M16.6 50.6L23.4 48.4L23.8 51.2L17.6 52.6ZM32.6 50.6L25.8 48.4L25.4 51.2L31.6 52.6Z" fill="${light}" stroke="none"/>`
        + `<circle cx="20.8" cy="53.4" r="1.1" fill="${INK}" stroke="none"/><circle cx="28.4" cy="53.4" r="1.1" fill="${INK}" stroke="none"/>`
        + `<path d="M17.8 55.6C19.8 54 22.8 54.2 24.6 55.6C26.4 54.2 29.4 54 31.4 55.6C33 59.4 31.4 64.6 24.6 65C17.8 64.6 16.2 59.4 17.8 55.6Z" fill="${light}" stroke-width="1.2"/>`
        + `<path d="M24.6 57.2V60.4M22 58.6Q22.6 61 22.2 62.6M27.2 58.6Q26.6 61 27 62.6" fill="none" stroke="#b9bdcc" stroke-width=".8"/>`
        + `<ellipse cx="24.6" cy="56.2" rx="2" ry="1.4" fill="#2a2440" stroke="none"/>`, 1.8);
      S.shape('<path d="M17 49.4L13.8 46.4L17.4 43.2L22.4 45Z"/>', dark, '', 1.4);
      S.shape('<path d="M32.2 49.4L35.4 46.4L31.8 43.2L26.8 45Z"/>', dark, '', 1.4);
    },
    sparkles: sparkles([[28.6, 22, 3.2], [74, 30, 2.3], [10, 64, 2.2], [75.4, 74, 2.8]], [[31.4, 31.6], [70.4, 20.6]])
  }))
});

const cache = {};

/** 頭にかぶり物がある姿。着せ替えの帽子を重ねると二重になるので、帽子を出さない */
const HEADWEAR = new Set(['staff_designer', 'staff_backpacker', 'staff_shisa']);
export function formHidesHat(item) {
  return !!item && HEADWEAR.has(item.id);
}

/** すがた id ごとの SVG（相棒の画像の代わりに箱いっぱいに置く）。未知の id は空文字 */
export function renderForm(item) {
  if (!item || typeof item.id !== 'string' || !Object.hasOwn(forms, item.id)) return '';
  if (!cache[item.id]) cache[item.id] = forms[item.id]();
  return `<svg class="miacis-form miacis-form-${item.id.replace(/^form_/, '')}" aria-hidden="true" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;overflow:visible;pointer-events:none"><g stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">${cache[item.id]}</g></svg>`;
}
