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
 * Exemples :
 *   https://www.qrmap.site/map/cambodge-voyage-ugksix6w  → cambodge-voyage-ugksix6w
 *   https://www.qrmap.site/guide/cambodge-voyage-ugksix6w → cambodge-voyage-ugksix6w
 *   cambodge-voyage-ugksix6w (slug direct) → cambodge-voyage-ugksix6w
 */
export function extractSlugFromUrl(input: string): string | null {
  try {
    // Essayer de parser comme URL
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    // /map/:slug ou /guide/:slug
    if (parts.length >= 2 && (parts[0] === 'map' || parts[0] === 'guide')) {
      return parts[1];
    }
    // /api/itinerary/:slug
    if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'itinerary') {
      return parts[2];
    }
    return null;
  } catch {
    // Pas une URL valide, peut-être un slug direct
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

    // Calculer la date du jour si startDate est disponible
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

/**
 * Calcule l'itinéraire de navigation entre deux points via OSRM (gratuit, OpenStreetMap)
 */
export async function fetchRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): Promise<{ coordinates: [number, number][]; distance: number; duration: number }> {
  const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=true`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Impossible de calculer l\'itinéraire');
  }

  const data = await response.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error('Aucun itinéraire trouvé');
  }

  const route = data.routes[0];
  const coordinates: [number, number][] = route.geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon] // Convertir en [lat, lon] pour Leaflet/MapLibre
  );

  return {
    coordinates,
    distance: route.distance,
    duration: route.duration,
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
