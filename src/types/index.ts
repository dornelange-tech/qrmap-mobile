export interface Place {
  id: number;
  name: string;
  lat: number;
  lon: number;
  description?: string;
  orderIndex: number;
}

export interface Day {
  id: number;
  dayNumber: number;
  title: string;
  description?: string;
  date?: string; // ISO date string e.g. "2027-03-03"
  places: Place[];
}

export interface Itinerary {
  id: number;
  title: string;
  slug: string;
  startDate?: string; // ISO date string
  days: Day[];
}

export interface RouteStep {
  instruction: string;
  distance: number; // meters
  duration: number; // seconds
  maneuver: string;
}

export interface Route {
  coordinates: [number, number][]; // [lon, lat] pairs
  distance: number; // meters
  duration: number; // seconds
  steps: RouteStep[];
}

export type RootStackParamList = {
  Home: undefined;
  Scanner: undefined;
  Map: { slug: string; itinerary?: Itinerary };
  DayDetail: { day: Day; itinerary: Itinerary };
  Navigation: undefined;
  OfflineManager: undefined;
};
