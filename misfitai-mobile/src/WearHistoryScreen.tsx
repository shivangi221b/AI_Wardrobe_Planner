import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppState } from './AppStateContext';
import { getOutfitLog, getWearHistory } from './api';
import { getImageForGarment, shoesImage } from './stockImages';
import { palette, radius, type as typeTokens } from './theme';
import type { Garment, OutfitLogEntry, WearLogEntry } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function buildCalendarGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function garmentImage(g: Garment) {
  if (g.primaryImageUrl) return { uri: g.primaryImageUrl };
  if (g.category === 'shoes') return shoesImage;
  return getImageForGarment(g.name, g.category === 'bottom' ? 'bottom' : 'top');
}

export function WearHistoryScreen() {
  const { garments, userId, logWearEvent, setGarmentLaundryStatus, logOutfitEntry } =
    useAppState();

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toDateKey(today), [today]);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [outfitLogs, setOutfitLogs] = useState<OutfitLogEntry[]>([]);
  const [wearLogEntries, setWearLogEntries] = useState<WearLogEntry[]>([]);

  const calendarCells = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  /** Refetch history when month changes or wardrobe wear stats change (e.g. after Weekly Recs "Tag as worn"). */
  const wearStatsFingerprint = useMemo(
    () =>
      garments
        .map((g) => `${g.id}:${g.lastWornDate ?? ''}:${g.timesWorn ?? 0}`)
        .join('|'),
    [garments],
  );

  useEffect(() => {
    if (!userId) return;
    const start = toDateKey(new Date(viewYear, viewMonth, 1));
    const end = toDateKey(new Date(viewYear, viewMonth + 1, 0));
    let cancelled = false;
    Promise.all([
      getOutfitLog(userId, start, end).catch(() => [] as OutfitLogEntry[]),
      getWearHistory(userId, start, end).catch(() => [] as WearLogEntry[]),
    ]).then(([outfits, wears]) => {
      if (!cancelled) {
        setOutfitLogs(outfits);
        setWearLogEntries(wears);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, viewYear, viewMonth, wearStatsFingerprint]);

  /** Dates with any logged activity: full outfits and/or individual wear events (e.g. from Weekly Recs). */
  const garmentIdsByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const entry of outfitLogs) {
      const set = map.get(entry.wornDate) ?? new Set<string>();
      for (const id of entry.garmentIds) {
        if (id) set.add(id);
      }
      map.set(entry.wornDate, set);
    }
    for (const w of wearLogEntries) {
      const set = map.get(w.wornDate) ?? new Set<string>();
      if (w.garmentId) set.add(w.garmentId);
      map.set(w.wornDate, set);
    }
    return map;
  }, [outfitLogs, wearLogEntries]);

  const hasLoggedActivity = useCallback(
    (dateKey: string) => {
      const set = garmentIdsByDate.get(dateKey);
      return Boolean(set && set.size > 0);
    },
    [garmentIdsByDate],
  );

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleDayPress = (day: number) => {
    const dateKey = toDateKey(new Date(viewYear, viewMonth, day));
    setSelectedDate(dateKey);
    setSelectedIds(new Set());
    setPickerOpen(true);
  };

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refreshLogs = useCallback(() => {
    if (!userId) return;
    const start = toDateKey(new Date(viewYear, viewMonth, 1));
    const end = toDateKey(new Date(viewYear, viewMonth + 1, 0));
    Promise.all([
      getOutfitLog(userId, start, end).catch(() => [] as OutfitLogEntry[]),
      getWearHistory(userId, start, end).catch(() => [] as WearLogEntry[]),
    ]).then(([outfits, wears]) => {
      setOutfitLogs(outfits);
      setWearLogEntries(wears);
    });
  }, [userId, viewYear, viewMonth]);

  const handleSave = async () => {
    if (!selectedDate || selectedIds.size === 0 || saving) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedIds);
      for (const gid of ids) {
        await logWearEvent(gid, selectedDate);
      }
      await logOutfitEntry(selectedDate, ids);
      refreshLogs();
      setPickerOpen(false);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndLaundry = async () => {
    if (!selectedDate || selectedIds.size === 0 || saving) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedIds);
      for (const gid of ids) {
        await logWearEvent(gid, selectedDate);
        await setGarmentLaundryStatus(gid, 'in_laundry');
      }
      await logOutfitEntry(selectedDate, ids);
      refreshLogs();
      setPickerOpen(false);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const formatSelectedDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };

  const isFutureDay = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    return d > today;
  };

  const categorized = useMemo(() => {
    const tops = garments.filter((g) => g.category === 'top');
    const bottoms = garments.filter((g) => g.category === 'bottom');
    const shoes = garments.filter((g) => g.category === 'shoes');
    const accessories = garments.filter((g) => g.category === 'accessory');
    const dresses = garments.filter(
      (g) => g.subCategory?.toLowerCase().includes('dress') || g.subCategory?.toLowerCase().includes('jumpsuit'),
    );
    return { tops, bottoms, shoes, accessories, dresses };
  }, [garments]);

  const renderPickerSection = (label: string, items: Garment[]) => {
    if (items.length === 0) return null;
    return (
      <View style={ps.section}>
        <Text style={ps.sectionLabel}>{label}</Text>
        <View style={ps.grid}>
          {items.map((g) => {
            const selected = selectedIds.has(g.id);
            const inLaundry = g.laundryStatus === 'in_laundry';
            return (
              <Pressable
                key={g.id}
                onPress={() => toggleItem(g.id)}
                style={[ps.item, selected && ps.itemSelected]}
              >
                <Image
                  source={garmentImage(g)}
                  style={[ps.itemImg, inLaundry && ps.itemImgDimmed]}
                  resizeMode="contain"
                />
                {selected ? <View style={ps.checkBadge}><Text style={ps.checkMark}>✓</Text></View> : null}
                {inLaundry ? <Text style={ps.laundryTag}>laundry</Text> : null}
                <Text style={ps.itemName} numberOfLines={1}>{g.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Tap a day to log what you wore</Text>

        {/* Month navigation */}
        <View style={styles.monthRow}>
          <Pressable onPress={prevMonth} style={styles.monthArrow}>
            <Text style={styles.monthArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel(viewYear, viewMonth)}</Text>
          <Pressable onPress={nextMonth} style={styles.monthArrow}>
            <Text style={styles.monthArrowText}>›</Text>
          </Pressable>
        </View>

        {/* Weekday headers */}
        <View style={styles.weekRow}>
          {WEEKDAYS.map((w) => (
            <View key={w} style={styles.weekCell}>
              <Text style={styles.weekText}>{w}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
        <View style={styles.calendarGrid}>
          {calendarCells.map((day, i) => {
            if (day === null) {
              return <View key={`empty-${i}`} style={styles.dayCell} />;
            }
            const dateKey = toDateKey(new Date(viewYear, viewMonth, day));
            const isToday = dateKey === todayKey;
            const future = isFutureDay(day);
            const logged = hasLoggedActivity(dateKey);
            return (
              <Pressable
                key={dateKey}
                style={[
                  styles.dayCell,
                  logged && styles.dayCellLogged,
                  isToday && styles.dayCellToday,
                ]}
                onPress={() => !future && handleDayPress(day)}
                disabled={future}
              >
                <Text
                  style={[
                    styles.dayText,
                    logged && styles.dayTextLogged,
                    isToday && styles.dayTextToday,
                    future && styles.dayTextFuture,
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendDot} />
          <Text style={styles.legendText}>= something logged</Text>
        </View>

        {/* Logged items below calendar (outfits + individual wears) */}
        {garmentIdsByDate.size > 0 ? (
          <View style={styles.loggedSection}>
            <Text style={styles.loggedTitle}>This month</Text>
            {Array.from(garmentIdsByDate.entries())
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([dateStr, idSet]) => {
                const uniqueIds = Array.from(idSet);
                return (
                  <View key={dateStr} style={styles.loggedDay}>
                    <Text style={styles.loggedDate}>{formatSelectedDate(dateStr)}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.loggedItems}>
                      {uniqueIds.map((gid) => {
                        const g = garments.find((x) => x.id === gid);
                        if (!g) return null;
                        return (
                          <View key={gid} style={styles.loggedItem}>
                            <Image
                              source={garmentImage(g)}
                              style={styles.loggedItemImg}
                              resizeMode="contain"
                            />
                            <Text style={styles.loggedItemName} numberOfLines={1}>{g.name}</Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                );
              })}
          </View>
        ) : null}
      </ScrollView>

      {/* Item picker modal */}
      <Modal visible={pickerOpen} animationType="slide" transparent>
        <View style={ps.overlay}>
          <View style={ps.sheet}>
            <View style={ps.header}>
              <Text style={ps.headerTitle}>
                {selectedDate ? formatSelectedDate(selectedDate) : ''}
              </Text>
              <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
                <Text style={ps.closeBtn}>✕</Text>
              </Pressable>
            </View>

            <Text style={ps.headerSub}>
              {selectedDate && hasLoggedActivity(selectedDate)
                ? 'Previously logged — tap to add more'
                : 'Select the items you wore'}
            </Text>

            <ScrollView style={ps.body} contentContainerStyle={ps.bodyContent}>
              {selectedDate && hasLoggedActivity(selectedDate) ? (
                <View style={ps.prevSection}>
                  <Text style={ps.prevLabel}>Already logged</Text>
                  <View style={ps.prevRow}>
                    {Array.from(garmentIdsByDate.get(selectedDate) ?? []).map((gid) => {
                      const g = garments.find((x) => x.id === gid);
                      if (!g) return null;
                      return (
                        <View key={gid} style={ps.prevItem}>
                          <Image source={garmentImage(g)} style={ps.prevImg} resizeMode="contain" />
                          <Text style={ps.prevName} numberOfLines={1}>{g.name}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {garments.length === 0 ? (
                <Text style={ps.emptyText}>
                  Your wardrobe is empty. Add items first.
                </Text>
              ) : (
                <>
                  {renderPickerSection('Tops', categorized.tops)}
                  {renderPickerSection('Bottoms', categorized.bottoms)}
                  {renderPickerSection('Dresses / Jumpsuits', categorized.dresses)}
                  {renderPickerSection('Shoes', categorized.shoes)}
                  {renderPickerSection('Accessories', categorized.accessories)}
                </>
              )}
            </ScrollView>

            {selectedIds.size > 0 ? (
              <View style={ps.footer}>
                <Text style={ps.selectedCount}>
                  {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
                </Text>
                <View style={ps.footerButtons}>
                  <Pressable
                    onPress={handleSave}
                    style={ps.saveBtn}
                    disabled={saving}
                  >
                    <Text style={ps.saveBtnText}>
                      {saving ? 'Saving...' : 'Mark as worn'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSaveAndLaundry}
                    style={ps.laundryBtn}
                    disabled={saving}
                  >
                    <Text style={ps.laundryBtnText}>
                      {saving ? 'Saving...' : 'Worn + send to laundry'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- Calendar styles ---------- */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
  },
  title: {
    fontSize: 33,
    lineHeight: 36,
    color: palette.ink,
    fontFamily: typeTokens.display,
  },
  subtitle: {
    fontSize: 14,
    color: palette.muted,
    fontFamily: typeTokens.body,
    marginTop: 2,
    marginBottom: 12,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowText: {
    fontSize: 22,
    color: palette.ink,
    fontFamily: typeTokens.bodyDemi,
    marginTop: -2,
  },
  monthLabel: {
    fontSize: 17,
    fontFamily: typeTokens.bodyDemi,
    color: palette.ink,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekText: {
    fontSize: 11,
    fontFamily: typeTokens.bodyDemi,
    color: palette.muted,
    textTransform: 'uppercase',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.285%' as any,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellLogged: {
    backgroundColor: palette.accentSoft,
    borderRadius: 10,
  },
  dayCellToday: {
    backgroundColor: palette.accent,
    borderRadius: 10,
  },
  dayText: {
    fontSize: 15,
    fontFamily: typeTokens.bodyMedium,
    color: palette.ink,
  },
  dayTextToday: {
    color: palette.textOnAccent,
    fontFamily: typeTokens.bodyDemi,
  },
  dayTextLogged: {
    fontFamily: typeTokens.bodyDemi,
  },
  dayTextFuture: {
    color: palette.line,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    justifyContent: 'center',
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: palette.accentSoft,
  },
  legendText: {
    fontSize: 12,
    color: palette.muted,
    fontFamily: typeTokens.body,
  },
  loggedSection: {
    marginTop: 18,
    gap: 12,
  },
  loggedTitle: {
    fontSize: 17,
    fontFamily: typeTokens.bodyDemi,
    color: palette.ink,
  },
  loggedDay: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.panel,
    padding: 12,
    gap: 8,
  },
  loggedDate: {
    fontSize: 13,
    fontFamily: typeTokens.bodyDemi,
    color: palette.inkSoft,
  },
  loggedItems: {
    gap: 10,
  },
  loggedItem: {
    alignItems: 'center',
    width: 64,
  },
  loggedItemImg: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: palette.panelStrong,
  },
  loggedItemName: {
    marginTop: 3,
    fontSize: 10,
    fontFamily: typeTokens.body,
    color: palette.muted,
    textAlign: 'center',
  },
});

/* ---------- Picker sheet styles ---------- */
const ps = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: palette.overlayScrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: typeTokens.bodyDemi,
    color: palette.ink,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: typeTokens.body,
    color: palette.muted,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  closeBtn: {
    fontSize: 20,
    color: palette.muted,
    fontFamily: typeTokens.bodyDemi,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: typeTokens.body,
    color: palette.muted,
    textAlign: 'center',
    marginTop: 30,
  },
  section: {
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: typeTokens.bodyDemi,
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  item: {
    width: 80,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 6,
    position: 'relative',
  },
  itemSelected: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  itemImg: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: palette.panelStrong,
  },
  itemImgDimmed: {
    opacity: 0.4,
  },
  itemName: {
    marginTop: 4,
    fontSize: 10,
    fontFamily: typeTokens.body,
    color: palette.inkSoft,
    textAlign: 'center',
  },
  checkBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: palette.textOnAccent,
    fontSize: 12,
    fontFamily: typeTokens.bodyDemi,
  },
  laundryTag: {
    position: 'absolute',
    top: 4,
    left: 4,
    fontSize: 8,
    fontFamily: typeTokens.bodyDemi,
    color: palette.muted,
    backgroundColor: palette.bgAlt,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    gap: 10,
  },
  selectedCount: {
    fontSize: 13,
    fontFamily: typeTokens.bodyDemi,
    color: palette.ink,
    textAlign: 'center',
  },
  footerButtons: {
    gap: 8,
  },
  saveBtn: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnText: {
    color: palette.textOnAccent,
    fontSize: 15,
    fontFamily: typeTokens.bodyDemi,
  },
  laundryBtn: {
    backgroundColor: palette.bg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.ink,
    paddingVertical: 13,
    alignItems: 'center',
  },
  laundryBtnText: {
    color: palette.ink,
    fontSize: 15,
    fontFamily: typeTokens.bodyDemi,
  },
  prevSection: {
    marginBottom: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: palette.accentSoft,
    gap: 8,
  },
  prevLabel: {
    fontSize: 12,
    fontFamily: typeTokens.bodyDemi,
    color: palette.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  prevRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  prevItem: {
    alignItems: 'center',
    width: 64,
  },
  prevImg: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: palette.panelStrong,
  },
  prevName: {
    marginTop: 3,
    fontSize: 10,
    fontFamily: typeTokens.body,
    color: palette.inkSoft,
    textAlign: 'center',
  },
});
