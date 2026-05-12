import AsyncStorage from '@react-native-async-storage/async-storage';
import { Itinerary } from '../types';

const ITINERARIES_KEY = 'saved_itineraries';
const RECENT_KEY = 'recent_itinerary_slug';

/**
 * Sauvegarde un itinéraire localement
 */
export async function saveItinerary(itinerary: Itinerary): Promise<void> {
  const existing = await getSavedItineraries();
  const updated = existing.filter(i => i.slug !== itinerary.slug);
  updated.unshift(itinerary); // Mettre en premier
  await AsyncStorage.setItem(ITINERARIES_KEY, JSON.stringify(updated));
  await AsyncStorage.setItem(RECENT_KEY, itinerary.slug);
}

/**
 * Récupère tous les itinéraires sauvegardés
 */
export async function getSavedItineraries(): Promise<Itinerary[]> {
  const raw = await AsyncStorage.getItem(ITINERARIES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Récupère un itinéraire par son slug
 */
export async function getItineraryBySlug(slug: string): Promise<Itinerary | null> {
  const itineraries = await getSavedItineraries();
  return itineraries.find(i => i.slug === slug) || null;
}

/**
 * Supprime un itinéraire sauvegardé
 */
export async function deleteItinerary(slug: string): Promise<void> {
  const existing = await getSavedItineraries();
  const updated = existing.filter(i => i.slug !== slug);
  await AsyncStorage.setItem(ITINERARIES_KEY, JSON.stringify(updated));
}

/**
 * Récupère le slug du dernier itinéraire consulté
 */
export async function getRecentSlug(): Promise<string | null> {
  return AsyncStorage.getItem(RECENT_KEY);
}

/**
 * Sauvegarde les packs offline téléchargés (métadonnées)
 */
export async function saveOfflinePack(slug: string, packId: string, countryName: string): Promise<void> {
  const key = `offline_pack_${slug}`;
  await AsyncStorage.setItem(key, JSON.stringify({ packId, countryName, downloadedAt: new Date().toISOString() }));
}

/**
 * Vérifie si un pack offline existe pour un slug
 */
export async function getOfflinePack(slug: string): Promise<{ packId: string; countryName: string; downloadedAt: string } | null> {
  const key = `offline_pack_${slug}`;
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Supprime les métadonnées d'un pack offline
 */
export async function deleteOfflinePack(slug: string): Promise<void> {
  const key = `offline_pack_${slug}`;
  await AsyncStorage.removeItem(key);
}
