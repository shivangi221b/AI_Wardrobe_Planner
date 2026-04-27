import React from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { palette, radius, type } from './theme';
import type { ImageSourcePropType } from 'react-native';
import type { CollagePiece } from './OutfitAvatarPreview';
import type { GarmentCategory } from './types';

function resolveExpoSource(image: ImageSourcePropType): number | { uri: string } {
  if (typeof image === 'number') return image;
  if (Array.isArray(image)) return image[0] as { uri: string };
  return image as { uri: string };
}

interface OutfitDetailModalProps {
  visible: boolean;
  onClose: () => void;
  avatarImageUrl: string | null | undefined;
  compositeImageUrl: string | null;
  collagePieces: CollagePiece[];
  explanation: string;
  dayLabel: string;
  eventLabel: string;
  onLongPressPiece: (piece: CollagePiece) => void;
}

const LAYER_ORDER: GarmentCategory[] = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'accessory'];

const LAYER_LABELS: Record<GarmentCategory, string> = {
  outerwear: 'Outerwear',
  top: 'Top',
  dress: 'Dress',
  bottom: 'Bottom',
  shoes: 'Shoes',
  accessory: 'Accessory',
};

export function OutfitDetailModal({
  visible,
  onClose,
  avatarImageUrl,
  compositeImageUrl,
  collagePieces,
  explanation,
  dayLabel,
  eventLabel,
  onLongPressPiece,
}: OutfitDetailModalProps) {
  const portraitUrl = compositeImageUrl ?? avatarImageUrl;

  const sorted = [...collagePieces].sort((a, b) => {
    const ai = a.category ? LAYER_ORDER.indexOf(a.category) : 99;
    const bi = b.category ? LAYER_ORDER.indexOf(b.category) : 99;
    return ai - bi;
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerDay}>{dayLabel}</Text>
            <Text style={styles.headerEvent}>{eventLabel}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Avatar / composite portrait */}
          {portraitUrl ? (
            <View style={styles.portraitFrame}>
              <Image
                source={{ uri: portraitUrl }}
                style={styles.portrait}
                contentFit="cover"
                cachePolicy="disk"
                transition={220}
              />
              {compositeImageUrl && (
                <View style={styles.compositeBadge}>
                  <Text style={styles.compositeBadgeText}>Outfit preview</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={[styles.portraitFrame, styles.portraitPlaceholder]}>
              <Text style={styles.placeholderIcon}>👤</Text>
              <Text style={styles.placeholderLabel}>No avatar</Text>
            </View>
          )}

          {/* Explanation */}
          {explanation ? (
            <View style={styles.explanationCard}>
              <Text style={styles.explanationLabel}>Why this outfit</Text>
              <Text style={styles.explanationText}>{explanation}</Text>
            </View>
          ) : null}

          {/* Per-item layer cards */}
          <Text style={styles.sectionTitle}>Outfit breakdown</Text>
          {sorted.map((piece, index) => (
            <Pressable
              key={`${piece.name}-${index}`}
              onLongPress={() => onLongPressPiece(piece)}
              delayLongPress={400}
              style={[styles.itemCard, piece.hidden && styles.itemCardHidden]}
            >
              <Image
                source={resolveExpoSource(piece.image)}
                style={styles.itemImage}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
              <View style={styles.itemInfo}>
                {piece.category ? (
                  <Text style={styles.itemCategory}>{LAYER_LABELS[piece.category] ?? piece.category}</Text>
                ) : null}
                <Text style={styles.itemName}>{piece.name}</Text>
                {piece.hidden ? (
                  <Text style={styles.hiddenBadge}>Hidden from recommendations</Text>
                ) : (
                  <Text style={styles.longPressHint}>Long press to hide</Text>
                )}
              </View>
            </Pressable>
          ))}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
    backgroundColor: palette.panel,
  },
  headerText: {
    gap: 2,
  },
  headerDay: {
    fontSize: 18,
    color: palette.ink,
    fontFamily: type.display,
  },
  headerEvent: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: type.body,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    color: palette.ink,
    fontFamily: type.bodyDemi,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
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
  },
  portrait: {
    width: '100%',
    height: '100%',
  },
  portraitPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  placeholderIcon: {
    fontSize: 64,
  },
  placeholderLabel: {
    color: palette.muted,
    fontSize: 13,
    fontFamily: type.body,
  },
  compositeBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
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
  explanationCard: {
    backgroundColor: palette.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 14,
    gap: 6,
  },
  explanationLabel: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.bodyDemi,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  explanationText: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: type.body,
  },
  sectionTitle: {
    color: palette.inkSoft,
    fontSize: 13,
    fontFamily: type.bodyDemi,
    marginTop: 4,
  },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: palette.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
    alignItems: 'center',
  },
  itemCardHidden: {
    opacity: 0.5,
    borderStyle: 'dashed',
    borderColor: palette.lineStrong,
  },
  itemImage: {
    width: 80,
    height: 80,
  },
  itemInfo: {
    flex: 1,
    paddingHorizontal: 14,
    gap: 3,
  },
  itemCategory: {
    color: palette.muted,
    fontSize: 10,
    fontFamily: type.bodyDemi,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemName: {
    color: palette.ink,
    fontSize: 15,
    fontFamily: type.bodyDemi,
  },
  hiddenBadge: {
    color: palette.error,
    fontSize: 11,
    fontFamily: type.body,
  },
  longPressHint: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: type.body,
  },
  bottomSpacer: {
    height: 32,
  },
});
