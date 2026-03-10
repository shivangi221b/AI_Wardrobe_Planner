import type { DayOfWeek, EventType } from './types';

export function getScheduleChips(day: DayOfWeek): string[] {
  const byDay: Record<DayOfWeek, string[]> = {
    monday: ['10am Class', '1-5pm Internship', '6pm Dinner', '52F - Light rain'],
    tuesday: ['9am Lecture', '12pm Lab', '4pm Study Group', '49F - Cloudy'],
    wednesday: ['11am Seminar', '2pm Office Hours', '7pm Cafe', '55F - Breezy'],
    thursday: ['10am Class', '3pm Team Meet', '6pm Networking', '58F - Clear'],
    friday: ['9am Workshop', '1pm Internship', '8pm Date Night', '54F - Chill'],
    saturday: ['11am Brunch', '2pm Errands', '7pm Hangout', '61F - Sunny'],
    sunday: ['10am Reset', '2pm Library', '6pm Meal Prep', '50F - Windy'],
  };

  return byDay[day];
}

export function getFitSignals(eventType: EventType): Array<{ label: string; value: string }> {
  switch (eventType) {
    case 'work_meeting':
      return [
        { label: 'Style match', value: 'Polished casual' },
        { label: 'Weather fit', value: 'Layered + rain-ready' },
        { label: 'Flexibility', value: 'Desk to dinner' },
      ];
    case 'date_night':
      return [
        { label: 'Style match', value: 'Smart + elevated' },
        { label: 'Weather fit', value: 'Warm evening layer' },
        { label: 'Flexibility', value: 'Campus to date' },
      ];
    case 'gym':
      return [
        { label: 'Style match', value: 'Athleisure friendly' },
        { label: 'Weather fit', value: 'Breathable layers' },
        { label: 'Flexibility', value: 'Move-all-day' },
      ];
    case 'none':
    case 'casual':
    default:
      return [
        { label: 'Style match', value: 'Easy polished' },
        { label: 'Weather fit', value: 'Comfort-first' },
        { label: 'Flexibility', value: 'All-day repeatable' },
      ];
  }
}
