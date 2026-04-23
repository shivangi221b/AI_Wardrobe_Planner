import React, { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAppState } from './AppStateContext';
import { getApiErrorMessage, isApiError, type VisionPreviewItem } from './api';
import { ReceiptIngestCard, type ConfirmedReceiptItem } from './ReceiptIngestCard';
import { getImageForGarment, shoesImage } from './stockImages';
import { SearchableSelect } from './SearchableSelect';
import {
  SEARCH_BRANDS,
  SEARCH_COLORS,
  SEARCH_MATERIALS,
  SEARCH_KINDS_BY_CATEGORY,
} from './searchOptions';
import { palette, radius, type } from './theme';

const SEARCH_STATUS_MESSAGES = [
  'Looking up the internet...',
  'Asking the fashion goblins...',
  'Rifling through digital closets...',
  'Arguing with the algorithm about taste...',
  'Dusting off runway archives...',
];

const VISION_STATUS_MESSAGES = [
  'Scanning seams and silhouettes...',
  'This is the part where you pretend you\'re patient...',
  'Negotiating with your closet gremlins...',
  'De-wrinkling pixels...',
  'Hold please. Teaching pixels good manners...',
  'Summoning studio lighting...',
  'Hang tight — your wardrobe is being perceived...',
];

export function WardrobeScreen({
  onNext,
  isStepComplete,
}: {
  onNext: () => void;
  isStepComplete: boolean;
}) {
  const {
    userId,
    garments,
    isLoadingWardrobe,
    wardrobeError,
    addGarmentToWardrobe,
    previewVisionItems,
    commitVisionItems,
    addGarmentViaSearch,
    searchGarmentCandidates,
    deleteGarmentFromWardrobe,
  } = useAppState();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<'top' | 'bottom' | 'shoes' | 'accessory'>('top');
  const [formality, setFormality] = useState<
    'casual' | 'smart_casual' | 'business' | 'formal' | null
  >(null);
  const [seasonality, setSeasonality] = useState<'hot' | 'mild' | 'cold' | 'all_season'>(
    'all_season'
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [visionSaving, setVisionSaving] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [visionStatusIndex, setVisionStatusIndex] = useState(0);
  const [visionPreviewItems, setVisionPreviewItems] = useState<VisionPreviewItem[]>([]);
  const [visionSelected, setVisionSelected] = useState<Record<number, boolean>>({});
  const [visionCommitting, setVisionCommitting] = useState(false);
  const [visionZoomUrl, setVisionZoomUrl] = useState<string | null>(null);

  const [searchBrand, setSearchBrand] = useState('');
  const [searchItemKeywords, setSearchItemKeywords] = useState('');
  const [searchCategory, setSearchCategory] = useState<'top' | 'bottom' | 'shoes' | 'accessory'>('top');
  const [searchColor, setSearchColor] = useState('');
  const [searchMaterial, setSearchMaterial] = useState('');
  const [searchKind, setSearchKind] = useState('');
  const [searchFormality, setSearchFormality] = useState<
    'casual' | 'smart_casual' | 'business' | 'formal' | null
  >(null);
  const [searchSeasonality, setSearchSeasonality] = useState<
    'hot' | 'mild' | 'cold' | 'all_season' | null
  >(null);
  const [searching, setSearching] = useState(false);
  const [searchStatusIndex, setSearchStatusIndex] = useState(0);
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
  const [addMode, setAddMode] = useState<'vision' | 'manual' | 'receipt'>('vision');
  const [wardrobeFilter, setWardrobeFilter] = useState<
    'all' | 'top' | 'bottom' | 'shoes' | 'accessory'
  >('all');
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [wardrobeHighlight, setWardrobeHighlight] = useState(false);

  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  useEffect(() => {
    if (!searching) {
      setSearchStatusIndex(0);
      return;
    }
    const id = setInterval(() => {
      setSearchStatusIndex((current) => (current + 1) % SEARCH_STATUS_MESSAGES.length);
    }, 2000);
    return () => clearInterval(id);
  }, [searching]);

  useEffect(() => {
    if (!visionSaving) {
      setVisionStatusIndex(0);
      return;
    }
    const id = setInterval(() => {
      setVisionStatusIndex((current) => (current + 1) % VISION_STATUS_MESSAGES.length);
    }, 3500);
    return () => clearInterval(id);
  }, [visionSaving]);

  useEffect(() => {
    setSearchKind('');
  }, [searchCategory]);

  useEffect(() => {
    if (!saveSuccessMessage) {
      return;
    }
    const id = setTimeout(() => setSaveSuccessMessage(null), 2600);
    return () => clearTimeout(id);
  }, [saveSuccessMessage]);

  useEffect(() => {
    if (!wardrobeHighlight) {
      return;
    }
    const id = setTimeout(() => setWardrobeHighlight(false), 2200);
    return () => clearTimeout(id);
  }, [wardrobeHighlight]);

  const resetDescriptionInputs = () => {
    setName('');
    setFormality(null);
    setSeasonality('all_season');
    setSaveError(null);
  };

  const resetSearchInputs = () => {
    setSearchItemKeywords('');
    setSearchBrand('');
    setSearchColor('');
    setSearchMaterial('');
    setSearchKind('');
    setSearchFormality(null);
    setSearchSeasonality(null);
    setSearchGender('any');
    setSearchResults([]);
    setSelectedSearchIndex(null);
    setVisibleSearchCount(8);
    setSearchError(null);
  };

  const showWardrobeSaved = (message: string) => {
    setSaveSuccessMessage(message);
    setWardrobeHighlight(true);
  };

  const getVisionUploadErrorMessage = (error: unknown): string => {
    if (isApiError(error)) {
      if (error.status === 413) {
        return 'That image is too large. Please upload a smaller clothing-item photo.';
      }
      if (error.status >= 500) {
        return 'We had trouble processing that photo. Please retry in a moment.';
      }
      return getApiErrorMessage(
        error,
        'Could not upload that clothing-item photo. Please try again.'
      );
    }
    const message = error instanceof Error ? error.message : '';
    if (/network request failed|failed to fetch|network/i.test(message)) {
      return 'Upload failed due to a network issue. Check your connection and retry.';
    }
    if (/aborted|timeout/i.test(message)) {
      return 'Upload took too long. Please retry with a smaller, clearer item photo.';
    }
    return 'Could not upload that clothing-item photo. Please try again.';
  };

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
        formality: formality ?? undefined,
        seasonality,
      });
      resetDescriptionInputs();
      showWardrobeSaved('Item saved to wardrobe!');
    } catch {
      setSaveError('Could not save this item. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleVisionAdd = async () => {
    try {
      setVisionError(null);
      setVisionPreviewItems([]);
      setVisionSelected({});
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets.length) {
        return;
      }
      const asset = result.assets[0];
      if (asset.mimeType && !asset.mimeType.startsWith('image/')) {
        setVisionError('Please choose an image file (JPG/PNG/WebP).');
        return;
      }
      if (asset.fileSize && asset.fileSize > 15 * 1024 * 1024) {
        setVisionError('That image is larger than 15MB. Please upload a smaller clothing-item photo.');
        return;
      }
      setVisionSaving(true);
      const items = await previewVisionItems({
        imageUri: asset.uri,
        fileName: asset.fileName || undefined,
        mimeType: asset.mimeType || undefined,
        fileSize: asset.fileSize,
      });
      if (!items.length) {
        setVisionError(
          'No clothing item was detected. Upload one clear photo of a single item on a plain background.'
        );
        return;
      }
      setVisionPreviewItems(items);
      const selected: Record<number, boolean> = {};
      // All selected by default; user can uncheck or use Select all/none.
      items.forEach((_, idx) => (selected[idx] = true));
      setVisionSelected(selected);
    } catch (error: unknown) {
      setVisionError(getVisionUploadErrorMessage(error));
    } finally {
      setVisionSaving(false);
    }
  };

  const handleSearch = async () => {
    const brand = searchBrand.trim();
    const keywords = searchItemKeywords.trim();
    const q = [brand, keywords].filter(Boolean).join(' ').trim();
    if (!q) {
      setSearchError('Choose a brand or add item keywords (or both).');
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
        setSearchError('No matches found. Try different brand, keywords, or filters.');
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
      const fallbackName = [searchBrand, searchKind, searchItemKeywords]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      await addGarmentViaSearch({
        name: (selected.title || fallbackName || 'Garment').trim(),
        category: searchCategory,
        color: searchColor.trim(),
        formality: searchFormality ?? undefined,
        seasonality: searchSeasonality ?? undefined,
        imageUrl: selected.imageUrl,
      });
      setSearchBrand('');
      resetSearchInputs();
      showWardrobeSaved('Item saved to wardrobe!');
    } catch (error) {
      setSearchError(getApiErrorMessage(error, 'Could not add this item. Please try again.'));
    } finally {
      setSearchAdding(false);
    }
  };

  const handleReceiptAdd = async (items: ConfirmedReceiptItem[]): Promise<void> => {
    for (const item of items) {
      try {
        await addGarmentToWardrobe({
          name: item.name,
          category: item.category,
          color: item.color,
          seasonality: 'all_season',
          brand: item.brand,
          size: item.size,
          price: item.price,
        });
      } catch (error) {
        throw new Error(
          getApiErrorMessage(error, `Could not add "${item.name}" from receipt.`)
        );
      }
    }
    showWardrobeSaved(
      `${items.length} item${items.length === 1 ? '' : 's'} added from receipt!`
    );
  };

  // Keep explicit delete confirmation to avoid accidental wardrobe item removal.
  const handleDeletePress = (garment: { id: string; name: string }) => {
    const doDelete = () => {
      deleteGarmentFromWardrobe(garment.id).catch(() => {
        Alert.alert('Error', 'Could not delete item. Please try again.');
      });
    };

    if (Platform.OS === 'web') {
      // Alert.alert multi-button callbacks are unreliable on web (falls back to window.confirm).
      if (window.confirm(`Remove "${garment.name}" from your wardrobe?`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Remove item?',
        `"${garment.name}" will be permanently deleted from your wardrobe.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
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
      <Modal
        visible={Boolean(visionZoomUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setVisionZoomUrl(null)}
      >
        <Pressable style={styles.zoomBackdrop} onPress={() => setVisionZoomUrl(null)}>
          {visionZoomUrl ? (
            <View style={styles.zoomInner}>
              <Image source={{ uri: visionZoomUrl }} style={styles.zoomImage} resizeMode="contain" />
            </View>
          ) : null}
        </Pressable>
      </Modal>
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
                  Describe item
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAddMode('receipt')}
                style={[styles.chip, addMode === 'receipt' && styles.chipActive]}
              >
                <Text style={[styles.chipText, addMode === 'receipt' && styles.chipTextActive]}>
                  Receipt
                </Text>
              </Pressable>
            </View>

            {saveSuccessMessage ? (
              <View style={styles.successBanner}>
                <Text style={styles.successBannerText}>{saveSuccessMessage}</Text>
              </View>
            ) : null}

            {addMode === 'vision' ? (
              <>
                <Text style={styles.visionTitle}>Vision beta</Text>
                <Text style={styles.visionCopy}>
                  Upload a photo to detect clothing items. We'll generate clean, product-style images + metadata, then you choose what to add. Nothing is added until you confirm.
                </Text>
                <Pressable onPress={handleVisionAdd} disabled={visionSaving} style={styles.visionButton}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {visionSaving ? (
                      <ActivityIndicator color={palette.ink} />
                    ) : null}
                    <Text style={styles.visionButtonText}>
                      {visionSaving
                        ? VISION_STATUS_MESSAGES[visionStatusIndex]
                        : 'Upload via Vision beta'}
                    </Text>
                  </View>
                </Pressable>
                {visionError ? <Text style={styles.errorText}>{visionError}</Text> : null}

                {visionPreviewItems.length ? (
                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.formTitle}>Review extracted items</Text>
                      <Pressable
                        onPress={() => {
                          const allSelected = visionPreviewItems.every((_, idx) => visionSelected[idx] === true);
                          const next: Record<number, boolean> = {};
                          visionPreviewItems.forEach((_, idx) => {
                            next[idx] = !allSelected;
                          });
                          setVisionSelected(next);
                        }}
                        style={styles.visionSelectAll}
                      >
                        <Text style={styles.visionSelectAllText}>
                          {visionPreviewItems.every((_, idx) => visionSelected[idx] === true)
                            ? 'Unselect all'
                            : 'Select all'}
                        </Text>
                      </Pressable>
                    </View>
                    {visionPreviewItems.map((item, idx) => {
                      const selected = visionSelected[idx] === true;
                      const metaParts = [
                        item.category,
                        item.color_primary,
                        item.pattern,
                        item.material,
                        item.fit_notes,
                      ].filter(Boolean);
                      return (
                        <View key={`${item.image_url}-${idx}`} style={styles.card}>
                          <Pressable
                            onPress={() =>
                              setVisionSelected((current) => ({
                                ...current,
                                [idx]: !selected,
                              }))
                            }
                            hitSlop={10}
                            style={styles.visionCheckboxWrap}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected }}
                          >
                            <View style={[styles.visionCheckbox, selected ? styles.visionCheckboxChecked : null]}>
                              {selected ? <Text style={styles.visionCheckboxTick}>✓</Text> : null}
                            </View>
                          </Pressable>
                          <Pressable onPress={() => setVisionZoomUrl(item.image_url)}>
                            <Image
                              source={{ uri: item.image_url }}
                              style={styles.cardImage}
                              resizeMode="contain"
                            />
                          </Pressable>
                          <View style={styles.cardBody}>
                            <Text style={styles.cardTitle}>
                              {(item.sub_category || item.category || 'Item').toString()}
                            </Text>
                            {metaParts.length ? (
                              <Text style={styles.cardMeta}>{metaParts.join(' • ')}</Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}

                    <Pressable
                      disabled={visionCommitting}
                      onPress={async () => {
                        const chosen = visionPreviewItems.filter((_, idx) => visionSelected[idx] === true);
                        if (!chosen.length) {
                          setVisionError('Select at least one item to add.');
                          return;
                        }
                        try {
                          setVisionCommitting(true);
                          setVisionError(null);
                          await commitVisionItems(chosen);
                          setVisionPreviewItems([]);
                          setVisionSelected({});
                          showWardrobeSaved(
                            `${chosen.length} item${chosen.length === 1 ? '' : 's'} saved to wardrobe!`
                          );
                        } catch (error) {
                          setVisionError(
                            getApiErrorMessage(
                              error,
                              'Could not save selected items. Please try again.'
                            )
                          );
                        } finally {
                          setVisionCommitting(false);
                        }
                      }}
                      style={[styles.primaryButton, { marginTop: 10 }]}
                    >
                      <Text style={styles.primaryButtonText}>
                        {visionCommitting ? 'Adding...' : 'Add selected to wardrobe'}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}

            {addMode === 'manual' ? (
              <>
                <View style={styles.methodCard}>
                  <View style={styles.methodHeader}>
                    <Text style={styles.methodBadge}>Method 1</Text>
                    <Text style={styles.methodHint}>Direct save</Text>
                  </View>
                  <Text style={styles.visionTitle}>Add by description</Text>
                  <Text style={styles.visionCopy}>
                    Use this if you already know the item details. No image search required.
                  </Text>

                  <Text style={styles.label}>Name</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Black pleated trousers"
                    placeholderTextColor={palette.inputPlaceholder}
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
                          <Text style={[styles.chipText, category === 'bottom' && styles.chipTextActive]}>Bottom</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setCategory('shoes')}
                          style={[styles.chip, category === 'shoes' && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, category === 'shoes' && styles.chipTextActive]}>Footwear</Text>
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
                      <Text style={styles.label}>Formality (optional)</Text>
                      <View style={styles.chipRow}>
                        {(['casual', 'smart_casual', 'business', 'formal'] as const).map((item) => {
                          const active = formality === item;
                          return (
                            <Pressable
                              key={item}
                              onPress={() => setFormality((current) => (current === item ? null : item))}
                              style={[styles.chip, active && styles.chipActive]}
                            >
                              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                {item === 'smart_casual'
                                  ? 'Smart casual'
                                  : item[0].toUpperCase() + item.slice(1)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>

                  <Text style={styles.label}>Seasonality</Text>
                  <View style={styles.chipRow}>
                    {(['all_season', 'hot', 'mild', 'cold'] as const).map((item) => {
                      const active = seasonality === item;
                      const label =
                        item === 'all_season' ? 'All season' : item[0].toUpperCase() + item.slice(1);
                      return (
                        <Pressable
                          key={item}
                          onPress={() => setSeasonality(item)}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Pressable
                    onPress={handleSave}
                    disabled={saving}
                    style={[styles.primaryButton, saving && styles.searchSecondaryButtonDisabled]}
                  >
                    <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save garment'}</Text>
                  </Pressable>
                  {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
                </View>

                <View style={styles.methodDivider} />

                <View style={styles.methodCard}>
                  <View style={styles.methodHeader}>
                    <Text style={styles.methodBadge}>Method 2</Text>
                    <Text style={styles.methodHint}>Search and add</Text>
                  </View>
                  <Text style={styles.visionTitle}>Search a product image and add</Text>
                  <Text style={styles.visionCopy}>
                    Use this when you want to pick an image result first, then add it directly.
                  </Text>

                  <Text style={styles.label}>Category</Text>
                  <View style={styles.chipRow}>
                    <Pressable
                      onPress={() => setSearchCategory('top')}
                      style={[styles.chip, searchCategory === 'top' && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, searchCategory === 'top' && styles.chipTextActive]}>
                        Top
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSearchCategory('bottom')}
                      style={[styles.chip, searchCategory === 'bottom' && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, searchCategory === 'bottom' && styles.chipTextActive]}>
                        Bottom
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSearchCategory('shoes')}
                      style={[styles.chip, searchCategory === 'shoes' && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, searchCategory === 'shoes' && styles.chipTextActive]}>
                        Footwear
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSearchCategory('accessory')}
                      style={[styles.chip, searchCategory === 'accessory' && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, searchCategory === 'accessory' && styles.chipTextActive]}>
                        Accessory
                      </Text>
                    </Pressable>
                  </View>

                  <SearchableSelect
                    label="Brand"
                    value={searchBrand}
                    onChange={setSearchBrand}
                    options={SEARCH_BRANDS}
                    placeholder="Type to filter brands…"
                    emptyLabel="Any brand"
                    optional
                  />
                  <Text style={styles.label}>Item keywords (optional)</Text>
                  <TextInput
                    value={searchItemKeywords}
                    onChangeText={setSearchItemKeywords}
                    placeholder="e.g. linen shirt, running, slim fit"
                    placeholderTextColor={palette.inputPlaceholder}
                    style={styles.input}
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                  />
                  <View style={styles.row}>
                    <View style={styles.col}>
                      <SearchableSelect
                        label="Colour (optional)"
                        value={searchColor}
                        onChange={setSearchColor}
                        options={SEARCH_COLORS}
                        placeholder="Type to filter colours…"
                        emptyLabel="Any"
                        optional
                      />
                    </View>
                    <View style={styles.col}>
                      <SearchableSelect
                        label="Material (optional)"
                        value={searchMaterial}
                        onChange={setSearchMaterial}
                        options={SEARCH_MATERIALS}
                        placeholder="Type to filter materials…"
                        emptyLabel="Any"
                        optional
                      />
                    </View>
                  </View>
                  <SearchableSelect
                    label="Type / detail (optional)"
                    value={searchKind}
                    onChange={setSearchKind}
                    options={SEARCH_KINDS_BY_CATEGORY[searchCategory]}
                    placeholder="Type to filter types…"
                    emptyLabel="Any"
                    optional
                  />
                  <View style={styles.row}>
                    <View style={styles.col}>
                      <Text style={styles.label}>For (optional)</Text>
                      <View style={styles.chipRow}>
                        <Pressable
                          onPress={() => setSearchGender('any')}
                          style={[styles.chip, searchGender === 'any' && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, searchGender === 'any' && styles.chipTextActive]}>
                            All
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setSearchGender('women')}
                          style={[styles.chip, searchGender === 'women' && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, searchGender === 'women' && styles.chipTextActive]}>
                            Women
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setSearchGender('men')}
                          style={[styles.chip, searchGender === 'men' && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, searchGender === 'men' && styles.chipTextActive]}>
                            Men
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>

                  <View style={styles.row}>
                    <View style={styles.col}>
                      <Text style={styles.label}>Formality (optional)</Text>
                      <View style={styles.chipRow}>
                        {(['casual', 'smart_casual', 'business', 'formal'] as const).map((item) => {
                          const active = searchFormality === item;
                          return (
                            <Pressable
                              key={item}
                              onPress={() =>
                                setSearchFormality((current) => (current === item ? null : item))
                              }
                              style={[styles.chip, active && styles.chipActive]}
                            >
                              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                {item === 'smart_casual'
                                  ? 'Smart casual'
                                  : item[0].toUpperCase() + item.slice(1)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.col}>
                      <Text style={styles.label}>Seasonality (optional)</Text>
                      <View style={styles.chipRow}>
                        {(['all_season', 'hot', 'mild', 'cold'] as const).map((item) => {
                          const active = searchSeasonality === item;
                          const label =
                            item === 'all_season'
                              ? 'All season'
                              : item[0].toUpperCase() + item.slice(1);
                          return (
                            <Pressable
                              key={item}
                              onPress={() =>
                                setSearchSeasonality((current) => (current === item ? null : item))
                              }
                              style={[styles.chip, active && styles.chipActive]}
                            >
                              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  </View>

                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={handleSearch}
                      disabled={searching}
                      style={styles.searchPrimaryButton}
                    >
                      <Text style={styles.searchPrimaryButtonText}>
                        {searching ? SEARCH_STATUS_MESSAGES[searchStatusIndex] : 'Search images'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSearchAdd}
                      disabled={searchAdding || selectedSearchIndex === null}
                      style={[
                        styles.searchSecondaryButton,
                        (searchAdding || selectedSearchIndex === null) &&
                          styles.searchSecondaryButtonDisabled,
                      ]}
                    >
                      <Text style={styles.searchSecondaryButtonText}>
                        {searchAdding ? 'Adding...' : 'Add selected to wardrobe'}
                      </Text>
                    </Pressable>
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
                            <Text numberOfLines={2} style={styles.searchResultTitle}>
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
                </View>
              </>
            ) : null}

            {addMode === 'receipt' ? (
              <ReceiptIngestCard userId={userId} onAddItems={handleReceiptAdd} />
            ) : null}

          </View>

          {/* My wardrobe with simple category tabs */}
          <View style={[styles.formCard, wardrobeHighlight && styles.formCardHighlight]}>
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
                  <Pressable
                    onPress={() => {
                      if (garment.primaryImageUrl) {
                        setVisionZoomUrl(garment.primaryImageUrl);
                      }
                    }}
                  >
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
                  </Pressable>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{garment.name}</Text>
                    <Text style={styles.cardMeta}>
                      {garment.category} / {garment.formality.replace('_', ' ')}
                    </Text>
                    {(() => {
                      const rawTags = garment.tags ?? [];
                      const extraTags = rawTags.filter(
                        (tag) => tag !== garment.category && tag !== garment.formality
                      );
                      const details: string[] = [];
                      if (garment.pattern && garment.pattern !== 'solid') details.push(garment.pattern);
                      if (garment.material) details.push(garment.material);
                      if (garment.fitNotes) details.push(garment.fitNotes);
                      if (extraTags.length) details.push(...extraTags);
                      if (!details.length) return null;
                      return (
                        <Text style={styles.cardMeta}>
                          {details.join(' • ')}
                        </Text>
                      );
                    })()}
                  </View>
                  <Pressable
                    onPress={() => handleDeletePress(garment)}
                    style={styles.cardDeleteBtn}
                    hitSlop={8}
                    accessibilityLabel="Delete garment"
                    accessibilityRole="button"
                  >
                    <Text style={styles.cardDeleteBtnText}>×</Text>
                  </Pressable>
                </View>
              ))}

            {!isLoadingWardrobe && garments.length === 0 ? (
              <Text style={styles.helperText}>
                No items yet. Add one top, one bottom, one footwear item, and one accessory to start.
              </Text>
            ) : null}
          </View>

          <Text style={styles.stepHelperText}>
            {isStepComplete
              ? 'Wardrobe complete. Next: connect your calendar.'
              : 'Add at least one top and one bottom to complete this step.'}
          </Text>
          <Pressable onPress={onNext} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Next: Connect your calendar</Text>
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
    position: 'relative',
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 10,
    gap: 10,
  },
  visionCheckboxWrap: {
    alignSelf: 'center',
    paddingLeft: 4,
    paddingRight: 2,
  },
  visionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.lineStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  visionCheckboxChecked: {
    backgroundColor: palette.panelStrong,
  },
  visionCheckboxTick: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
    lineHeight: 16,
  },
  zoomBackdrop: {
    flex: 1,
    backgroundColor: palette.backdropStrong,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  zoomInner: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.backdropSolid,
  },
  zoomImage: {
    width: '100%',
    height: '100%',
  },
  visionSelectAll: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.panelStrong,
  },
  visionSelectAllText: {
    fontSize: 11,
    fontFamily: type.bodyMedium,
    color: palette.muted,
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
  cardDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.panelStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardDeleteBtnText: {
    color: palette.muted,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: type.body,
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
  methodCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    padding: 12,
    gap: 8,
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  methodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    color: palette.textOnAccent,
    fontSize: 11,
    fontFamily: type.bodyDemi,
  },
  methodHint: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.bodyMedium,
  },
  methodDivider: {
    height: 1,
    backgroundColor: palette.line,
    marginVertical: 6,
  },
  formCardHighlight: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  formTitle: {
    fontSize: 18,
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  successBanner: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  successBannerText: {
    color: palette.ink,
    fontSize: 13,
    fontFamily: type.bodyMedium,
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
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
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
    color: palette.textOnAccent,
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: palette.textOnAccent,
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
    color: palette.textOnAccent,
    fontSize: 12,
    fontFamily: type.bodyDemi,
  },
  stepHelperText: {
    marginTop: 10,
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.body,
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
  searchPrimaryButton: {
    flex: 1,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  searchPrimaryButtonText: {
    color: palette.textOnAccent,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  searchSecondaryButton: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.ink,
    backgroundColor: palette.panelStrong,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  searchSecondaryButtonDisabled: {
    opacity: 0.45,
  },
  searchSecondaryButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
});
