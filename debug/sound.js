/* 音效层：全部用 WebAudio 现场合成，不依赖任何音频素材文件。

   三条约定：
   1. 浏览器不允许没交互就出声，所以第一次 pointerdown / keydown 才解锁
      AudioContext（unlock()）；iOS 之后还可能再挂起，所以每次交互都顺手 resume。
   2. 每个音都短、轻、干燥，只有一两下；做成旋律会盖过思考。
   3. 同一个音 60ms 内重复直接丢掉，避免连点/连续事件刷成噪音。

   对外只有 play / unlock / isMuted / setMuted，外加一个 log 方便自测。 */

const REPEAT_GAP_MS = 60;
const NOISE_SECONDS = 0.4;

export function createSoundLayer({ storageKey = "catania-sound", volume = 0.5 } = {}) {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  try {
    muted = localStorage.getItem(storageKey) === "off";
  } catch (error) {
    muted = false;
  }

  const lastPlayedAt = new Map();
  const log = [];
  const recent = [];

  function ensureContext() {
    if (context) return context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = Math.min(1, Math.max(0, volume));
    master.connect(context.destination);
    return context;
  }

  function unlock() {
    const ctx = ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function noiseSource() {
    if (!noiseBuffer) {
      const length = Math.floor(context.sampleRate * NOISE_SECONDS);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    return source;
  }

  /** 一个短音：三角/正弦为主，可带滑音。 */
  function tone({ at, freq, to = freq, dur, type = "triangle", gain = 0.06, delay = 0 }) {
    const start = at + delay;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur);
    }
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  /** 一段带通噪音：木、纸、骰子这些质感主要靠它。 */
  function hiss({ at, dur, freq, q = 1, gain = 0.05, sweepTo = null, delay = 0 }) {
    const start = at + delay;
    const source = noiseSource();
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, start);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(filter).connect(amp).connect(master);
    source.start(start, Math.random() * 0.2, dur + 0.03);
  }

  const VOICES = {
    /* 按钮：一小下，像指甲磕木头 */
    click: (at) => {
      tone({ at, freq: 1180, to: 760, dur: 0.05, gain: 0.04 });
      hiss({ at, dur: 0.028, freq: 2600, q: 0.8, gain: 0.018 });
    },
    /* 掷骰：三下落桌，间距递减，最后垫一记闷响 */
    dice: (at) => {
      hiss({ at, dur: 0.05, freq: 1700, q: 1.2, gain: 0.07 });
      hiss({ at, dur: 0.045, freq: 1400, q: 1.2, gain: 0.06, delay: 0.07 });
      hiss({ at, dur: 0.05, freq: 1150, q: 1.2, gain: 0.065, delay: 0.13 });
      tone({ at, freq: 150, to: 108, dur: 0.13, type: "sine", gain: 0.05, delay: 0.18 });
    },
    /* 收资源：纸声 + 一记轻亮音 */
    gain: (at) => {
      hiss({ at, dur: 0.12, freq: 3200, q: 0.6, gain: 0.032, sweepTo: 1800 });
      tone({ at, freq: 880, to: 1320, dur: 0.14, type: "sine", gain: 0.045, delay: 0.02 });
    },
    /* 修路：笔刷扫过去 */
    road: (at) => {
      hiss({ at, dur: 0.16, freq: 900, q: 0.9, gain: 0.05, sweepTo: 2400 });
      tone({ at, freq: 320, to: 240, dur: 0.09, gain: 0.032, delay: 0.1 });
    },
    /* 落子：木牌压桌 + 一声轻磕 */
    build: (at) => {
      tone({ at, freq: 132, to: 92, dur: 0.2, type: "sine", gain: 0.085 });
      hiss({ at, dur: 0.07, freq: 700, q: 1.4, gain: 0.045, delay: 0.01 });
      tone({ at, freq: 620, to: 520, dur: 0.09, gain: 0.028, delay: 0.05 });
    },
    /* 强盗：先把棋子蹭到位，再一记闷响落桌，最后留一点低频余韵。
       这里刻意不用锯齿波、也不做大幅下滑 —— 那是电子音的下坠感，
       放在木头和纸上很出戏。全部用正弦 + 噪音，和落子/修路同一套材质。 */
    robber: (at) => {
      hiss({ at, dur: 0.13, freq: 900, q: 1.1, gain: 0.034, sweepTo: 420 });
      tone({ at, freq: 140, to: 88, dur: 0.2, type: "sine", gain: 0.095, delay: 0.09 });
      hiss({ at, dur: 0.045, freq: 620, q: 1.7, gain: 0.036, delay: 0.1 });
      tone({ at, freq: 76, to: 60, dur: 0.3, type: "sine", gain: 0.05, delay: 0.15 });
    },
    open: (at) => hiss({ at, dur: 0.16, freq: 1200, q: 0.5, gain: 0.035, sweepTo: 3400 }),
    close: (at) => hiss({ at, dur: 0.14, freq: 3000, q: 0.5, gain: 0.03, sweepTo: 1100 }),
    /* 轮到我了：两声轻的，一低一高。只为提示，不抢戏 */
    turn: (at) => {
      tone({ at, freq: 392, dur: 0.12, type: "sine", gain: 0.05 });
      tone({ at, freq: 588, dur: 0.16, type: "sine", gain: 0.045, delay: 0.11 });
    },
    /* 一块地亮起来时的一声轻点：比按钮还轻，多块就是一小串 */
    ping: (at) => {
      tone({ at, freq: 664, to: 700, dur: 0.1, type: "sine", gain: 0.028 });
    },
    /* 报价单上桌：纸滑过去，末尾轻轻压一下 */
    paper: (at) => {
      hiss({ at, dur: 0.15, freq: 2600, q: 0.6, gain: 0.03, sweepTo: 1500 });
      tone({ at, freq: 300, to: 236, dur: 0.1, type: "sine", gain: 0.03, delay: 0.13 });
    },
    /* 回应盖戳：木槌压一下，后面那声才是结论。上行=接受，下行=拒绝。
       和 robber 一样刻意避开锯齿/方波，保持木头和纸的材质。 */
    "stamp-yes": (at) => {
      tone({ at, freq: 152, to: 112, dur: 0.12, type: "sine", gain: 0.062 });
      hiss({ at, dur: 0.05, freq: 900, q: 1.4, gain: 0.03, delay: 0.01 });
      tone({ at, freq: 620, to: 880, dur: 0.16, type: "sine", gain: 0.042, delay: 0.06 });
    },
    "stamp-no": (at) => {
      tone({ at, freq: 152, to: 112, dur: 0.12, type: "sine", gain: 0.062 });
      hiss({ at, dur: 0.05, freq: 800, q: 1.4, gain: 0.03, delay: 0.01 });
      tone({ at, freq: 318, to: 238, dur: 0.18, type: "sine", gain: 0.04, delay: 0.06 });
    },
    /* 成交：货过手。两声轻快上行，比结算音短一截、低一档，免得抢戏 */
    deal: (at) => {
      hiss({ at, dur: 0.09, freq: 3000, q: 0.7, gain: 0.026, sweepTo: 2200 });
      tone({ at, freq: 494, dur: 0.12, type: "sine", gain: 0.045, delay: 0.02 });
      tone({ at, freq: 659, dur: 0.16, type: "sine", gain: 0.04, delay: 0.11 });
    },
    /* 银行/港口兑换：两下轻磕加一记翻纸，不做"硬币叮当"那种街机音 */
    coin: (at) => {
      tone({ at, freq: 1180, to: 980, dur: 0.07, type: "sine", gain: 0.03 });
      hiss({ at, dur: 0.09, freq: 2400, q: 0.8, gain: 0.022, delay: 0.04 });
      tone({ at, freq: 1480, to: 1240, dur: 0.08, type: "sine", gain: 0.026, delay: 0.07 });
    },
    /* 操作被拒：两声短闷音。用三角波而不是方波 —— 方波是"8 位提示音"，
       在这种纸上木头里太跳；三角波沉一点，仍然明确是"不行"。 */
    error: (at) => {
      tone({ at, freq: 176, to: 150, dur: 0.1, gain: 0.036 });
      tone({ at, freq: 150, to: 128, dur: 0.12, gain: 0.036, delay: 0.12 });
    },
    /* 结算：三音上行 */
    win: (at) => {
      [523, 659, 784].forEach((freq, index) =>
        tone({ at, freq, dur: 0.22, type: "sine", gain: 0.055, delay: index * 0.13 }),
      );
    },
  };

  function play(name) {
    const voice = VOICES[name];
    if (!voice) return;
    const entry = { name, at: Date.now(), played: false };
    log.push(entry);
    if (log.length > 40) log.shift();
    if (muted) return;

    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = Date.now();
    if (now - (lastPlayedAt.get(name) || 0) < REPEAT_GAP_MS) return;
    lastPlayedAt.set(name, now);

    try {
      voice(ctx.currentTime + 0.001);
      entry.played = true;
      /* 和 lastOnlineMessage 一个路子：留个可观测的落点，方便在页面上核对音效有没有发出去。
         用滚动串而不是只记最后一个 —— 一次交互常常连着两个音（按钮 click + 弹窗 open）。 */
      recent.push(name);
      if (recent.length > 8) recent.shift();
      document.body.dataset.soundLog = recent.join(",");
    } catch (error) {
      /* 音效出问题不该影响对局，静默吞掉 */
      entry.failed = String(error?.message || error);
    }
  }

  return {
    play,
    unlock,
    isMuted: () => muted,
    setMuted(next) {
      muted = Boolean(next);
      try {
        localStorage.setItem(storageKey, muted ? "off" : "on");
      } catch (error) {
        /* 存不了就算了，本次会话内仍然生效 */
      }
    },
    get state() {
      return context ? context.state : "none";
    },
    get log() {
      return log;
    },
  };
}
