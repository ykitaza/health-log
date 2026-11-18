/**
 * 聞くの読み方（設定の「聞く」）：読む速さ、1 語ごとのくり返し、区切りのあいだの間。
 * 端末の声・自然な声のどちらでも、1 語を 1 つの一時ファイルにまとめて鳴らす（lib/listen/audioJoin.ts）。
 * - 速さ：再生の並びの速さ（expo-audio の playbackRate。声の高さは変えない）。その場の読み上げでは読み上げの速さ
 * - くり返し：1 語の音声を、間を挟んで続けて並べる（ファイルは 1 つのまま。今の語と次の語だけの決まりを守る）
 * - 間：区切り（表現・読み・説明…）のあいだ、くり返しのあいだ、語のあと。
 *   自然な声はサーバー（Polly の SSML）が区切りの間を決めるので、くり返しのあいだと語のあとだけに効く
 * 設定は1つ書き出す（準備する）ごとに読むので、変えたら次に準備する語から効く
 */
/** 1文字を読むのにかかる秒（日本語の読み上げのおおよそ） */
export const SECONDS_PER_CHAR = 0.13;

export const SPEEDS = [0.8, 1, 1.2] as const;
export const REPEATS = [1, 2, 3] as const;
export const PAUSES = ['short', 'normal', 'long'] as const;

export type ListenSpeed = (typeof SPEEDS)[number];
export type ListenRepeat = (typeof REPEATS)[number];
export type ListenPause = (typeof PAUSES)[number];
export type ListenPace = { speed: ListenSpeed; repeat: ListenRepeat; pause: ListenPause };

export const DEFAULT_PACE: ListenPace = { speed: 1, repeat: 1, pause: 'normal' };

export const SPEED_LABEL: Record<ListenSpeed, string> = { 0.8: '0.8 倍', 1: '1.0 倍', 1.2: '1.2 倍' };
export const REPEAT_LABEL: Record<ListenRepeat, string> = { 1: '1 回', 2: '2 回', 3: '3 回' };
export const PAUSE_LABEL: Record<ListenPause, string> = { short: '短い', normal: 'ふつう', long: '長い' };

/** 区切り（表現・読み・説明・使い方・例文）のあいだ。ふつうはサーバーの SSML と同じ 800ms（lib/speech.ts の SECTION_BREAK_MS） */
export const SECTION_GAP_MS: Record<ListenPause, number> = { short: 400, normal: 800, long: 1600 };
/** 同じ語のくり返しのあいだと、語のあと（次の語の前） */
export const WORD_GAP_MS: Record<ListenPause, number> = { short: 700, normal: 1500, long: 3000 };

/** 端末に残した値を読む（壊れていたり知らない値なら、その項目は既定） */
export function parsePace(raw: string | null): ListenPace {
  let v: Partial<Record<keyof ListenPace, unknown>> = {};
  try { v = raw ? (JSON.parse(raw) as typeof v) ?? {} : {}; } catch { v = {}; }
  const pick = <K extends keyof ListenPace>(key: K, allowed: readonly ListenPace[K][]): ListenPace[K] =>
    (allowed as unknown[]).includes(v[key]) ? (v[key] as ListenPace[K]) : DEFAULT_PACE[key];
  return { speed: pick('speed', SPEEDS), repeat: pick('repeat', REPEATS), pause: pick('pause', PAUSES) };
}

export const serializePace = (p: ListenPace) => JSON.stringify({ speed: p.speed, repeat: p.repeat, pause: p.pause });

/** 1 語の並べ方。part は区切りの番号（自然な声は音声 1 つなので 0 だけ）、silence は無音の長さ（ms） */
export type Segment = { part: number } | { silence: number };

/**
 * 1 語の並べ方：区切りを間を挟んで読み、それをくり返し回数だけ並べ、くり返しのあいだと語のあとに間を置く。
 * 区切りの書き出しは 1 回だけで、くり返しは同じ音声を使う
 */
export function wordPlan(parts: number, pace: ListenPace): Segment[] {
  const out: Segment[] = [];
  if (parts <= 0) return out;
  for (let r = 0; r < pace.repeat; r++) {
    for (let k = 0; k < parts; k++) {
      if (k > 0) out.push({ silence: SECTION_GAP_MS[pace.pause] });
      out.push({ part: k });
    }
    out.push({ silence: WORD_GAP_MS[pace.pause] });
  }
  return out;
}

/** 1 語にかかる秒の見積もり（速さ・くり返し・間を入れて。web の時計と、ホームの「約 N 分」） */
export function paceSeconds(sections: string[], pace: ListenPace): number {
  const parts = sections.length > 0 ? sections : [''];
  let ms = 0;
  for (const s of wordPlan(parts.length, pace)) {
    ms += 'part' in s ? [...parts[s.part]].length * SECONDS_PER_CHAR * 1000 : s.silence;
  }
  return Math.max(3, Math.round(ms / 1000 / pace.speed));
}
