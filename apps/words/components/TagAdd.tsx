import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { NameTakenError } from '@/db/repositories/catalog';
import { useRepos } from '@/hooks/data';
import { Tag, TAG_KIND_LABELS, TagKind } from '@/lib/types';
import { colors, fonts, space } from '@/theme';
import { AddChip, Button, T } from './ui';

/**
 * タグの並びの最後の「＋」。押すと名前の欄が出て、足したタグを返す（同じ名前があれば、そのタグを使う）
 */
export function TagAdd({ kind, tags, onAdded }: { kind: TagKind; tags: Tag[]; onAdded: (tag: Tag) => void }) {
  const repos = useRepos();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = `${TAG_KIND_LABELS[kind]}のタグを足す`;

  const add = async () => {
    const n = name.trim();
    if (!n) { setOpen(false); return; }
    try {
      const tag = await repos.catalog.addTag(kind, n);
      onAdded(tag);
      setName('');
      setOpen(false);
      setError(null);
    } catch (e) {
      if (e instanceof NameTakenError) {
        const same = tags.find((t) => t.kind === kind && t.name === n);
        if (same) { onAdded(same); setName(''); setOpen(false); return; }
        setError('同じ名前のタグがあります');
      } else setError('足せませんでした');
    }
  };

  if (!open) return <AddChip label={label} onPress={() => setOpen(true)} testID={`tag-add-${kind}`} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexBasis: '100%' }}>
      <TextInput
        autoFocus
        value={name}
        onChangeText={setName}
        onSubmitEditing={add}
        placeholder="新しいタグ"
        placeholderTextColor={colors.sub}
        accessibilityLabel={label}
        maxLength={20}
        style={{ flex: 1, fontFamily: fonts.sans, fontSize: 16, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.accent, minHeight: 48 }}
        testID={`tag-input-${kind}`}
      />
      <Button label="足す" variant="text" small onPress={add} testID={`tag-save-${kind}`} />
      {error && <T variant="caption" color={colors.sub}>{error}</T>}
    </View>
  );
}
