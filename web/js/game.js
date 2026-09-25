/**
 * game.js - Web Audio 効果音合成・自前 Canvas 紙吹雪・演出
 */

// ==========================================
// 1. 効果音 (Web Audio API 合成)
// ==========================================

let audioCtx = null;
const STORAGE_KEY_MUTED = 'miacis_sound_muted';

/**
 * ミュート状態の確認
 */
export function isMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY_MUTED) === 'true';
  } catch {
    return false;
  }
}

/**
 * ミュートの切り替え
 */
export function toggleMute() {
  const current = isMuted();
  const next = !current;
  try {
    localStorage.setItem(STORAGE_KEY_MUTED, String(next));
  } catch {
    // localStorage 利用不可時も動作
  }
  return next;
}

/**
 * AudioContext の取得・初期化（iOS対応）
 */
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// ユーザーの最初の操作で AudioContext をアンロック
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

/**
 * 短いトーンを再生するヘルパー
 */
function playTone(freq, duration, type = 'sine', startTimeOffset = 0, gainVal = 0.15) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  const start = ctx.currentTime + startTimeOffset;
  const stop = start + duration;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);

  gain.gain.setValueAtTime(gainVal, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(start);
  osc.stop(stop);
}

/**
 * 効果音の再生
 * @param {'correct'|'wrong'|'combo'|'win'|'lose'|'packShake'|'cardReveal'|'evolution'} type
 * @param {any} [options]
 */
export function playSfx(type, options = {}) {
  if (isMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    switch (type) {
      case 'correct': {
        // ポン♪（明るい2音上昇）
        playTone(659.25, 0.1, 'sine', 0, 0.15); // E5
        playTone(880.0, 0.18, 'sine', 0.08, 0.15); // A5
        break;
      }

      case 'wrong': {
        // ブブッ（低めの警告音）
        playTone(220, 0.12, 'sawtooth', 0, 0.12);
        playTone(174.61, 0.2, 'sawtooth', 0.1, 0.12);
        break;
      }

      case 'combo': {
        // シャキーン♪（4音アルペジオ）
        playTone(523.25, 0.08, 'triangle', 0, 0.12); // C5
        playTone(659.25, 0.08, 'triangle', 0.05, 0.12); // E5
        playTone(783.99, 0.08, 'triangle', 0.1, 0.14); // G5
        playTone(1046.5, 0.2, 'sine', 0.15, 0.16); // C6
        break;
      }

      case 'win': {
        // 勝利ファンファーレ（明るい和音アルペジオ）
        playTone(523.25, 0.2, 'triangle', 0, 0.15); // C5
        playTone(659.25, 0.2, 'triangle', 0.12, 0.15); // E5
        playTone(783.99, 0.2, 'triangle', 0.24, 0.15); // G5
        playTone(1046.5, 0.6, 'sine', 0.36, 0.2); // C6
        playTone(1318.51, 0.6, 'sine', 0.42, 0.15); // E6
        break;
      }

      case 'lose': {
        // 負け（下降する落ち着いた音）
        playTone(440.0, 0.2, 'sine', 0, 0.12); // A4
        playTone(392.0, 0.25, 'sine', 0.15, 0.12); // G4
        playTone(349.23, 0.4, 'sine', 0.3, 0.1); // F4
        break;
      }

      case 'packShake': {
        // パックの揺れ（小刻みな低音）
        playTone(110, 0.05, 'triangle', 0, 0.1);
        playTone(130, 0.05, 'triangle', 0.06, 0.1);
        playTone(110, 0.08, 'triangle', 0.12, 0.1);
        break;
      }

      case 'cardReveal': {
        const rarity = parseInt(options.rarity, 10) || 1;
        if (rarity === 1) {
          // N: やさしいベル
          playTone(659.25, 0.15, 'sine', 0, 0.12);
          playTone(783.99, 0.3, 'sine', 0.1, 0.15);
        } else if (rarity === 2) {
          // R: 爽快なチャイム
          playTone(587.33, 0.12, 'sine', 0, 0.15);
          playTone(880.0, 0.12, 'sine', 0.08, 0.15);
          playTone(1174.66, 0.4, 'sine', 0.16, 0.18);
        } else if (rarity === 3) {
          // SR: 華やかなゴールドファンファーレ
          playTone(523.25, 0.1, 'triangle', 0, 0.15);
          playTone(659.25, 0.1, 'triangle', 0.08, 0.15);
          playTone(783.99, 0.12, 'triangle', 0.16, 0.18);
          playTone(1046.5, 0.5, 'sine', 0.24, 0.22);
          playTone(1567.98, 0.5, 'sine', 0.3, 0.15);
        } else {
          // UR: 壮大なレインボーファンファーレ
          playTone(440.0, 0.12, 'triangle', 0, 0.16);
          playTone(554.37, 0.12, 'triangle', 0.08, 0.16);
          playTone(659.25, 0.12, 'triangle', 0.16, 0.18);
          playTone(880.0, 0.15, 'triangle', 0.24, 0.2);
          playTone(1108.73, 0.2, 'sine', 0.32, 0.22);
          playTone(1318.51, 0.7, 'sine', 0.4, 0.25);
          playTone(1760.0, 0.8, 'sine', 0.48, 0.2);
        }
        break;
      }

      case 'evolution': {
        // 進化！ドラマチックな長めのファンファーレ
        const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5, 1318.51];
        notes.forEach((freq, idx) => {
          playTone(freq, 0.15 + (idx === notes.length - 1 ? 0.6 : 0), 'triangle', idx * 0.08, 0.15);
        });
        playTone(1046.5, 0.8, 'sine', notes.length * 0.08, 0.25);
        break;
      }
    }
  } catch {
    // オーディオエラーは安全に無視
  }
}


// ==========================================
// 2. 紙吹雪 (自前 Canvas 実装・外部ライブラリなし)
// ==========================================

let confettiCanvas = null;
let confettiAnimId = null;

/**
 * 紙吹雪を発射する
 * prefers-reduced-motion が有効な場合は発射しない
 */
export function triggerConfetti(durationMs = 2500) {
  if (typeof window === 'undefined') return;

  // prefers-reduced-motion のチェック
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // 既存のアニメーションがあれば停止
  if (confettiAnimId) {
    cancelAnimationFrame(confettiAnimId);
    confettiAnimId = null;
  }

  if (!confettiCanvas) {
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'miacis-confetti-canvas';
    confettiCanvas.style.position = 'fixed';
    confettiCanvas.style.top = '0';
    confettiCanvas.style.left = '0';
    confettiCanvas.style.width = '100vw';
    confettiCanvas.style.height = '100vh';
    confettiCanvas.style.pointerEvents = 'none';
    confettiCanvas.style.zIndex = '99999';
    document.body.appendChild(confettiCanvas);
  }

  const canvas = confettiCanvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // Miacis テーマ色を含むパレット
  const colors = [
    '#F6C6CF', // Miacis ピンク
    '#1E6B3C', // Miacis 深緑
    '#F2C200', // Miacis 黄
    '#3b82f6', // ブルー
    '#ec4899', // マゼンタ
    '#ffffff'  // ホワイト
  ];

  const particleCount = 70;
  const particles = [];

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: width * 0.5 + (Math.random() - 0.5) * (width * 0.4),
      y: height * 0.2 + (Math.random() - 0.5) * 50,
      vx: (Math.random() - 0.5) * 10,
      vy: Math.random() * -6 - 2,
      w: Math.random() * 8 + 6,
      h: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      gravity: 0.22 + Math.random() * 0.08,
      drag: 0.98,
      opacity: 1
    });
  }

  const startTime = performance.now();

  function render(now) {
    const elapsed = now - startTime;
    ctx.clearRect(0, 0, width, height);

    let activeCount = 0;

    for (const p of particles) {
      p.vx *= p.drag;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotSpeed;

      if (elapsed > durationMs * 0.7) {
        p.opacity = Math.max(0, 1 - (elapsed - durationMs * 0.7) / (durationMs * 0.3));
      }

      if (p.y < height + 50 && p.opacity > 0) {
        activeCount++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }

    if (activeCount > 0 && elapsed < durationMs) {
      confettiAnimId = requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, width, height);
      confettiAnimId = null;
    }
  }

  confettiAnimId = requestAnimationFrame(render);
}
