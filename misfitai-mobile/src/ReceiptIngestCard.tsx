import React, { useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getApiErrorMessage,
  isApiError,
  parseReceiptUploadFile,
  type ReceiptParsedItem,
} from './api';
import { palette, radius, type } from './theme';
import type { GarmentCategory } from './types';

export interface ConfirmedReceiptItem {
  name: string;
  category: GarmentCategory;
  color?: string;
  brand?: string;
  size?: string;
  price?: number;
  needsConfirmation?: boolean;
}

type ReceiptMode = 'screenshot' | 'pdf';

type DraftReceiptItem = {
  id: string;
  include: boolean;
  name: string;
  brand: string;
  size: string;
  color: string;
  category: GarmentCategory;
  priceInput: string;
  confidence: number;
  needsConfirmation: boolean;
  sourceLine?: string | null;
};

const RECEIPT_MODE_OPTIONS: Array<{ key: ReceiptMode; label: string }> = [
  { key: 'screenshot', label: 'Upload screenshot' },
  { key: 'pdf', label: 'Upload PDF' },
];

const RECEIPT_CATEGORY_OPTIONS: Array<{ key: GarmentCategory; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'dress', label: 'Dress' },
  { key: 'outerwear', label: 'Outerwear' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'accessory', label: 'Accessory' },
];

function formatPriceInput(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return '';
  return price.toFixed(2);
}

function parsePriceInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100) / 100;
}

function toDraftItems(items: ReceiptParsedItem[]): DraftReceiptItem[] {
  return items.map((item, index) => ({
    id: `receipt-${Date.now()}-${index}`,
    include: true,
    name: item.name,
    brand: (item.brand || '').trim(),
    size: (item.size || '').trim(),
    color: (item.color || '').trim(),
    category: item.category,
    priceInput: formatPriceInput(item.price),
    confidence: item.confidence,
    needsConfirmation: item.needsConfirmation,
    sourceLine: item.sourceLine,
  }));
}

export function ReceiptIngestCard({
  userId,
  onAddItems,
}: {
  userId: string;
  onAddItems: (items: ConfirmedReceiptItem[]) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<ReceiptMode>('screenshot');
  const [isParsing, setIsParsing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<DraftReceiptItem[]>([]);

  const selectedCount = useMemo(
    () => draftItems.filter((item) => item.include && item.name.trim()).length,
    [draftItems]
  );

  const updateDraft = (id: string, patch: Partial<DraftReceiptItem>) => {
    setDraftItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const applyParsedItems = (items: ReceiptParsedItem[]) => {
    const drafts = toDraftItems(items);
    setDraftItems(drafts);
    if (drafts.length === 0) {
      setNotice('No wardrobe items detected. Try editing the text or another receipt source.');
    } else {
      setNotice(`Detected ${drafts.length} item${drafts.length === 1 ? '' : 's'}. Review and confirm below.`);
    }
  };

  const getUploadParseError = (error: unknown, fallback: string): string => {
    if (isApiError(error) && (error.status === 404 || error.status === 405)) {
      return 'Receipt parsing is not deployed on this backend yet. Please deploy the latest backend and retry.';
    }
    return getApiErrorMessage(error, fallback);
  };

  const handleParseScreenshot = async () => {
    try {
      setIsParsing(true);
      setParseError(null);
      setNotice(null);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled || !result.assets.length) {
        return;
      }
      const asset = result.assets[0];
      const response = await parseReceiptUploadFile(userId, {
        source: 'screenshot',
        fileUri: asset.uri,
        fileName: asset.fileName || undefined,
        mimeType: asset.mimeType || undefined,
      });
      applyParsedItems(response.parsedItems);
    } catch (error) {
      setParseError(getUploadParseError(error, 'Could not parse this screenshot. Try a clearer receipt image.'));
    } finally {
      setIsParsing(false);
    }
  };

  const handleParsePdf = async () => {
    try {
      setIsParsing(true);
      setParseError(null);
      setNotice(null);
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) {
        return;
      }
      const file = picked.assets[0];
      const response = await parseReceiptUploadFile(userId, {
        source: 'pdf',
        fileUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType || 'application/pdf',
      });
      applyParsedItems(response.parsedItems);
    } catch (error) {
      setParseError(getUploadParseError(error, 'Could not parse this PDF receipt.'));
    } finally {
      setIsParsing(false);
    }
  };

  const handleAddSelected = async () => {
    const selected = draftItems
      .filter((item) => item.include && item.name.trim())
      .map((item): ConfirmedReceiptItem => ({
        name: item.name.trim(),
        category: item.category,
        color: item.color.trim() || undefined,
        brand: item.brand.trim() || undefined,
        size: item.size.trim() || undefined,
        price: parsePriceInput(item.priceInput),
        needsConfirmation: item.needsConfirmation,
      }));

    if (!selected.length) {
      setParseError('Select at least one parsed item to add.');
      return;
    }

    try {
      setIsAdding(true);
      await onAddItems(selected);
      setNotice(`${selected.length} item${selected.length === 1 ? '' : 's'} added from receipt.`);
      setParseError(null);
      setDraftItems([]);
    } catch (error) {
      setParseError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Could not add parsed receipt items. Please try again.'
      );
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Add from receipt</Text>
      <Text style={styles.hint}>
        Upload a screenshot or PDF receipt to pre-fill wardrobe items.
      </Text>

      <View style={styles.modeRow}>
        {RECEIPT_MODE_OPTIONS.map((option) => {
          const active = mode === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                setMode(option.key);
                setParseError(null);
                setNotice(null);
              }}
              style={[styles.modeChip, active && styles.modeChipActive]}
            >
              <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {mode === 'screenshot' ? (
        <Pressable
          onPress={handleParseScreenshot}
          disabled={isParsing}
          style={[styles.actionButton, isParsing && styles.disabled]}
        >
          {isParsing ? <ActivityIndicator color={palette.textOnAccent} /> : <Text style={styles.actionButtonText}>Choose screenshot</Text>}
        </Pressable>
      ) : null}

      {mode === 'pdf' ? (
        <Pressable
          onPress={handleParsePdf}
          disabled={isParsing}
          style={[styles.actionButton, isParsing && styles.disabled]}
        >
          {isParsing ? <ActivityIndicator color={palette.textOnAccent} /> : <Text style={styles.actionButtonText}>Choose PDF receipt</Text>}
        </Pressable>
      ) : null}

      {parseError ? <Text style={styles.error}>{parseError}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {draftItems.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          {draftItems.map((item) => (
            <View key={item.id} style={styles.draftCard}>
              <View style={styles.rowBetween}>
                <Pressable
                  onPress={() => updateDraft(item.id, { include: !item.include })}
                  style={[styles.checkbox, item.include && styles.checkboxActive]}
                  hitSlop={8}
                >
                  {item.include ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </Pressable>
                <Text style={styles.confidence}>
                  Confidence {(item.confidence * 100).toFixed(0)}%
                </Text>
              </View>

              <TextInput
                value={item.name}
                onChangeText={(value) => updateDraft(item.id, { name: value })}
                placeholder="Item name"
                placeholderTextColor={palette.muted}
                style={styles.input}
              />

              <View style={styles.smallRow}>
                <TextInput
                  value={item.brand}
                  onChangeText={(value) => updateDraft(item.id, { brand: value })}
                  placeholder="Brand"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, styles.halfInput]}
                />
                <TextInput
                  value={item.size}
                  onChangeText={(value) => updateDraft(item.id, { size: value })}
                  placeholder="Size"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, styles.halfInput]}
                />
              </View>

              <View style={styles.smallRow}>
                <TextInput
                  value={item.color}
                  onChangeText={(value) => updateDraft(item.id, { color: value })}
                  placeholder="Color"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, styles.halfInput]}
                />
                <TextInput
                  value={item.priceInput}
                  onChangeText={(value) => updateDraft(item.id, { priceInput: value })}
                  placeholder="Price"
                  placeholderTextColor={palette.muted}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.halfInput]}
                />
              </View>

              <View style={styles.categoryRow}>
                {RECEIPT_CATEGORY_OPTIONS.map((option) => {
                  const active = item.category === option.key;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => updateDraft(item.id, { category: option.key })}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                    >
                      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {item.needsConfirmation ? (
                <Text style={styles.confirmTag}>Needs confirmation</Text>
              ) : null}
              {item.sourceLine ? <Text style={styles.sourceLine}>"{item.sourceLine}"</Text> : null}
            </View>
          ))}

          <Pressable
            onPress={handleAddSelected}
            disabled={isAdding}
            style={[styles.actionButton, { marginTop: 8 }, isAdding && styles.disabled]}
          >
            {isAdding ? (
              <ActivityIndicator color={palette.textOnAccent} />
            ) : (
              <Text style={styles.actionButtonText}>
                Add {selectedCount} item{selectedCount === 1 ? '' : 's'} to list
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    padding: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: palette.muted,
    fontFamily: type.bodyDemi,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
    lineHeight: 18,
    marginBottom: 10,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  modeChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modeChipActive: { borderColor: palette.accent, backgroundColor: palette.accent },
  modeChipText: { fontSize: 12, color: palette.inkSoft, fontFamily: type.bodyMedium },
  modeChipTextActive: { color: palette.textOnAccent },
  actionButton: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accent,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: palette.textOnAccent,
    fontSize: 13,
    fontFamily: type.bodyDemi,
  },
  disabled: { opacity: 0.55 },
  error: {
    marginTop: 8,
    fontSize: 12,
    color: palette.error,
    fontFamily: type.body,
  },
  notice: {
    marginTop: 8,
    fontSize: 12,
    color: palette.inkSoft,
    fontFamily: type.body,
  },
  draftCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    padding: 10,
    marginBottom: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.panel,
  },
  checkboxActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  checkboxTick: { color: palette.textOnAccent, fontFamily: type.bodyDemi, fontSize: 12 },
  confidence: { fontSize: 11, color: palette.muted, fontFamily: type.body },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    color: palette.ink,
    fontFamily: type.body,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  smallRow: { flexDirection: 'row', gap: 8 },
  halfInput: { flex: 1 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  categoryChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panel,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  categoryChipActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accent,
  },
  categoryChipText: { fontSize: 11, color: palette.inkSoft, fontFamily: type.bodyMedium },
  categoryChipTextActive: { color: palette.textOnAccent },
  confirmTag: {
    fontSize: 11,
    color: palette.error,
    fontFamily: type.bodyDemi,
    marginTop: 2,
  },
  sourceLine: {
    fontSize: 11,
    color: palette.muted,
    fontFamily: type.body,
    marginTop: 4,
  },
});
