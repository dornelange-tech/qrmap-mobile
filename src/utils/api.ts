import { Itinerary, Day, Place } from '../types';

const API_BASE = 'https://www.qrmap.site';

/**
 * Charge un itinéraire depuis qrmap.site par son slug
 */
export async function fetchItinerary(slug: string): Promise<Itinerary> {
  const response = await fetch(`${API_BASE}/api/itinerary/${slug}`, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Itinéraire introuvable (${response.status})`);
  }

  const data = await response.json();
  return normalizeItinerary(data);
}

/**
 * Extrait le slug depuis une URL qrmap.site
 */
export function extractSlugFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && (parts[0] === 'map' || parts[0] === 'guide')) {
      return parts[1];
    }
    if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'itinerary') {
      return parts[2];
    }
    return null;
  } catch {
    if (/^[a-z0-9-]+$/.test(input)) {
      return input;
    }
    return null;
  }
}

/**
 * Normalise la réponse API en structure Itinerary
 */
function normalizeItinerary(data: any): Itinerary {
  const days: Day[] = (data.days || []).map((day: any) => {
    const places: Place[] = (day.places || []).map((place: any) => ({
      id: place.id,
      name: place.name,
      lat: parseFloat(place.lat),
      lon: parseFloat(place.lon),
      description: place.description || '',
      orderIndex: place.orderIndex || 0,
    }));

    let date: string | undefined;
    if (data.startDate) {
      const start = new Date(data.startDate);
      start.setDate(start.getDate() + (day.dayNumber - 1));
      date = start.toISOString().split('T')[0];
    }

    return {
      id: day.id,
      dayNumber: day.dayNumber,
      title: day.title || `Jour ${day.dayNumber}`,
      description: day.description || '',
      date,
      places,
    };
  });

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    startDate: data.startDate,
    days,
  };
}

// ─── Types navigation guidée ──────────────────────────────────────────────────

export interface NavStep {
  instruction: string;       // texte humain de la manœuvre
  distance: number;          // distance jusqu'à la prochaine manœuvre (m)
  duration: number;          // durée (s)
  maneuver: string;          // type OSRM : 'turn', 'depart', 'arrive', etc.
  modifier?: string;         // 'left', 'right', 'straight', 'slight left', etc.
  lat: number;               // coordonnée du point de manœuvre
  lon: number;
}

export interface RouteData {
  coordinates: [number, number][];  // [lat, lon] pour MapLibre
  distance: number;
  duration: number;
  steps: NavStep[];
}

/**
 * Traduit une instruction OSRM en français
 */
function translateInstruction(maneuver: string, modifier?: string, streetName?: string): string {
  const street = streetName && streetName !== '' ? ` sur ${streetName}` : '';

  const modifierFr: Record<string, string> = {
    'left': 'à gauche',
    'right': 'à droite',
    'slight left': 'légèrement à gauche',
    'slight right': 'légèrement à droite',
    'sharp left': 'fortement à gauche',
    'sharp right': 'fortement à droite',
    'straight': 'tout droit',
    'uturn': 'demi-tour',
  };

  const mod = modifier ? modifierFr[modifier] || modifier : '';

  switch (maneuver) {
    case 'depart':
      return `Départ${street}`;
    case 'arrive':
      return 'Vous êtes arrivé à destination';
    case 'turn':
      return `Tournez ${mod}${street}`;
    case 'new name':
      return `Continuez${street}`;
    case 'continue':
      return `Continuez tout droit${street}`;
    case 'merge':
      return `Rejoignez la voie${street}`;
    case 'on ramp':
      return `Prenez la bretelle${mod ? ` ${mod}` : ''}`;
    case 'off ramp':
      return `Quittez par la sortie${mod ? ` ${mod}` : ''}`;
    case 'fork':
      return `Prenez la bifurcation ${mod}${street}`;
    case 'end of road':
      return `Au bout de la route, tournez ${mod}${street}`;
    case 'roundabout':
    case 'rotary':
      return `Au rond-point, prenez la sortie${street}`;
    case 'roundabout turn':
      return `Au rond-point, tournez ${mod}`;
    case 'notification':
      return `Continuez${street}`;
    default:
      return mod ? `Tournez ${mod}${street}` : `Continuez${street}`;
  }
}

/**
 * Calcule l'itinéraire de navigation entre deux points via OSRM
 * Retourne les coordonnées + les étapes de navigation guidée
 */
export async function fetchRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<RouteData> {
  const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=true&annotations=false`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Impossible de calculer l'itinéraire");
  }

  const data = await response.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error('Aucun itinéraire trouvé');
  }

  const route = data.routes[0];

  // Coordonnées de la polyligne [lat, lon]
  const coordinates: [number, number][] = route.geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon]
  );

  // Extraire les étapes de navigation depuis les legs OSRM
  const steps: NavStep[] = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const maneuver = step.maneuver?.type || 'continue';
      const modifier = step.maneuver?.modifier;
      const streetName = step.name || '';
      const [lon, lat] = step.maneuver?.location || [toLon, toLat];

      steps.push({
        instruction: translateInstruction(maneuver, modifier, streetName),
        distance: step.distance || 0,
        duration: step.duration || 0,
        maneuver,
        modifier,
        lat,
        lon,
      });
    }
  }

  return {
    coordinates,
    distance: route.distance,
    duration: route.duration,
    steps,
  };
}

/**
 * Formate une distance en km ou m
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Formate une durée en minutes ou heures
 */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${remainingMinutes}`;
}

/**
 * Formate une date ISO en français
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Formate une date ISO en format court
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}
