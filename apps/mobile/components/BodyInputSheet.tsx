import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DailyBody } from '@/lib/body';
import { formatJpDate } from '@/lib/date';
import { LIMITS, MEMO_MAX_LENGTH, memoLengthError, parseInRange } from '@/lib/limits';
import { fmt1, kgToUnit, trimNumber, WeightUnit } from '@/lib/units';
import { colors, fonts, radius, space } from '@/theme';
import { Input } from './Input';
import { Sheet, Shake } from './motion';
import { T } from './Text';
import { Button } from './ui';

type Field = 'weightKg' | 'bodyFatPct';
type Texts = Record<Field | 'memo', string>;
export type BodyInputPatch = Partial<{ weightKg: number | null; bodyFatPct: number | null; memo: string }>;

/** 欄に出す文字（体重は単位に直す。小数の余計な 0 は出さない） */
function textsOf(day: DailyBody | null, unit: WeightUnit): Texts {
  const v = (n: number | null | undefined, conv = (x: number) => x) => (n == null ? '' : trimNumber(conv(n)));
  return { weightKg: v(day?.weightKg, (x) => kgToUnit(x, unit)), bodyFatPct: v(day?.bodyFatPct), memo: day?.memo ?? '' };
}

/**
 * 計測を入れるシート（からだの今日の「入力・編集」「計測を入れる」）。体重・体脂肪率・メモ。
 * 欄にはその日に出している値（手入力が先、なければ取り込み）を入れておき、変えた欄だけを手入力として保存する。
 * 欄を空にして保存すると手入力の値だけを消す（取り込みの値があれば、それに戻る）。取り込みの記録は消さない
 */
export function BodyInputSheet({ visible, date, day, imported, unit, onClose, onSave }: {
  visible: boolean; date: string; day: DailyBody | null; imported: DailyBody | null; unit: WeightUnit;
  onClose: () => void;
  /** 変えた項目だけを渡す（何も変えていなければ空）。保存が終わったら閉じる */
  onSave: (patch: BodyInputPatch) => Promise<void>;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      {/* Sheet は閉じると中身を外すので、開くたびにその日の値で欄を作り直す（閉じる動きの間は、入れた文字のまま） */}
      <Body key={`${date}-${unit}`} date={date} day={day} imported={imported} unit={unit} onSave={onSave} />
    </Sheet>
  );
}

function Body({ date, day, imported, unit, onSave }: {
  date: string; day: DailyBody | null; imported: DailyBody | null; unit: WeightUnit; onSave: (patch: BodyInputPatch) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [saved] = useState(() => textsOf(day, unit));
  const [texts, setTexts] = useState<Texts>(saved);
  const [errors, setErrors] = useState<Partial<Record<Field | 'memo', string>>>({});
  // 間違えた回数（そのたびに欄を揺らす）
  const [shakes, setShakes] = useState<Record<Field, number>>({ weightKg: 0, bodyFatPct: 0 });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const patch: BodyInputPatch = {};
    const next: typeof errors = {};
    const limits = { weightKg: LIMITS.bodyWeight, bodyFatPct: LIMITS.bodyFat } as const;
    for (const f of ['weightKg', 'bodyFatPct'] as const) {
      // 出した値のままなら保存しない（lb で出した体重を kg に戻すと、丸めで値が変わるため。取り込みの値を手入力にしないため）
      if (texts[f].trim() === saved[f]) continue;
      const parsed = parseInRange(texts[f], limits[f], unit);
      if ('error' in parsed) next[f] = parsed.error;
      else patch[f] = parsed.value;
    }
    if (texts.memo.trim() !== saved.memo) {
      const tooLong = memoLengthError(texts.memo);
      if (tooLong) next.memo = tooLong;
      else patch.memo = texts.memo.trim();
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setShakes((s) => ({ weightKg: s.weightKg + (next.weightKg ? 1 : 0), bodyFatPct: s.bodyFatPct + (next.bodyFatPct ? 1 : 0) }));
      return;
    }
    setBusy(true);
    try {
      await onSave(patch);
    } finally {
      setBusy(false);
    }
  };

  const hasImported = imported != null && (imported.weightKg != null || imported.bodyFatPct != null);
  return (
    <KeyboardAvoidingView behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, paddingBottom: space.l + insets.bottom, gap: space.l }}>
        <View style={{ gap: space.s }}>
          <T variant="headlineS" accessibilityRole="header">計測を入れる</T>
          <T variant="bodyM" color={colors.sub}>
            {formatJpDate(date)}{hasImported ? '・Health Connect から取り込んだ値は、ここで直せます' : ''}
          </T>
        </View>
        <View style={{ flexDirection: 'row', gap: space.m }}>
          <NumberField
            label="体重" unit={unit} value={texts.weightKg} shake={shakes.weightKg} error={errors.weightKg != null}
            onChange={(t) => setTexts((x) => ({ ...x, weightKg: t }))}
            imported={imported?.weightKg != null ? `取り込み ${fmt1(kgToUnit(imported.weightKg, unit))} ${unit}` : null}
          />
          <NumberField
            label="体脂肪率" unit="%" value={texts.bodyFatPct} shake={shakes.bodyFatPct} error={errors.bodyFatPct != null}
            onChange={(t) => setTexts((x) => ({ ...x, bodyFatPct: t }))}
            imported={imported?.bodyFatPct != null ? `取り込み ${fmt1(imported.bodyFatPct)} %` : null}
          />
        </View>
        <View style={[s.field, errors.memo != null && s.fieldError]}>
          <Input
            value={texts.memo}
            onChangeText={(t) => setTexts((x) => ({ ...x, memo: t }))}
            maxLength={MEMO_MAX_LENGTH}
            placeholder="例：朝・起床後に計測"
            accessibilityLabel="体組成のメモ"
            style={s.memoInput}
          />
          <View style={s.fieldLabel} pointerEvents="none">
            <T variant="bodyS" color={errors.memo != null ? colors.danger : colors.sub}>メモ</T>
          </View>
        </View>
        {(['weightKg', 'bodyFatPct', 'memo'] as const).map((k) => errors[k] && (
          <T key={k} variant="bodyS" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginTop: -space.s }}>{errors[k]}</T>
        ))}
        <T variant="bodyS" color={colors.sub}>
          手入力した値が取り込みより先に出ます。欄を空にして保存すると、取り込みの値に戻ります（取り込みがなければ消えます）
        </T>
        <Button label={busy ? '保存しています…' : '保存'} busy={busy} onPress={save} testID="body-save" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** M3 の outlined text field（高さ 56、ラベルは枠の上）。下に取り込みの値。間違いは赤の 2px の枠と揺れ */
function NumberField({ label, unit, value, shake, error, onChange, imported }: {
  label: string; unit: string; value: string; shake: number; error: boolean; onChange: (t: string) => void; imported: string | null;
}) {
  const [focused, setFocused] = useState(false);
  const tone = error ? colors.danger : focused ? colors.accent : null;
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Shake trigger={shake}>
        <View style={[s.field, tone != null && { borderColor: tone, borderWidth: 2 }]}>
          <Input
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="decimal-pad"
            placeholder="—"
            accessibilityLabel={label}
            style={s.numberInput}
          />
          <T variant="bodyM" color={colors.sub}>{unit}</T>
          <View style={s.fieldLabel} pointerEvents="none">
            <T variant="bodyS" color={tone ?? colors.sub}>{label}</T>
          </View>
        </View>
      </Shake>
      {imported && <T variant="bodyS" color={colors.sub} style={{ paddingLeft: space.l }}>{imported}</T>}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', height: 56, borderWidth: 1, borderColor: colors.outline, borderRadius: radius.input, paddingHorizontal: space.l, gap: space.s },
  fieldError: { borderColor: colors.danger, borderWidth: 2 },
  fieldLabel: { position: 'absolute', top: -9, left: 12, paddingHorizontal: 4, backgroundColor: colors.card },
  numberInput: { flex: 1, minWidth: 0, height: 52, color: colors.text, fontFamily: fonts.numBold, fontSize: 22 },
  memoInput: { flex: 1, minWidth: 0, height: 52, color: colors.text, fontFamily: fonts.regular, fontSize: 16 },
});
