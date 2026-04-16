import { getScheduleChips, getFitSignals } from '../lookUtils';
import type { EventType } from '../types';

describe('getScheduleChips', () => {
  const eventTypes: EventType[] = ['work_meeting', 'date_night', 'gym', 'casual', 'none'];

  it.each(eventTypes)('returns 3 chips for "%s"', (eventType) => {
    const chips = getScheduleChips(eventType);
    expect(chips).toHaveLength(3);
    chips.forEach((chip) => {
      expect(typeof chip).toBe('string');
      expect(chip.length).toBeGreaterThan(0);
    });
  });

  it('returns work-related chips for work_meeting', () => {
    const chips = getScheduleChips('work_meeting');
    expect(chips.some((c) => c.toLowerCase().includes('work'))).toBe(true);
  });

  it('returns gym-related chips for gym', () => {
    const chips = getScheduleChips('gym');
    expect(chips.some((c) => c.toLowerCase().includes('gym') || c.toLowerCase().includes('active'))).toBe(true);
  });

  it('returns casual chips for none', () => {
    const chips = getScheduleChips('none');
    expect(chips.some((c) => c.toLowerCase().includes('no major') || c.toLowerCase().includes('everyday'))).toBe(true);
  });
});

describe('getFitSignals', () => {
  const eventTypes: EventType[] = ['work_meeting', 'date_night', 'gym', 'casual', 'none'];

  it.each(eventTypes)('returns 3 signals for "%s"', (eventType) => {
    const signals = getFitSignals(eventType);
    expect(signals).toHaveLength(3);
    signals.forEach((signal) => {
      expect(signal).toHaveProperty('label');
      expect(signal).toHaveProperty('value');
      expect(typeof signal.label).toBe('string');
      expect(typeof signal.value).toBe('string');
    });
  });

  it('always includes "Style match" label', () => {
    const signals = getFitSignals('work_meeting');
    expect(signals.some((s) => s.label === 'Style match')).toBe(true);
  });

  it('always includes "Weather fit" label', () => {
    const signals = getFitSignals('casual');
    expect(signals.some((s) => s.label === 'Weather fit')).toBe(true);
  });
});
