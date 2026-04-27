import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  BodyMeasurements,
  CalendarEvent,
  DayRecommendationSet,
  DayOfWeek,
  DayRecommendation,
  EventType,
  Garment,
  GarmentSeasonality,
  GarmentFormality,
  RecommendationPinnedPieces,
  RecommendationVariant,
} from './types';
import { dayOrder } from './constants';
import {
  addGarment,
  addGarmentFromVision,
  commitVisionItems as apiCommitVisionItems,
  confirmSearchAdd,
  getApiErrorMessage,
  getMeasurements,
  getWardrobe,
  getWeekEvents,
  getWeeklyRecommendations,
  previewGarmentsFromVision as apiPreviewGarmentsFromVision,
  saveMeasurements,
  searchGarmentImages,
  deleteGarment as apiDeleteGarment,
  setGarmentHidden as apiSetGarmentHidden,
  syncCalendarEvents as apiSyncCalendarEvents,
  trackRecommendationChoice,
  type ConfirmSearchAddPayload,
  type GarmentSearchResult,
  type GarmentSearchOptions,
  type RecommendationPinConstraint,
  type RecommendationChoicePayload,
  type VisionAddPayload,
  type VisionPreviewItem,
  saveWeekEvents,
} from './api';

interface AppState {
  userId: string;
  garments: Garment[];
  eventsByDay: Record<DayOfWeek, EventType>;
  summariesByDay: Record<DayOfWeek, string | undefined>;
  recommendations: DayRecommendation[];
  recommendationSets: DayRecommendationSet[];
  isCalendarConnected: boolean;
  isLoadingWardrobe: boolean;
  wardrobeError: string | null;
  measurements: BodyMeasurements | null;
  searchGarmentCandidates: (
    query: string,
    limit?: number,
    options?: GarmentSearchOptions
  ) => Promise<GarmentSearchResult[]>;
  setCalendarConnected: (connected: boolean) => void;
  setEventForDay: (day: DayOfWeek, eventType: EventType) => void;
  useDemoWeek: () => void;
  syncCalendarEvents: () => Promise<void>;
  generateRecommendations: () => Promise<void>;
  regenerateRecommendationsWithPins: () => Promise<void>;
  setSelectedRecommendationVariant: (day: DayOfWeek, variantId: string) => Promise<void>;
  setPinWholeOutfit: (day: DayOfWeek, variantId: string, pinned: boolean) => void;
  setPinPiece: (
    day: DayOfWeek,
    variantId: string,
    piece: keyof RecommendationPinnedPieces,
    pinned: boolean
  ) => void;
  addGarmentToWardrobe: (
    payload: {
      name: string;
      category: 'top' | 'bottom' | 'shoes' | 'accessory';
      color?: string;
      formality?: GarmentFormality;
      seasonality?: GarmentSeasonality;
    }
  ) => Promise<void>;
  addGarmentViaVision: (payload: VisionAddPayload) => Promise<void>;
  previewVisionItems: (payload: VisionAddPayload) => Promise<VisionPreviewItem[]>;
  commitVisionItems: (items: VisionPreviewItem[]) => Promise<void>;
  addGarmentViaSearch: (payload: ConfirmSearchAddPayload) => Promise<void>;
  toggleGarmentHidden: (garmentId: string, hidden: boolean) => Promise<void>;
  deleteGarmentFromWardrobe: (garmentId: string) => Promise<void>;
  updateMeasurements: (data: Omit<BodyMeasurements, 'userId' | 'updatedAt'>) => Promise<void>;
}

const AppStateContext = createContext<AppState | undefined>(undefined);

const validEventTypes: EventType[] = [
  'work_meeting',
  'date_night',
  'gym',
  'casual',
  'none',
];

function createInitialEvents(): Record<DayOfWeek, EventType> {
  return {
    monday: 'none',
    tuesday: 'none',
    wednesday: 'none',
    thursday: 'none',
    friday: 'none',
    saturday: 'none',
    sunday: 'none',
  };
}

function createInitialSummaries(): Record<DayOfWeek, string | undefined> {
  return {
    monday: undefined,
    tuesday: undefined,
    wednesday: undefined,
    thursday: undefined,
    friday: undefined,
    saturday: undefined,
    sunday: undefined,
  };
}

function emptyPinnedPieces(): RecommendationPinnedPieces {
  return { top: false, bottom: false, dress: false };
}

function createVariantLabel(index: number): string {
  return index === 0 ? 'First suggestion' : `Regenerated option ${index + 1}`;
}

function buildVariant(
  recommendation: DayRecommendation,
  index: number,
  sourceType: 'original' | 'regenerated',
  previous?: RecommendationVariant
): RecommendationVariant {
  return {
    id: previous?.id ?? `${recommendation.day}-${sourceType}-${index}-${recommendation.outfit.id || 'outfit'}`,
    label: createVariantLabel(index),
    sourceType,
    recommendation,
    pinWholeOutfit: previous?.pinWholeOutfit ?? false,
    pinnedPieces: previous?.pinnedPieces ?? emptyPinnedPieces(),
  };
}

export function AppStateProvider({
  children,
  userId: userIdProp,
  userGender,
  googleAccessToken,
}: {
  children: React.ReactNode;
  /** Stable user id from auth (e.g. Google/Apple id or email). Used for wardrobe API and Supabase. */
  userId?: string;
  /** Gender from user profile, forwarded to the recommendation engine. */
  userGender?: string | null;
  /** Google OAuth access token from sign-in (in-memory only, not persisted). Used for calendar sync. */
  googleAccessToken?: string | null;
}) {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [eventsByDay, setEventsByDay] =
    useState<Record<DayOfWeek, EventType>>(createInitialEvents);
  const [summariesByDay, setSummariesByDay] =
    useState<Record<DayOfWeek, string | undefined>>(createInitialSummaries);
  const [recommendations, setRecommendations] = useState<
    DayRecommendation[]
  >([]);
  const [recommendationSets, setRecommendationSets] = useState<DayRecommendationSet[]>([]);
  const [isLoadingWardrobe, setIsLoadingWardrobe] = useState(false);
  const [wardrobeError, setWardrobeError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<BodyMeasurements | null>(null);
  const [userId, setUserId] = useState<string>(
    () => userIdProp ?? `demo-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    if (userIdProp && userIdProp !== userId) {
      setUserId(userIdProp);
    }
  }, [userIdProp, userId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoadingWardrobe(true);
      setWardrobeError(null);

      try {
        const wardrobe = await getWardrobe(userId);
        if (!cancelled) {
          setGarments(wardrobe);
        }
      } catch (error) {
        if (!cancelled) {
          setWardrobeError(getApiErrorMessage(error, 'Failed to load wardrobe.'));
        }
      }

      try {
        const week = await getWeekEvents(userId);
        if (!cancelled && week.events.length > 0) {
          const updated = createInitialEvents();
          week.events.forEach((event) => {
            if (
              dayOrder.includes(event.day) &&
              validEventTypes.includes(event.event_type)
            ) {
              updated[event.day] = event.event_type;
            }
          });
          setEventsByDay(updated);
        }
      } catch {
        // Week events are non-blocking for first render.
      }

      try {
        const savedMeasurements = await getMeasurements(userId);
        if (!cancelled) {
          setMeasurements(savedMeasurements);
        }
      } catch {
        // Measurements are non-blocking.
      } finally {
        if (!cancelled) {
          setIsLoadingWardrobe(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!googleAccessToken || isCalendarConnected) return;
    let cancelled = false;
    apiSyncCalendarEvents(userId, googleAccessToken)
      .then((result) => {
        if (cancelled) return;
        if (result.events.length > 0) {
          const updated = createInitialEvents();
          const updatedSummaries = createInitialSummaries();
          result.events.forEach((event) => {
            if (
              dayOrder.includes(event.day) &&
              validEventTypes.includes(event.event_type)
            ) {
              updated[event.day] = event.event_type;
              updatedSummaries[event.day] = event.original_summary;
            }
          });
          setEventsByDay(updated);
          setSummariesByDay(updatedSummaries);
        }
        setIsCalendarConnected(true);
      })
      .catch(() => {
        // Silently skip — user can still manually connect later.
      });
    return () => { cancelled = true; };
  }, [googleAccessToken, userId, isCalendarConnected]);

  const setCalendarConnected = useCallback((connected: boolean) => {
    setIsCalendarConnected(connected);
  }, []);

  const setEventForDay = useCallback((day: DayOfWeek, eventType: EventType) => {
    setEventsByDay((current) => ({
      ...current,
      [day]: eventType,
    }));
  }, []);

  const useDemoWeek = useCallback(() => {
    setEventsByDay({
      monday: 'work_meeting',
      tuesday: 'work_meeting',
      wednesday: 'gym',
      thursday: 'work_meeting',
      friday: 'date_night',
      saturday: 'casual',
      sunday: 'none',
    });
  }, []);

  const syncCalendarEvents = useCallback(async () => {
    if (!googleAccessToken) {
      throw new Error(
        'Calendar sync needs Google sign-in with calendar access. Use “Use demo week” or pick event types for each day instead.'
      );
    }
    let result;
    try {
      result = await apiSyncCalendarEvents(userId, googleAccessToken);
    } catch (error) {
      throw new Error(getApiErrorMessage(error, 'Failed to sync calendar events.'));
    }
    if (result.events.length > 0) {
      const updated = createInitialEvents();
      const updatedSummaries = createInitialSummaries();
      result.events.forEach((event) => {
        if (
          dayOrder.includes(event.day) &&
          validEventTypes.includes(event.event_type)
        ) {
          updated[event.day] = event.event_type;
          updatedSummaries[event.day] = event.original_summary;
        }
      });
      setEventsByDay(updated);
      setSummariesByDay(updatedSummaries);
    }
  }, [userId, googleAccessToken]);

  const eventsForApi = useCallback((): CalendarEvent[] => {
    return dayOrder.map((day, index) => ({
      id: 'event-' + index,
      day,
      eventType: eventsByDay[day],
    }));
  }, [eventsByDay]);

  const mergeRecommendationsIntoSets = useCallback(
    (
      nextRecommendations: DayRecommendation[],
      sourceType: 'original' | 'regenerated',
      append: boolean
    ): DayRecommendationSet[] => {
      const byDay = new Map<DayOfWeek, DayRecommendation>();
      nextRecommendations.forEach((rec) => byDay.set(rec.day, rec));

      return dayOrder
        .filter((day) => byDay.has(day))
        .map((day) => {
          const recommendation = byDay.get(day)!;
          const existing = recommendationSets.find((set) => set.day === day);
          const existingVariants = append ? (existing?.variants ?? []) : [];
          const previousSelected =
            existing?.variants.find((v) => v.id === existing.selectedVariantId) ?? null;
          const nextVariant = buildVariant(
            recommendation,
            existingVariants.length,
            sourceType,
            append ? previousSelected ?? undefined : undefined
          );
          const variants = existingVariants.concat(nextVariant);
          return {
            day,
            variants: variants.map((variant, idx) => ({
              ...variant,
              label: createVariantLabel(idx),
            })),
            selectedVariantId: existing?.selectedVariantId ?? nextVariant.id,
          };
        });
    },
    [recommendationSets]
  );

  const emitSelectedRecommendations = useCallback((sets: DayRecommendationSet[]) => {
    const selected = sets
      .map((set) => set.variants.find((v) => v.id === set.selectedVariantId) ?? set.variants[0])
      .filter(Boolean)
      .map((variant) => variant!.recommendation)
      .sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
    setRecommendations(selected);
  }, []);

  const buildPinConstraints = useCallback((sets: DayRecommendationSet[]): RecommendationPinConstraint[] => {
    return sets
      .map((set) => {
        const selected = set.variants.find((v) => v.id === set.selectedVariantId) ?? set.variants[0];
        if (!selected) return null;
        const pins = selected.pinnedPieces;
        if (!selected.pinWholeOutfit && !pins.top && !pins.bottom && !pins.dress) {
          return null;
        }
        return {
          day: set.day,
          pinWholeOutfit: selected.pinWholeOutfit,
          topId: selected.pinWholeOutfit || pins.top ? selected.recommendation.outfit.topId : undefined,
          bottomId:
            selected.pinWholeOutfit || pins.bottom ? selected.recommendation.outfit.bottomId : undefined,
          dressId: selected.pinWholeOutfit || pins.dress ? selected.recommendation.outfit.dressId : undefined,
        } satisfies RecommendationPinConstraint;
      })
      .filter((value): value is RecommendationPinConstraint => Boolean(value));
  }, []);

  const generateRecommendations = useCallback(async () => {
    const events = eventsForApi();
    await saveWeekEvents(userId, events);
    const response = await getWeeklyRecommendations(userId, events, userGender);
    const sorted = response.recommendations.sort(
      (a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day)
    );
    const sets = mergeRecommendationsIntoSets(sorted, 'original', false);
    setRecommendationSets(sets);
    emitSelectedRecommendations(sets);
  }, [userId, eventsForApi, userGender, mergeRecommendationsIntoSets, emitSelectedRecommendations]);

  const regenerateRecommendationsWithPins = useCallback(async () => {
    const events = eventsForApi();
    await saveWeekEvents(userId, events);
    const pinConstraints = buildPinConstraints(recommendationSets);
    const response = await getWeeklyRecommendations(userId, events, userGender, pinConstraints);
    const sorted = response.recommendations.sort(
      (a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day)
    );
    const sets = mergeRecommendationsIntoSets(sorted, 'regenerated', true);
    setRecommendationSets(sets);
    emitSelectedRecommendations(sets);
  }, [
    userId,
    eventsForApi,
    userGender,
    recommendationSets,
    buildPinConstraints,
    mergeRecommendationsIntoSets,
    emitSelectedRecommendations,
  ]);

  const setSelectedRecommendationVariant = useCallback(
    async (day: DayOfWeek, variantId: string): Promise<void> => {
      let analyticsPayload: RecommendationChoicePayload | null = null;
      setRecommendationSets((current) => {
        const next = current.map((set) => {
          if (set.day !== day) return set;
          const selected = set.variants.find((variant) => variant.id === variantId);
          if (selected) {
            analyticsPayload = {
              userId,
              day,
              chosenVariantId: selected.id,
              sourceType: selected.sourceType,
              pinWholeOutfit: selected.pinWholeOutfit,
              pinnedPieceKeys: Object.entries(selected.pinnedPieces)
                .filter(([, pinned]) => pinned)
                .map(([piece]) => piece),
            };
          }
          return { ...set, selectedVariantId: variantId };
        });
        emitSelectedRecommendations(next);
        return next;
      });
      if (analyticsPayload) {
        await trackRecommendationChoice(analyticsPayload);
      }
    },
    [userId, emitSelectedRecommendations]
  );

  const setPinWholeOutfit = useCallback((day: DayOfWeek, variantId: string, pinned: boolean) => {
    setRecommendationSets((current) =>
      current.map((set) => {
        if (set.day !== day) return set;
        return {
          ...set,
          variants: set.variants.map((variant) => {
            if (variant.id !== variantId) return variant;
            return {
              ...variant,
              pinWholeOutfit: pinned,
              pinnedPieces: pinned
                ? { top: true, bottom: true, dress: true }
                : variant.pinnedPieces,
            };
          }),
        };
      })
    );
  }, []);

  const setPinPiece = useCallback(
    (
      day: DayOfWeek,
      variantId: string,
      piece: keyof RecommendationPinnedPieces,
      pinned: boolean
    ) => {
      setRecommendationSets((current) =>
        current.map((set) => {
          if (set.day !== day) return set;
          return {
            ...set,
            variants: set.variants.map((variant) => {
              if (variant.id !== variantId) return variant;
              return {
                ...variant,
                pinnedPieces: {
                  ...variant.pinnedPieces,
                  [piece]: pinned,
                },
              };
            }),
          };
        })
      );
    },
    []
  );

  const addGarmentToWardrobe = useCallback(async (payload: {
    name: string;
    category: 'top' | 'bottom' | 'shoes' | 'accessory';
    color?: string;
    formality?: GarmentFormality;
    seasonality?: GarmentSeasonality;
  }): Promise<void> => {
    const created = await addGarment(userId, payload);
    setGarments((current) => {
      const existingIndex = current.findIndex((item) => item.id === created.id);
      if (existingIndex === -1) {
        return current.concat(created);
      }
      return current.map((item) => (item.id === created.id ? created : item));
    });
  }, [userId]);

  const addGarmentViaVision = useCallback(async (payload: VisionAddPayload): Promise<void> => {
    const createdItems = await addGarmentFromVision(userId, payload);
    setGarments((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      createdItems.forEach((item) => {
        byId.set(item.id, item);
      });
      return Array.from(byId.values());
    });
  }, [userId]);

  const previewVisionItems = useCallback(async (payload: VisionAddPayload): Promise<VisionPreviewItem[]> => {
    return apiPreviewGarmentsFromVision(userId, payload);
  }, [userId]);

  const commitVisionItems = useCallback(async (items: VisionPreviewItem[]): Promise<void> => {
    const createdItems = await apiCommitVisionItems(userId, items);
    setGarments((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      createdItems.forEach((item) => {
        byId.set(item.id, item);
      });
      return Array.from(byId.values());
    });
  }, [userId]);

  const searchGarmentCandidates = useCallback(
    async (
      query: string,
      limit = 20,
      options?: GarmentSearchOptions
    ): Promise<GarmentSearchResult[]> => {
      return searchGarmentImages(userId, query, limit, options);
    },
    [userId]
  );

  const addGarmentViaSearch = useCallback(
    async (payload: ConfirmSearchAddPayload): Promise<void> => {
      const created = await confirmSearchAdd(userId, payload);
      setGarments((current) => {
        const existingIndex = current.findIndex((item) => item.id === created.id);
        if (existingIndex === -1) {
          return current.concat(created);
        }
        return current.map((item) => (item.id === created.id ? created : item));
      });
    },
    [userId]
  );

  const toggleGarmentHidden = useCallback(
    async (garmentId: string, hidden: boolean): Promise<void> => {
      const updated = await apiSetGarmentHidden(userId, garmentId, hidden);
      setGarments((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    },
    [userId]
  );

  const deleteGarmentFromWardrobe = useCallback(
    async (garmentId: string): Promise<void> => {
      await apiDeleteGarment(userId, garmentId);
      setGarments((current) => current.filter((g) => g.id !== garmentId));
    },
    [userId]
  );

  const updateMeasurements = useCallback(
    async (data: Omit<BodyMeasurements, 'userId' | 'updatedAt'>): Promise<void> => {
      const saved = await saveMeasurements(userId, data);
      setMeasurements(saved);
    },
    [userId]
  );

  const value: AppState = useMemo(
    () => ({
      userId,
      garments,
      eventsByDay,
      summariesByDay,
      recommendations,
      recommendationSets,
      isCalendarConnected,
      isLoadingWardrobe,
      wardrobeError,
      measurements,
      searchGarmentCandidates,
      setCalendarConnected,
      setEventForDay,
      useDemoWeek,
      syncCalendarEvents,
      generateRecommendations,
      regenerateRecommendationsWithPins,
      setSelectedRecommendationVariant,
      setPinWholeOutfit,
      setPinPiece,
      addGarmentToWardrobe,
      addGarmentViaVision,
      previewVisionItems,
      commitVisionItems,
      addGarmentViaSearch,
      toggleGarmentHidden,
      deleteGarmentFromWardrobe,
      updateMeasurements,
    }),
    [
      userId,
      garments,
      eventsByDay,
      summariesByDay,
      recommendations,
      recommendationSets,
      isCalendarConnected,
      isLoadingWardrobe,
      wardrobeError,
      measurements,
      searchGarmentCandidates,
      setCalendarConnected,
      setEventForDay,
      useDemoWeek,
      syncCalendarEvents,
      generateRecommendations,
      regenerateRecommendationsWithPins,
      setSelectedRecommendationVariant,
      setPinWholeOutfit,
      setPinPiece,
      addGarmentToWardrobe,
      addGarmentViaVision,
      previewVisionItems,
      commitVisionItems,
      addGarmentViaSearch,
      toggleGarmentHidden,
      deleteGarmentFromWardrobe,
      updateMeasurements,
    ]
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
