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
  const portraitUrl = compositeImageUrl ?? avatarImageUrl;

  // Sort pieces by layer order so tiles always read outerwear → shoes
  const sorted = [...collagePieces].sort((a, b) => {
    const ai = a.category ? LAYER_ORDER.indexOf(a.category) : 99;
    const bi = b.category ? LAYER_ORDER.indexOf(b.category) : 99;
    return ai - bi;
  });

  return (
    <Pressable style={styles.container} onPress={onTap} accessibilityRole="button" accessibilityLabel="View full outfit detail">
      {/* Avatar portrait frame */}
      <View style={styles.portraitFrame}>
        {portraitUrl ? (
          <Image
            source={{ uri: portraitUrl }}
            style={styles.portrait}
            contentFit="cover"
            cachePolicy="disk"
            transition={220}
          />
        ) : (
          <View style={styles.silhouette}>
            <Text style={styles.silhouetteIcon}>👤</Text>
            <Text style={styles.silhouetteLabel}>No avatar yet</Text>
            <Text style={styles.silhouetteHint}>Generate one in Profile</Text>
          </View>
        )}

        {/* "Generate on me" badge — only when avatar exists and no composite yet */}
        {avatarImageUrl && !compositeImageUrl && !generating && (
          <Pressable
            style={styles.generateBadge}
            onPress={(e) => {
              e.stopPropagation?.();
              onGenerateComposite();
            }}
            hitSlop={8}
          >
            <Text style={styles.generateBadgeText}>Generate on me ✦</Text>
          </Pressable>
        )}

        {generating && (
          <View style={styles.generatingOverlay}>
            <ActivityIndicator color={palette.textOnAccent} size="small" />
            <Text style={styles.generatingText}>Generating…</Text>
          </View>
        )}
      </View>

      {/* Layered garment tiles */}
      {sorted.length > 0 && (
        <View style={styles.tilesRow}>
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
              {piece.category ? (
                <Text style={styles.tileCategory}>{categoryLabel(piece.category)}</Text>
              ) : null}
              <Text style={styles.tileName} numberOfLines={1}>{piece.name}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.tapHint}>Tap to expand</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  portraitFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.panelStrong,
    borderWidth: 1,
    borderColor: palette.line,
    aspectRatio: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  portrait: {
    width: '100%',
    height: '100%',
  },
  silhouette: {
    alignItems: 'center',
    gap: 6,
    padding: 24,
  },
  silhouetteIcon: {
    fontSize: 56,
  },
  silhouetteLabel: {
    color: palette.ink,
    fontSize: 14,
    fontFamily: type.bodyDemi,
  },
  silhouetteHint: {
    color: palette.muted,
    fontSize: 12,
    fontFamily: type.body,
  },
  generateBadge: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  generateBadgeText: {
    color: palette.textOnAccent,
    fontSize: 12,
    fontFamily: type.bodyDemi,
    letterSpacing: 0.2,
  },
  generatingOverlay: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  generatingText: {
    color: palette.textOnAccent,
    fontSize: 12,
    fontFamily: type.body,
  },
  tilesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    width: '22%',
    minWidth: 68,
    alignItems: 'center',
    gap: 3,
    backgroundColor: palette.panelStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 6,
  },
  tileHidden: {
    opacity: 0.4,
    borderStyle: 'dashed',
    borderColor: palette.lineStrong,
  },
  tileImage: {
    width: '100%',
    aspectRatio: 1,
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
    fontSize: 10,
    fontFamily: type.bodyMedium,
    textAlign: 'center',
  },
  tapHint: {
    textAlign: 'center',
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.body,
    marginTop: -4,
  },
});
