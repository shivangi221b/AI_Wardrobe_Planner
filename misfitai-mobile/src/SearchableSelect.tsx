import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { palette, radius, type } from './theme';

type Props = {
  label: string;
  /** Current value (empty string = none / any). */
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  /** Shown on the closed control when value is empty. */
  emptyLabel?: string;
  optional?: boolean;
};

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel = 'Any',
  optional = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [otherDraft, setOtherDraft] = useState('');
  const [otherVisible, setOtherVisible] = useState(false);

  const filtered = useMemo(() => {
    const q = normalize(filter);
    if (!q) return options;
    return options.filter((o) => normalize(o).includes(q));
  }, [options, filter]);

  useEffect(() => {
    if (!open) {
      setFilter('');
      setOtherDraft('');
      setOtherVisible(false);
    }
  }, [open]);

  const displayValue = value.trim() ? value : optional ? emptyLabel : placeholder ?? 'Select';

  const applyOther = useCallback(() => {
    const t = otherDraft.trim();
    if (t) {
      onChange(t);
      setOpen(false);
    }
  }, [otherDraft, onChange]);

  const pickPreset = useCallback(
    (item: string) => {
      onChange(item);
      setOpen(false);
    },
    [onChange]
  );

  const clear = useCallback(() => {
    onChange('');
    setOpen(false);
  }, [onChange]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${displayValue}`}
      >
        <Text style={[styles.triggerText, !value.trim() && styles.triggerPlaceholder]} numberOfLines={1}>
          {displayValue}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder={placeholder ?? 'Type to filter…'}
              placeholderTextColor="#8f8f8a"
              style={styles.filterInput}
              autoCorrect={false}
              autoCapitalize="none"
            />

            {optional ? (
              <Pressable onPress={clear} style={styles.clearRow}>
                <Text style={styles.clearText}>{emptyLabel}</Text>
              </Pressable>
            ) : null}

            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              initialNumToRender={20}
              maxToRenderPerBatch={30}
              windowSize={10}
              ListHeaderComponent={
                filter.trim() ? (
                  <Text style={styles.hint}>
                    {filtered.length} match{filtered.length === 1 ? '' : 'es'}
                  </Text>
                ) : (
                  <Text style={styles.hint}>Scroll or type to narrow</Text>
                )
              }
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => pickPreset(item)}>
                  <Text style={styles.rowText}>{item}</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>No matches. Use Other below or adjust your search.</Text>
              }
            />

            {!otherVisible ? (
              <Pressable
                style={styles.otherToggle}
                onPress={() => {
                  setOtherVisible(true);
                  setOtherDraft(value.trim());
                }}
              >
                <Text style={styles.otherToggleText}>Other…</Text>
              </Pressable>
            ) : (
              <View style={styles.otherBox}>
                <Text style={styles.otherLabel}>Custom value</Text>
                <TextInput
                  value={otherDraft}
                  onChangeText={setOtherDraft}
                  placeholder="Type brand, color, material, or style"
                  placeholderTextColor="#8f8f8a"
                  style={styles.otherInput}
                  autoCorrect={true}
                />
                <View style={styles.otherActions}>
                  <Pressable style={styles.otherCancel} onPress={() => setOtherVisible(false)}>
                    <Text style={styles.otherCancelText}>Back</Text>
                  </Pressable>
                  <Pressable style={styles.otherApply} onPress={applyOther}>
                    <Text style={styles.otherApplyText}>Use value</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Pressable style={styles.doneBtn} onPress={() => setOpen(false)}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    fontFamily: type.bodyMedium,
    color: palette.muted,
    marginBottom: 6,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: palette.lineStrong,
    borderRadius: radius.sm,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  triggerText: {
    flex: 1,
    fontSize: 15,
    fontFamily: type.body,
    color: palette.ink,
    marginRight: 8,
  },
  triggerPlaceholder: {
    color: palette.muted,
  },
  chevron: {
    fontSize: 14,
    color: palette.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: palette.panel,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: type.bodyDemi,
    color: palette.ink,
    marginBottom: 10,
  },
  filterInput: {
    borderWidth: 1,
    borderColor: palette.lineStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: type.body,
    color: palette.ink,
    marginBottom: 8,
  },
  clearRow: {
    paddingVertical: 10,
    marginBottom: 4,
  },
  clearText: {
    fontSize: 15,
    fontFamily: type.bodyMedium,
    color: palette.accent,
  },
  hint: {
    fontSize: 12,
    fontFamily: type.body,
    color: palette.muted,
    paddingVertical: 6,
  },
  list: {
    maxHeight: 280,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  rowText: {
    fontSize: 16,
    fontFamily: type.body,
    color: palette.ink,
  },
  empty: {
    fontSize: 14,
    fontFamily: type.body,
    color: palette.muted,
    paddingVertical: 16,
  },
  otherToggle: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  otherToggleText: {
    fontSize: 15,
    fontFamily: type.bodyDemi,
    color: palette.accent,
  },
  otherBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
  otherLabel: {
    fontSize: 12,
    fontFamily: type.bodyMedium,
    color: palette.muted,
    marginBottom: 6,
  },
  otherInput: {
    borderWidth: 1,
    borderColor: palette.lineStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: type.body,
    color: palette.ink,
  },
  otherActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 10,
  },
  otherCancel: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  otherCancelText: {
    fontSize: 15,
    fontFamily: type.bodyMedium,
    color: palette.muted,
  },
  otherApply: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: palette.accent,
    borderRadius: radius.sm,
  },
  otherApplyText: {
    fontSize: 15,
    fontFamily: type.bodyDemi,
    color: palette.panelStrong,
  },
  doneBtn: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 12,
  },
  doneText: {
    fontSize: 16,
    fontFamily: type.bodyDemi,
    color: palette.accent,
  },
});
