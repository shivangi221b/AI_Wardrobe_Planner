import React, { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
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
import { getApiErrorMessage } from './api';
import { getImageForGarment, shoesImage } from './stockImages';
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
    addGarmentViaSearch,
    searchGarmentCandidates,
  } = useAppState();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'top' | 'bottom' | 'shoes' | 'accessory'>('top');
  const [color, setColor] = useState('');
  const [formality, setFormality] = useState<
    'casual' | 'smart_casual' | 'business' | 'formal'
  >('casual');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [visionSaving, setVisionSaving] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState<'top' | 'bottom' | 'shoes' | 'accessory'>('top');
  const [searchColor, setSearchColor] = useState('');
  const [searchMaterial, setSearchMaterial] = useState('');
  const [searchKind, setSearchKind] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchGender, setSearchGender] = useState<'any' | 'men' | 'women'>('any');
  const [searchResults, setSearchResults] = useState<
    { imageUrl: string; title?: string | null; sourceUrl?: string | null }[]
  >([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState<number | null>(
    null
  );
  const [searchAdding, setSearchAdding] = useState(false);
  const [visibleSearchCount, setVisibleSearchCount] = useState(8);
  const [addMode, setAddMode] = useState<'search' | 'vision' | 'manual'>('search');
  const [wardrobeFilter, setWardrobeFilter] = useState<
    'all' | 'top' | 'bottom' | 'shoes' | 'accessory'
  >('all');

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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets.length) {
        return;
      }
      const asset = result.assets[0];
      await addGarmentViaVision({
        imageUri: asset.uri,
        fileName: asset.fileName || undefined,
        mimeType: asset.mimeType || undefined,
      });
    } catch (error) {
      setVisionError(
        getApiErrorMessage(error, 'Vision beta failed while processing your image. Please try another photo.')
      );
    } finally {
      setVisionSaving(false);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      return;
    }
    try {
      setSearching(true);
      setSearchError(null);
      setSelectedSearchIndex(null);
      setVisibleSearchCount(8);
      const results = await searchGarmentCandidates(q, 20, {
        color: searchColor.trim() || undefined,
        material: searchMaterial.trim() || undefined,
        kind: searchKind.trim() || undefined,
        gender: searchGender === 'any' ? undefined : searchGender,
      });
      setSearchResults(results);
      if (!results.length) {
        setSearchError('No matches found. Try a different query (brand + item + color).');
      }
    } catch (error) {
      setSearchError(getApiErrorMessage(error, 'Search failed. Please try again.'));
    } finally {
      setSearching(false);
    }
  };

  const handleSearchAdd = async () => {
    if (selectedSearchIndex === null) return;
    const selected = searchResults[selectedSearchIndex];
    if (!selected?.imageUrl) return;

    try {
      setSearchAdding(true);
      setSearchError(null);
      await addGarmentViaSearch({
        name: (selected.title || searchQuery || 'Garment').trim(),
        category: searchCategory,
        color: searchColor.trim(),
        formality: 'casual',
        imageUrl: selected.imageUrl,
      });
      setSearchQuery('');
      setSearchColor('');
      setSearchMaterial('');
      setSearchKind('');
      setSearchResults([]);
      setSelectedSearchIndex(null);
    } catch (error) {
      setSearchError(getApiErrorMessage(error, 'Could not add this item. Please try again.'));
    } finally {
      setSearchAdding(false);
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

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Add clothes</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setAddMode('search')}
                style={[styles.chip, addMode === 'search' && styles.chipActive]}
              >
                <Text style={[styles.chipText, addMode === 'search' && styles.chipTextActive]}>
                  Search & add
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAddMode('vision')}
                style={[styles.chip, addMode === 'vision' && styles.chipActive]}
              >
                <Text style={[styles.chipText, addMode === 'vision' && styles.chipTextActive]}>
                  Vision
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAddMode('manual')}
                style={[styles.chip, addMode === 'manual' && styles.chipActive]}
              >
                <Text style={[styles.chipText, addMode === 'manual' && styles.chipTextActive]}>
                  Manual
                </Text>
              </Pressable>
            </View>

            {addMode === 'vision' ? (
              <>
                <Text style={styles.visionTitle}>Vision beta</Text>
                <Text style={styles.visionCopy}>
                  Upload a photo and extract wearable items into clean white-background assets.
                </Text>
                <Pressable onPress={handleVisionAdd} disabled={visionSaving} style={styles.visionButton}>
                  <Text style={styles.visionButtonText}>
                    {visionSaving ? 'Analyzing image...' : 'Upload via Vision beta'}
                  </Text>
                </Pressable>
                {visionError ? <Text style={styles.errorText}>{visionError}</Text> : null}
              </>
            ) : null}

            {addMode === 'search' ? (
              <>
          <Text style={styles.visionTitle}>Search & add</Text>
            <Text style={styles.visionCopy}>
              Type a brand + item (e.g. “Zara black linen shirt”), pick an image, and add it instantly.
            </Text>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Zara black shirt"
              placeholderTextColor="#8f8f8a"
              style={styles.input}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Colour (optional)</Text>
                <TextInput
                  value={searchColor}
                  onChangeText={setSearchColor}
                  placeholder="navy"
                  placeholderTextColor="#8f8f8a"
                  style={styles.input}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Material (optional)</Text>
                <TextInput
                  value={searchMaterial}
                  onChangeText={setSearchMaterial}
                  placeholder="linen, wool, denim"
                  placeholderTextColor="#8f8f8a"
                  style={styles.input}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Type/detail (optional)</Text>
                <TextInput
                  value={searchKind}
                  onChangeText={setSearchKind}
                  placeholder="double-breasted blazer, loafers"
                  placeholderTextColor="#8f8f8a"
                  style={styles.input}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>For</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setSearchGender('any')}
                    style={[
                      styles.chip,
                      searchGender === 'any' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchGender === 'any' && styles.chipTextActive,
                      ]}
                    >
                      All
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSearchGender('women')}
                    style={[
                      styles.chip,
                      searchGender === 'women' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchGender === 'women' && styles.chipTextActive,
                      ]}
                    >
                      Women
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSearchGender('men')}
                    style={[
                      styles.chip,
                      searchGender === 'men' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchGender === 'men' && styles.chipTextActive,
                      ]}
                    >
                      Men
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setSearchCategory('top')}
                    style={[
                      styles.chip,
                      searchCategory === 'top' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchCategory === 'top' && styles.chipTextActive,
                      ]}
                    >
                      Top
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSearchCategory('bottom')}
                    style={[
                      styles.chip,
                      searchCategory === 'bottom' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchCategory === 'bottom' && styles.chipTextActive,
                      ]}
                    >
                      Bottom
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSearchCategory('shoes')}
                    style={[
                      styles.chip,
                      searchCategory === 'shoes' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchCategory === 'shoes' && styles.chipTextActive,
                      ]}
                    >
                      Footwear
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSearchCategory('accessory')}
                    style={[
                      styles.chip,
                      searchCategory === 'accessory' && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        searchCategory === 'accessory' && styles.chipTextActive,
                      ]}
                    >
                      Accessory
                    </Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.col}>
                <Text style={styles.label}>Actions</Text>
                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={handleSearch}
                    disabled={searching}
                    style={styles.visionButton}
                  >
                    <Text style={styles.visionButtonText}>
                      {searching ? 'Searching...' : 'Search'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSearchAdd}
                    disabled={searchAdding || selectedSearchIndex === null}
                    style={[
                      styles.primaryChipButton,
                      (searchAdding || selectedSearchIndex === null) &&
                        styles.primaryChipButtonDisabled,
                    ]}
                  >
                    <Text style={styles.primaryChipButtonText}>
                      {searchAdding ? 'Adding...' : 'Add selected'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {searchResults.length ? (
              <View style={styles.searchResultsGrid}>
                {searchResults.slice(0, visibleSearchCount).map((item, index) => {
                  const active = selectedSearchIndex === index;
                  return (
                    <Pressable
                      key={`${item.imageUrl}-${index}`}
                      onPress={() => setSelectedSearchIndex(index)}
                      style={[
                        styles.searchResultCard,
                        active && styles.searchResultCardActive,
                      ]}
                    >
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={styles.searchResultImage}
                        resizeMode="contain"
                      />
                      <Text
                        numberOfLines={2}
                        style={styles.searchResultTitle}
                      >
                        {item.title || 'Result'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {searchResults.length > visibleSearchCount ? (
              <Pressable
                onPress={() =>
                  setVisibleSearchCount((current) =>
                    Math.min(current + 8, searchResults.length)
                  )
                }
                style={styles.visionButton}
              >
                <Text style={styles.visionButtonText}>Show more results</Text>
              </Pressable>
            ) : null}

            {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}
              </>
            ) : null}

            {addMode === 'manual' ? (
              <>
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
                  <Pressable
                    onPress={() => setCategory('shoes')}
                    style={[styles.chip, category === 'shoes' && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, category === 'shoes' && styles.chipTextActive]}>
                      Footwear
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCategory('accessory')}
                    style={[styles.chip, category === 'accessory' && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, category === 'accessory' && styles.chipTextActive]}>
                      Accessory
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
              </>
            ) : null}
          </View>

          {/* My wardrobe with simple category tabs */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>My wardrobe</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setWardrobeFilter('all')}
                style={[styles.chip, wardrobeFilter === 'all' && styles.chipActive]}
              >
                <Text style={[styles.chipText, wardrobeFilter === 'all' && styles.chipTextActive]}>
                  All
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setWardrobeFilter('top')}
                style={[styles.chip, wardrobeFilter === 'top' && styles.chipActive]}
              >
                <Text style={[styles.chipText, wardrobeFilter === 'top' && styles.chipTextActive]}>
                  Tops
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setWardrobeFilter('bottom')}
                style={[styles.chip, wardrobeFilter === 'bottom' && styles.chipActive]}
              >
                <Text style={[styles.chipText, wardrobeFilter === 'bottom' && styles.chipTextActive]}>
                  Bottoms
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setWardrobeFilter('shoes')}
                style={[styles.chip, wardrobeFilter === 'shoes' && styles.chipActive]}
              >
                <Text style={[styles.chipText, wardrobeFilter === 'shoes' && styles.chipTextActive]}>
                  Footwear
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setWardrobeFilter('accessory')}
                style={[styles.chip, wardrobeFilter === 'accessory' && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    wardrobeFilter === 'accessory' && styles.chipTextActive,
                  ]}
                >
                  Accessories
                </Text>
              </Pressable>
            </View>

            {wardrobeError ? <Text style={styles.errorText}>{wardrobeError}</Text> : null}
            {isLoadingWardrobe ? (
              <Text style={styles.helperText}>Loading wardrobe...</Text>
            ) : null}

            {garments
              .filter((garment) =>
                wardrobeFilter === 'all' ? true : garment.category === wardrobeFilter
              )
              .map((garment) => (
                <View key={garment.id} style={styles.card}>
                  <Image
                    source={
                      garment.primaryImageUrl
                        ? { uri: garment.primaryImageUrl }
                        : garment.category === 'bottom'
                          ? getImageForGarment(garment.name, 'bottom')
                          : garment.category === 'shoes'
                            ? shoesImage
                            : getImageForGarment(garment.name, 'top')
                    }
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
              <Text style={styles.helperText}>
                No items yet. Add one top, one bottom, one footwear item, and one accessory to start.
              </Text>
            ) : null}
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
  visionPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 12,
    gap: 6,
  },
  searchPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 12,
    gap: 8,
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
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  primaryChipButton: {
    borderRadius: radius.pill,
    backgroundColor: palette.ink,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  primaryChipButtonDisabled: {
    opacity: 0.45,
  },
  primaryChipButtonText: {
    color: '#f4f4f2',
    fontSize: 12,
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
  searchResultsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    paddingRight: 12,
  },
  searchResultsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 8,
  },
  searchResultCard: {
    width: 128,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    padding: 8,
    gap: 6,
  },
  searchResultCardActive: {
    borderColor: palette.accent,
  },
  searchResultImage: {
    width: '100%',
    height: 92,
    borderRadius: radius.md,
    backgroundColor: palette.panel,
  },
  searchResultTitle: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: type.body,
  },
});
