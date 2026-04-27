import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { palette, radius, type } from './theme';
import type { GarmentCategory } from './types';

export type CollagePiece = {
  name: string;
  image: ImageSourcePropType;
  garmentId?: string;
  hidden?: boolean;
  category?: GarmentCategory;
};

interface OutfitAvatarPreviewProps {
  avatarImageUrl: string | null | undefined;
  collagePieces: CollagePiece[];
  compositeImageUrl: string | null;
  generating: boolean;
  onGenerateComposite: () => void;
  onTap: () => void;
}

const LAYER_ORDER: GarmentCategory[] = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'accessory'];

function categoryLabel(category: GarmentCategory | undefined): string {
  switch (category) {
    case 'outerwear': return 'Outer';
    case 'top': return 'Top';
    case 'dress': return 'Dress';
    case 'bottom': return 'Bottom';
    case 'shoes': return 'Shoes';
    case 'accessory': return 'Acc.';
    default: return '';
  }
}

function resolveExpoSource(image: ImageSourcePropType): number | { uri: string } {
  if (typeof image === 'number') return image;
  if (Array.isArray(image)) return image[0] as { uri: string };
  return image as { uri: string };
}

export function OutfitAvatarPreview({
  avatarImageUrl,
  collagePieces,
  compositeImageUrl,
  generating,
  onGenerateComposite,
  onTap,
}: OutfitAvatarPreviewProps) {
  // When a composite exists it already includes the garments, so we show just
  // the composite image in full width. Otherwise show avatar + tiles side by side.
  const hasComposite = Boolean(compositeImageUrl);

  const sorted = [...collagePieces].sort((a, b) => {
    const ai = a.category ? LAYER_ORDER.indexOf(a.category) : 99;
    const bi = b.category ? LAYER_ORDER.indexOf(b.category) : 99;
    return ai - bi;
  });

  return (
    <Pressable
      style={styles.container}
      onPress={onTap}
      accessibilityRole="button"
      accessibilityLabel="View full outfit detail"
    >
      {hasComposite ? (
        /* ---------- Composite mode: show the stitched preview image ---------- */
        <View style={styles.compositeFrame}>
          <Image
            source={{ uri: compositeImageUrl! }}
            style={styles.compositeImage}
            contentFit="contain"
            cachePolicy="disk"
            transition={220}
          />
          <View style={styles.compositeBadge}>
            <Text style={styles.compositeBadgeText}>Outfit preview ✦</Text>
          </View>
        </View>
      ) : (
        /* ---------- Default mode: avatar portrait left + garment tiles right --- */
        <View style={styles.sideBySide}>
          {/* Left: avatar portrait */}
          <View style={styles.portraitFrame}>
            {avatarImageUrl ? (
              <Image
                source={{ uri: avatarImageUrl }}
                style={styles.portrait}
                contentFit="contain"
                cachePolicy="disk"
                transition={220}
              />
            ) : (
              <View style={styles.silhouette}>
                <Text style={styles.silhouetteIcon}>👤</Text>
                <Text style={styles.silhouetteLabel}>No avatar</Text>
              </View>
            )}

            {/* "Try on" badge */}
            {avatarImageUrl && !generating && (
              <Pressable
                style={styles.generateBadge}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onGenerateComposite();
                }}
                hitSlop={8}
              >
                <Text style={styles.generateBadgeText}>Try on ✦</Text>
              </Pressable>
            )}

            {generating && (
              <View style={styles.generatingOverlay}>
                <ActivityIndicator color={palette.textOnAccent} size="small" />
                <Text style={styles.generatingText}>Generating your look…</Text>
              </View>
            )}
          </View>

          {/* Right: garment tiles stacked by layer */}
          <View style={styles.tilesColumn}>
            {sorted.map((piece, index) => (
              <View
                key={`${piece.name}-${index}`}
                style={[styles.tile, piece.hidden && styles.tileHidden]}
              >
                <Image
                  source={resolveExpoSource(piece.image)}
                  style={styles.tileImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                />
                <View style={styles.tileMeta}>
                  {piece.category ? (
                    <Text style={styles.tileCategory}>{categoryLabel(piece.category)}</Text>
                  ) : null}
                  <Text style={styles.tileName} numberOfLines={1}>{piece.name}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text style={styles.tapHint}>Tap to expand · Long press in detail view to hide items</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  /* ---------- Composite image ---------- */
  compositeFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panelStrong,
    // Portrait ratio for full-body AI-generated images; maxHeight caps on wide web.
    aspectRatio: 0.65,
    width: '70%',
    alignSelf: 'center',
    maxHeight: 420,
  },
  compositeImage: {
    width: '100%',
    height: '100%',
  },
  compositeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  compositeBadgeText: {
    color: palette.textOnAccent,
    fontSize: 10,
    fontFamily: type.bodyDemi,
    letterSpacing: 0.3,
  },
  /* ---------- Side-by-side ---------- */
  sideBySide: {
    flexDirection: 'row',
    gap: 8,
    height: 200,
    maxHeight: 200,
  },
  portraitFrame: {
    width: '42%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portrait: {
    width: '100%',
    height: '100%',
  },
  silhouette: {
    alignItems: 'center',
    gap: 4,
    padding: 12,
  },
  silhouetteIcon: {
    fontSize: 36,
  },
  silhouetteLabel: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.body,
    textAlign: 'center',
  },
  generateBadge: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  generateBadgeText: {
    color: palette.textOnAccent,
    fontSize: 11,
    fontFamily: type.bodyDemi,
  },
  generatingOverlay: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  generatingText: {
    color: palette.textOnAccent,
    fontSize: 11,
    fontFamily: type.body,
  },
  /* ---------- Garment tiles ---------- */
  tilesColumn: {
    flex: 1,
    gap: 6,
  },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.panelStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
    paddingHorizontal: 6,
    gap: 6,
  },
  tileHidden: {
    opacity: 0.4,
    borderStyle: 'dashed',
    borderColor: palette.lineStrong,
  },
  tileImage: {
    width: 40,
    height: 40,
  },
  tileMeta: {
    flex: 1,
    gap: 1,
  },
  tileCategory: {
    color: palette.muted,
    fontSize: 9,
    fontFamily: type.bodyDemi,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tileName: {
    color: palette.ink,
    fontSize: 11,
    fontFamily: type.bodyMedium,
  },
  tapHint: {
    textAlign: 'center',
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.body,
  },
});
