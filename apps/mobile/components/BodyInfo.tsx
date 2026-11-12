import { useEffect, useRef, useState } from 'react';
import { ActivityChoice, SexChoice } from '@/components/GoalProfile';
import { Field } from '@/components/Field';
import { T } from '@/components/Text';
import { Card } from '@/components/ui';
import { useFocusData } from '@/hooks/data';
import { parseBirthYear } from '@/lib/autoGoal';
import { LIMITS, parseInRange } from '@/lib/limits';
import { kgToUnit, trimNumber, WeightUnit } from '@/lib/units';
import { colors, space } from '@/theme';

/**
 * 体の情報のカード（アカウントの画面）：身長・目標体重・性別・生まれた年・ふだんの活動の量。
 * 身長・目標体重・活動の量は設定（同期する）、性別と生まれた年は端末だけ（同期しない）。欄を離れたときに保存する。
 * 目標体重は、設定の重さの単位で出し、入れる
 */
export function BodyInfoCard() {
  const { data: settings, reload, repos } = useFocusData((r) => r.settings.get());
  // 性別と生まれた年は端末だけ（同期しない）
  const { data: profile, reload: reloadProfile } = useFocusData((r) => r.settings.profile());
  const [birthYear, setBirthYear] = useState<string | null>(null);
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // 間違いのある欄と、間違えた回数（そのたびに欄を揺らす）
  const [bad, setBad] = useState<{ field: 'height' | 'goal' | 'birthYear'; count: number } | null>(null);
  const fail = (field: 'height' | 'goal' | 'birthYear', error: string) => { setMessage(error); setBad((b) => ({ field, count: (b?.count ?? 0) + 1 })); };
  const ok = () => { setMessage(null); setBad(null); };

  const unit = settings?.weightUnit ?? 'kg';
  // 入力欄は、読み込んだときと単位を変えたときだけ保存済みの値で埋める（入力中の値を消さない）
  const shownUnit = useRef<WeightUnit | null>(null);
  useEffect(() => {
    if (!settings || shownUnit.current === settings.weightUnit) return;
    shownUnit.current = settings.weightUnit;
    setHeight(settings.heightCm == null ? '' : trimNumber(settings.heightCm));
    setGoal(settings.goalWeightKg == null ? '' : trimNumber(kgToUnit(settings.goalWeightKg, settings.weightUnit)));
  }, [settings]);

  const save = async (patch: Parameters<typeof repos.settings.update>[0]) => { await repos.settings.update(patch); reload(); };

  const saveHeight = () => {
    const parsed = parseInRange(height, LIMITS.height);
    if ('error' in parsed) { fail('height', parsed.error); return; }
    ok();
    save({ heightCm: parsed.value });
  };
  const saveGoal = () => {
    // 出した値のままなら保存しない（lb で出した目標体重を kg に戻すと、丸めで値が変わるため）
    const saved = settings?.goalWeightKg;
    if (goal.trim() === (saved == null ? '' : trimNumber(kgToUnit(saved, unit)))) { ok(); return; }
    const parsed = parseInRange(goal, LIMITS.goalWeight, unit);
    if ('error' in parsed) { fail('goal', parsed.error); return; }
    ok();
    save({ goalWeightKg: parsed.value });
  };

  const saveBirthYear = async () => {
    if (birthYear == null) return;
    const parsed = parseBirthYear(birthYear, new Date().getFullYear());
    if ('error' in parsed) { fail('birthYear', parsed.error); return; }
    ok();
    await repos.settings.setProfile({ birthYear: parsed.value });
    reloadProfile();
  };
  const shownBirthYear = birthYear ?? (profile?.birthYear == null ? '' : String(profile.birthYear));

  return (
    <Card style={{ gap: space.l }}>
      <Field label="身長" unit="cm" shake={bad?.field === 'height' ? bad.count : 0} value={height} onChange={setHeight} onDone={saveHeight} />
      <Field label="目標体重" unit={unit} shake={bad?.field === 'goal' ? bad.count : 0} value={goal} onChange={setGoal} onDone={saveGoal} />
      <SexChoice value={profile?.sex ?? null} onChange={async (sex) => { await repos.settings.setProfile({ sex }); reloadProfile(); }} />
      <Field label="生まれた年" unit="年" shake={bad?.field === 'birthYear' ? bad.count : 0} value={shownBirthYear} onChange={setBirthYear} onDone={saveBirthYear} />
      <ActivityChoice value={settings?.activity ?? null} onChange={(activity) => save({ activity })} />
      {message && <T variant="bodyS" color={colors.danger}>{message}</T>}
      <T variant="bodyS" color={colors.sub}>身長はからだの自動計算（BMI など）に、目標体重はからだの「目標体重まで」に使います。身長・目標体重・性別・生まれた年・活動の量は、食事の目標の自動計算にも使います。空にすると消えます。</T>
      <T variant="bodyS" color={colors.sub}>性別と生まれた年はこの端末の中だけに置き、サーバーには送りません。</T>
    </Card>
  );
}
