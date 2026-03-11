import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAppState } from './AppStateContext';
import type { VisionSampleKey } from './api';
import { stockPieces, getImageForGarment } from './stockImages';
import { palette, radius, type } from './theme';

export function WardrobeScreen({
  onNext,
}: {
  onNext: () => void;
}) {
  const {
    garments,
    isLoadingWardrobe,
    wardrobeError,
    addGarmentToWardrobe,
    addGarmentViaVision,
  } = useAppState();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'top' | 'bottom'>('top');
  const [color, setColor] = useState('');
  const [formality, setFormality] = useState<
    'casual' | 'smart_casual' | 'business' | 'formal'
  >('casual');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedVisionSample, setSelectedVisionSample] = useState<VisionSampleKey>('sweater');
  const [visionSaving, setVisionSaving] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  const handleSave = async () => {
    if (!name.trim()) {
      return;
    }

    try {
      setSaving(true);
      setSaveError(null);
      await addGarmentToWardrobe({
        name: name.trim(),
        category,
        color: color.trim(),
        formality,
      });
      setName('');
      setColor('');
      setFormality('casual');
    } catch {
      setSaveError('Could not save this item. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleVisionAdd = async () => {
    try {
      setVisionSaving(true);
      setVisionError(null);
      await addGarmentViaVision(selectedVisionSample);
    } catch {
      setVisionError(
        'Vision beta failed. Per mvp_doc optional flow, this will map to POST /upload once backend is ready.'
      );
    } finally {
      setVisionSaving(false);
    }
  };

  const animatedStyle = {
    opacity: entrance,
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.headlineWrap}>
            <Text style={styles.screenTitle}>Build your wardrobe once</Text>
            <Text style={styles.screenSubtitle}>
              Add essentials and get modern daily looks that feel intentional, minimal, and ready
              for class to internship transitions.
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stockStrip}>
            {stockPieces.map((piece) => (
              <Pressable
                key={piece.key}
                style={[
                  styles.stockCard,
                  selectedVisionSample === piece.key && styles.stockCardSelected,
                ]}
                onPress={() => setSelectedVisionSample(piece.key)}
              >
                <Image source={piece.image} style={styles.stockImage} resizeMode="contain" />
                <Text style={styles.stockLabel}>{piece.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.visionPanel}>
            <Text style={styles.visionTitle}>Vision beta</Text>
            <Text style={styles.visionCopy}>
              Select a sample photo and simulate AI extraction into your wardrobe.
            </Text>
            <Pressable onPress={handleVisionAdd} disabled={visionSaving} style={styles.visionButton}>
              <Text style={styles.visionButtonText}>
                {visionSaving ? 'Analyzing sample...' : 'Add via Vision beta'}
              </Text>
            </Pressable>
            {visionError ? <Text style={styles.errorText}>{visionError}</Text> : null}
          </View>

          {wardrobeError ? <Text style={styles.errorText}>{wardrobeError}</Text> : null}
          {isLoadingWardrobe ? <Text style={styles.helperText}>Loading wardrobe...</Text> : null}

          {garments.map((garment) => (
            <View key={garment.id} style={styles.card}>
              <Image
                source={getImageForGarment(garment.name, garment.category === 'bottom' ? 'bottom' : 'top')}
                style={styles.cardImage}
                resizeMode="contain"
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{garment.name}</Text>
                <Text style={styles.cardMeta}>
                  {garment.category} / {garment.formality.replace('_', ' ')}
                </Text>
                <Text style={styles.cardMeta}>{garment.color || 'neutral tone'}</Text>
              </View>
            </View>
          ))}

          {!isLoadingWardrobe && garments.length === 0 ? (
            <Text style={styles.helperText}>No items yet. Add one top and one bottom to start.</Text>
          ) : null}

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Add garment</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Black pleated trousers"
              placeholderTextColor="#8f8f8a"
              style={styles.input}
            />

            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setCategory('top')}
                    style={[styles.chip, category === 'top' && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, category === 'top' && styles.chipTextActive]}>Top</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCategory('bottom')}
                    style={[styles.chip, category === 'bottom' && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, category === 'bottom' && styles.chipTextActive]}>
                      Bottom
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.col}>
                <Text style={styles.label}>Color</Text>
                <TextInput
                  value={color}
                  onChangeText={setColor}
                  placeholder="Charcoal"
                  placeholderTextColor="#8f8f8a"
                  style={styles.input}
                />
              </View>
            </View>

            <Text style={styles.label}>Formality</Text>
            <View style={styles.chipRow}>
              {(['casual', 'smart_casual', 'business', 'formal'] as const).map((item) => {
                const active = formality === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => setFormality(item)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {item === 'smart_casual' ? 'Smart' : item[0].toUpperCase() + item.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable onPress={handleSave} disabled={saving} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save garment'}</Text>
            </Pressable>

            {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
          </View>

          <Pressable onPress={onNext} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Continue to week events</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  fill: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 26,
    gap: 10,
  },
  headlineWrap: {
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 33,
    lineHeight: 36,
    color: palette.ink,
    fontFamily: type.display,
  },
  screenSubtitle: {
    marginTop: 7,
    fontSize: 14,
    lineHeight: 20,
    color: palette.muted,
    fontFamily: type.body,
  },
  stockStrip: {
    gap: 10,
    paddingBottom: 2,
    paddingRight: 8,
  },
  stockCard: {
    width: 110,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 8,
  },
  stockCardSelected: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  stockImage: {
    width: '100%',
    height: 86,
  },
  stockLabel: {
    marginTop: 4,
    color: palette.inkSoft,
    fontSize: 11,
    fontFamily: type.bodyMedium,
    textAlign: 'center',
  },
  visionPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 12,
    gap: 6,
  },
  visionTitle: {
    color: palette.ink,
    fontSize: 15,
    fontFamily: type.bodyDemi,
  },
  visionCopy: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: type.body,
  },
  visionButton: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  visionButtonText: {
    color: palette.ink,
    fontSize: 12,
    fontFamily: type.bodyDemi,
  },
  helperText: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: type.body,
  },
  errorText: {
    color: palette.error,
    fontSize: 13,
    fontFamily: type.body,
  },
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 10,
    gap: 10,
  },
  cardImage: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: palette.panelStrong,
  },
  cardBody: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 15,
    fontFamily: type.bodyDemi,
  },
  cardMeta: {
    marginTop: 2,
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.body,
  },
  formCard: {
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 14,
    gap: 8,
  },
  formTitle: {
    fontSize: 18,
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  label: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    color: palette.ink,
    fontFamily: type.body,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  col: {
    flex: 1,
    gap: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: palette.panelStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  chipText: {
    color: palette.inkSoft,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  chipTextActive: {
    color: '#f4f4f2',
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#f4f4f2',
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.ink,
    backgroundColor: palette.accentSoft,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
});
