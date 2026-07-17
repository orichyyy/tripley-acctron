export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface BusinessCalendar {
  isBusinessDay(date: Date): boolean;
  isWithinWindow(date: Date, windowId: string): boolean;
}

export interface BusinessCalendarOptions {
  readonly businessDays?: readonly number[] | undefined;
  readonly windows?:
    | Record<string, { readonly startHour: number; readonly endHour: number }>
    | undefined;
}

export class DefaultBusinessCalendar implements BusinessCalendar {
  private readonly businessDays: readonly number[];
  private readonly windows: Record<
    string,
    { readonly startHour: number; readonly endHour: number }
  >;

  public constructor(options: BusinessCalendarOptions = {}) {
    this.businessDays = options.businessDays ?? [1, 2, 3, 4, 5];
    this.windows = options.windows ?? { default: { endHour: 18, startHour: 9 } };
  }

  public isBusinessDay(date: Date): boolean {
    return this.businessDays.includes(date.getDay());
  }

  public isWithinWindow(date: Date, windowId: string): boolean {
    const window = this.windows[windowId] ?? this.windows.default;
    if (!window) {
      return true;
    }
    const hour = date.getHours();
    return hour >= window.startHour && hour < window.endHour;
  }
}
