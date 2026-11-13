import { DateKey } from '@/lib/date';
import { isReportOrder, parseReport, parseSteps, parseStepsDone, Report, ReportKind, ReportOrder, ReportRow } from '@/lib/reports';
import { serializeWrites } from '../serial';
import type { Db, Deps } from '../types';

const COLUMNS = 'id, title, body, kind, period_start, period_end, overall_tone, headline, highlights, next_steps, links, review, next_steps_done, created_at';
/** 本文を除いた列（listWithoutBody 用。本文は最大20,000字あるので、要らない用途では読まない） */
const LIGHT_COLUMNS = 'id, title, kind, period_start, period_end, overall_tone, headline, highlights, next_steps, links, review, next_steps_done, created_at';

/** 閉じた「まだ作っていないまとめ」の key（lib/reports.ts の PendingReport）。端末だけに覚える（同期しない sync_meta に置く） */
const DISMISSED_PENDING = 'reports.dismissed_pending';
/** 覚えておく数。出す範囲は日7＋週4＋月1（と今日）なので、古いものは捨ててよい */
const DISMISSED_MAX = 50;
/** 開いた（見た）レポートの ID。新しいレポートのお知らせと、一覧の「新着」の印に使う。端末だけに覚える（同期しない） */
const SEEN = 'reports.seen';
/** 一覧の並び順（lib/reports.ts の ReportOrder）。端末だけ */
const LIST_ORDER = 'reports.list_order';
/** 「自動で作る」で、ChatGPT にスケジュールを頼んだ日（'YYYY-MM-DD'）。端末だけ */
const SCHEDULE_REQUESTED = 'reports.schedule_requested_on';

/**
 * レポート（同期で受け取った、MCP の save_report のまとめ）。アプリからは読むのと消すのと、次の一歩のチェックだけ（ほかは書き換えない）。
 * 消すと delete、チェックすると next_steps_done だけの update を、トリガーが outbox に積み、次の同期でサーバーに届く
 */
export function reportRepository(db: Db, deps: Deps) {
  const meta = async (key: string) => (await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null;
  const setMeta = (key: string, value: string) => db.runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value],
  );
  /** 文字の並びとして覚えた値。まだなければ null、壊れていれば [] */
  async function stringList(key: string): Promise<string[] | null> {
    const raw = await meta(key);
    if (raw == null) return null;
    try {
      const list: unknown = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }
  const dismissedPending = async () => (await stringList(DISMISSED_PENDING)) ?? [];
  const liveIds = async () => (await db.getAllAsync<{ id: string }>('SELECT id FROM reports WHERE deleted_at IS NULL', [])).map((r) => r.id);

  async function list(): Promise<Report[]> {
    const rows = await db.getAllAsync<ReportRow>(
      `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`, [],
    );
    return rows.map(parseReport);
  }

  /**
   * 本文（body）を除いた一覧（並びは list と同じ。本文は '' になる）。
   * 詳細画面のストリークと「先週やることの振り返り」のように、期間と次の一歩だけが要る用途で使う
   * （本文は1件最大20,000字あり、開くたびに全件分を読むと無駄が大きいため）
   */
  async function listWithoutBody(): Promise<Report[]> {
    const rows = await db.getAllAsync<Omit<ReportRow, 'body'>>(
      `SELECT ${LIGHT_COLUMNS} FROM reports WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`, [],
    );
    return rows.map((row) => parseReport({ ...row, body: '' }));
  }

  /**
   * 見たレポートの ID。まだ覚えていなければ（この機能が入って初めて動いたとき）、今あるレポートを全部見たことにする
   * （古いレポートが全部お知らせにならないように）
   */
  async function seenIds(): Promise<Set<string>> {
    const seen = await stringList(SEEN);
    if (seen != null) return new Set(seen);
    const ids = await liveIds();
    await setMeta(SEEN, JSON.stringify(ids));
    return new Set(ids);
  }

  return serializeWrites(db, {
    /** 消していないレポート（作った時刻の新しい順、同じなら ID の順。一覧の並びは lib/reports.ts の sortReports） */
    list,

    /** 本文を除いた一覧（listWithoutBody。詳細画面のストリーク・先週の振り返り用） */
    listWithoutBody,

    /** 見たレポートの ID（初めて呼んだときは、今あるものを全部見たことにする） */
    seenIds,

    /**
     * まだ開いていないレポート（作った時刻の新しい順）。
     * kind が 'other'（分析レポート）は出さない（latest と同じく、アプリのどこにも表示しない決まり。お知らせの帯にも出ない）
     */
    async unread(): Promise<Report[]> {
      const seen = await seenIds();
      return (await list()).filter((r) => r.kind !== 'other' && !seen.has(r.id));
    },

    /**
     * 見たことにする（中身の画面を開いたとき、お知らせを閉じたとき）。同期の対象ではないので、書き込みの列には並べない。
     * 消えたレポートの ID は捨てる（覚える数が増え続けないように）
     */
    async markSeen(ids: string[]): Promise<void> {
      const seen = await seenIds();
      const before = seen.size;
      for (const id of ids) seen.add(id);
      if (seen.size === before) return;
      const live = new Set(await liveIds());
      await setMeta(SEEN, JSON.stringify([...seen].filter((id) => live.has(id))));
    },

    /** 一覧の並び順。覚えていなければ新しい順 */
    async listOrder(): Promise<ReportOrder> {
      const v = await meta(LIST_ORDER);
      return isReportOrder(v) ? v : 'newest';
    },

    async setListOrder(order: ReportOrder): Promise<void> {
      await setMeta(LIST_ORDER, order);
    },

    /** 「自動で作る」でスケジュールを頼んだ日。まだなら null */
    async scheduleRequestedOn(): Promise<DateKey | null> {
      const v = await meta(SCHEDULE_REQUESTED);
      return v != null && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    },

    async setScheduleRequestedOn(date: DateKey): Promise<void> {
      await setMeta(SCHEDULE_REQUESTED, date);
    },

    /**
     * 最新のレポート。kind が 'other'（分析レポート）は出さない（アプリのどこにも表示しない決まり。データは消さず、ここで隠すだけ）。
     * ホームの「最新のレポート」と、レポートのタブの入口が使う
     */
    async latest(): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(
        `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL AND kind != 'other' ORDER BY created_at DESC, id DESC LIMIT 1`, [],
      );
      return row && parseReport(row);
    },

    /**
     * その種類（日・週・月）の最新のレポート。詳細画面の期間タブが、種類ごとにいちばん新しい1件へ切り替えるのに使う。なければ null。
     * kind は日・週・月だけを受けるので、'other' はここでも出ない
     */
    async latestOfKind(kind: Exclude<ReportKind, 'other'>): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(
        `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1`, [kind],
      );
      return row && parseReport(row);
    },

    /** その日の日のまとめ（期間がその日だけの daily）。いくつかあれば、いちばん新しいもの */
    async dailyFor(date: string): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(
        `SELECT ${COLUMNS} FROM reports WHERE deleted_at IS NULL AND kind = 'daily' AND period_start = ? AND period_end = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`, [date, date],
      );
      return row && parseReport(row);
    },

    async get(id: string): Promise<Report | null> {
      const row = await db.getFirstAsync<ReportRow>(`SELECT ${COLUMNS} FROM reports WHERE id = ? AND deleted_at IS NULL`, [id]);
      return row && parseReport(row);
    },

    /** 閉じた「まだ作っていないまとめ」の key（古い順） */
    dismissedPending,

    /** 「まだ作っていないまとめ」を閉じ、もう出さない。同期の対象ではないので、書き込みの列（serializeWrites）には並べない */
    async dismissPending(key: string): Promise<void> {
      const list = (await dismissedPending()).filter((k) => k !== key);
      list.push(key);
      await setMeta(DISMISSED_PENDING, JSON.stringify(list.slice(-DISMISSED_MAX)));
    },

    /**
     * 済んだ次の一歩の番号を置き換える（ホームの「今週やること」とレポートの中身のチェック）。番号は小さい順に並べ、
     * 次の一歩にない番号は捨てる。変わらなければ書かない（トリガーは next_steps_done だけの update を積む）
     */
    async setStepsDone(id: string, done: number[]): Promise<void> {
      const row = await db.getFirstAsync<{ next_steps: string | null; next_steps_done: string | null }>(
        'SELECT next_steps, next_steps_done FROM reports WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!row) return;
      const count = parseSteps(row.next_steps).length;
      const next = parseStepsDone(JSON.stringify(done), count);
      if (JSON.stringify(parseStepsDone(row.next_steps_done, count)) === JSON.stringify(next)) return;
      await db.runAsync('UPDATE reports SET next_steps_done = ?, updated_at = ? WHERE id = ?', [JSON.stringify(next), deps.now().toISOString(), id]);
    },

    async remove(id: string): Promise<void> {
      const now = deps.now().toISOString();
      await db.runAsync('UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id]);
    },
  }, ['remove', 'setStepsDone']);
}
