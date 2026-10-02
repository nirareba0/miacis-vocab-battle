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

const cache = {};

/** すがた id ごとの SVG（相棒の画像の代わりに箱いっぱいに置く）。未知の id は空文字 */
export function renderForm(item) {
  if (!item || typeof item.id !== 'string' || !Object.hasOwn(forms, item.id)) return '';
  if (!cache[item.id]) cache[item.id] = forms[item.id]();
  return `<svg class="miacis-form miacis-form-${item.id.slice(5)}" aria-hidden="true" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;overflow:visible;pointer-events:none"><g stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">${cache[item.id]}</g></svg>`;
}
