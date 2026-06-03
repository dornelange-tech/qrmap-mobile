/**
 * MapScreen.tsx — VERSION FINALE
 *
 * ARCHITECTURE DÉFINITIVE :
 * - Style vectoriel OpenFreeMap "Bright" (visuellement proche Organic Maps)
 * - POI : 100% natifs du style vectoriel OpenMapTiles
 *   Layers VÉRIFIÉS dans le JSON du style :
 *   → poi_r1  (rank 1-6,  minzoom 15) : restaurants, hôtels, musées...
 *   → poi_r7  (rank 7-19, minzoom 16) : commerces, services...
 *   → poi_r20 (rank 20+, minzoom 17)  : POI secondaires
 *   → poi_transit (pas de minzoom)    : aéroports, gares, bus
 *   Propriétés disponibles : class, subclass, name:latin, name:nonlatin, name_en, rank
 * - ZÉRO Overpass, ZÉRO serveur externe instable
 * - Marqueurs : PointAnnotation React Native (ZÉRO SymbolLayer custom → ZÉRO crash police)
 * - Navigation GPS : OSRM avec instructions françaises
 * - Offline : tuiles osmfr par rayon autour de chaque étape (zoom 10-13)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Vibration,
} from 'react-native';
import MapLibreGL, { MapViewRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Itinerary, Place } from '../types';
import { fetchItinerary, formatDateShort, formatDate } from '../utils/api';
import { saveItinerary, getItineraryBySlug, saveOfflinePack, getOfflinePack } from '../utils/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── OBLIGATOIRE ─────────────────────────────────────────────────────────────
MapLibreGL.setAccessToken(null);

// ─── Style vectoriel OpenFreeMap "Bright" ────────────────────────────────────
// Polices : Noto Sans Bold / Regular / Italic — HTTP 200 VÉRIFIÉES
// Tuiles vectorielles : https://tiles.openfreemap.org/planet
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

// ─── Layers POI du style bright (vérifiés dans le JSON du style) ─────────────
const POI_LAYER_IDS = ['poi_r1', 'poi_r7', 'poi_r20', 'poi_transit'];

// ─── Couleurs par jour ────────────────────────────────────────────────────────
const DAY_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
  '#ff5722', '#607d8b',
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface NativePOI {
  name: string;
  lat: number;
  lon: number;
  emoji: string;
  color: string;
  category: string;
}

interface NavStep {
  lat: number;
  lon: number;
  instruction: string;
  maneuver: string;
  modifier?: string;
  distance: number;
}

interface RouteData {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  steps: NavStep[];
}

type MapScreenRouteProp = RouteProp<RootStackParamList, 'Map'>;
type MapScreenNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

// ─── Classification POI natifs (class/subclass du style OpenMapTiles) ─────────
function classifyNativePOI(props: Record<string, any>): { emoji: string; color: string; category: string } {
  const cls = (props.class || '').toLowerCase();
  const sub = (props.subclass || '').toLowerCase();
  const combined = `${cls} ${sub}`.trim();

  if (['restaurant', 'fast_food', 'food_court', 'eating'].some(k => combined.includes(k)))
    return { emoji: '🍽', color: '#e67e22', category: 'Restaurant' };
  if (['cafe', 'coffee'].some(k => combined.includes(k)))
    return { emoji: '☕', color: '#795548', category: 'Café' };
  if (['bar', 'pub', 'nightclub', 'biergarten'].some(k => combined.includes(k)))
    return { emoji: '🍺', color: '#c0392b', category: 'Bar' };
  if (['hotel', 'hostel', 'motel', 'guest_house', 'lodging', 'accommodation'].some(k => combined.includes(k)))
    return { emoji: '🏨', color: '#8e44ad', category: 'Hôtel' };
  if (['museum', 'gallery', 'attraction', 'monument', 'castle', 'ruins', 'archaeological'].some(k => combined.includes(k)))
    return { emoji: '🏛', color: '#27ae60', category: 'Attraction' };
  if (['viewpoint'].some(k => combined.includes(k)))
    return { emoji: '📸', color: '#16a085', category: 'Point de vue' };
  if (['pharmacy', 'chemist'].some(k => combined.includes(k)))
    return { emoji: '💊', color: '#27ae60', category: 'Pharmacie' };
  if (['hospital', 'clinic', 'doctors', 'dentist'].some(k => combined.includes(k)))
    return { emoji: '🏥', color: '#e74c3c', category: 'Hôpital' };
  if (['atm', 'bank'].some(k => combined.includes(k)))
    return { emoji: '💳', color: '#2ecc71', category: 'Banque / ATM' };
  if (['supermarket', 'convenience', 'mall', 'department_store', 'shop'].some(k => combined.includes(k)))
    return { emoji: '🛒', color: '#3498db', category: 'Commerce' };
  if (['bus'].some(k => combined.includes(k)))
    return { emoji: '🚌', color: '#1abc9c', category: 'Bus' };
  if (['rail', 'train', 'subway', 'tram', 'station'].some(k => combined.includes(k)))
    return { emoji: '🚆', color: '#2980b9', category: 'Gare' };
  if (['airport'].some(k => combined.includes(k)))
    return { emoji: '✈️', color: '#34495e', category: 'Aéroport' };
  if (['place_of_worship', 'temple', 'church', 'mosque', 'buddhist', 'hindu'].some(k => combined.includes(k)))
    return { emoji: '⛩', color: '#a0522d', category: 'Lieu de culte' };
  if (['park', 'garden', 'nature_reserve', 'forest'].some(k => combined.includes(k)))
    return { emoji: '🌳', color: '#27ae60', category: 'Parc' };
  if (['beach', 'swimming'].some(k => combined.includes(k)))
    return { emoji: '🏖', color: '#f39c12', category: 'Plage' };
  if (['fuel', 'gas_station'].some(k => combined.includes(k)))
    return { emoji: '⛽', color: '#f1c40f', category: 'Station service' };
  if (['school', 'university', 'college'].some(k => combined.includes(k)))
    return { emoji: '🎓', color: '#9b59b6', category: 'École' };
  if (['library', 'cinema', 'theatre', 'arts_centre'].some(k => combined.includes(k)))
    return { emoji: '🎭', color: '#e91e63', category: 'Culture' };
  if (['police', 'fire_station', 'post_office'].some(k => combined.includes(k)))
    return { emoji: '🏛', color: '#607d8b', category: 'Service public' };
  return { emoji: '📍', color: '#7f8c8d', category: 'Point d\'intérêt' };
}

// ─── Helpers géographiques ────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m: number): string {
  if (m < 50) return 'ici';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

function arrowForManeuver(maneuver: string, modifier?: string): string {
  if (maneuver === 'arrive') return '🏁';
  if (maneuver === 'depart') return '▶';
  if (maneuver === 'roundabout' || maneuver === 'rotary') return '↺';
  if (modifier === 'left') return '←';
  if (modifier === 'right') return '→';
  if (modifier === 'slight left') return '↖';
  if (modifier === 'slight right') return '↗';
  if (modifier === 'sharp left') return '↩';
  if (modifier === 'sharp right') return '↪';
  if (modifier === 'uturn') return '↺';
  return '↑';
}

// ─── Fetch route OSRM ─────────────────────────────────────────────────────────
// fetchWithTimeout compatible React Native (pas d'AbortSignal.timeout)
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function computeRoute(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number
): Promise<RouteData | null> {
  const OSRM_SERVERS = [
    'https://router.project-osrm.org',
    'https://routing.openstreetmap.de/routed-car',
  ];
  for (const server of OSRM_SERVERS) {
    try {
      const url = `${server}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=true`;
      const res = await fetchWithTimeout(url, 12000);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.routes?.length) continue;
    const route = data.routes[0];
    const coordinates: [number, number][] = route.geometry.coordinates.map(
      ([lon, lat]: [number, number]) => [lat, lon]
    );
    const steps: NavStep[] = [];
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const [sLon, sLat] = step.maneuver?.location || [0, 0];
        const maneuver = step.maneuver?.type || 'continue';
        const modifier = step.maneuver?.modifier;
        const road = step.name ? ` sur ${step.name}` : '';
        let instruction = `Continuez${road}`;
        if (maneuver === 'turn' && modifier === 'left') instruction = `Tournez à gauche${road}`;
        else if (maneuver === 'turn' && modifier === 'right') instruction = `Tournez à droite${road}`;
        else if (maneuver === 'turn' && modifier === 'slight left') instruction = `Légèrement à gauche${road}`;
        else if (maneuver === 'turn' && modifier === 'slight right') instruction = `Légèrement à droite${road}`;
        else if (maneuver === 'turn' && modifier === 'sharp left') instruction = `Virage serré à gauche${road}`;
        else if (maneuver === 'turn' && modifier === 'sharp right') instruction = `Virage serré à droite${road}`;
        else if (maneuver === 'turn' && modifier === 'uturn') instruction = `Demi-tour${road}`;
        else if (maneuver === 'roundabout') instruction = `Prenez le rond-point${road}`;
        else if (maneuver === 'arrive') instruction = step.name ? `Arrivée à ${step.name}` : 'Vous êtes arrivé';
        else if (maneuver === 'depart') instruction = `Départ${road}`;
        steps.push({ lat: sLat, lon: sLon, instruction, maneuver, modifier, distance: step.distance || 0 });
      }
    }
      return { coordinates, distance: route.distance, duration: route.duration, steps };
    } catch {
      // Essayer le serveur suivant
      continue;
    }
  }
  return null;
}

// ─── Calcul tuiles offline ────────────────────────────────────────────────────
function lonLatToTile(lat: number, lon: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const lr = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n);
  return { x, y };
}

function tilesForBbox(minLat: number, maxLat: number, minLon: number, maxLon: number, zoom: number) {
  const tl = lonLatToTile(maxLat, minLon, zoom);
  const br = lonLatToTile(minLat, maxLon, zoom);
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

async function downloadOneTile(z: number, x: number, y: number): Promise<boolean> {
  const subdomain = ['a', 'b', 'c'][Math.abs(x + y) % 3];
  const url = `https://${subdomain}.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png`;
  const dir = `${FileSystem.documentDirectory}osmfr_tiles/${z}/${x}/`;
  const path = `${dir}${y}.png`;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists && (info as any).size > 100) return true;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const result = await FileSystem.downloadAsync(url, path, {
      headers: { 'User-Agent': 'QRMapVoyage/1.0 (iOS)' },
    });
    return result.status === 200;
  } catch {
    return false;
  }
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function MapScreen() {
  const navigation = useNavigation<MapScreenNavProp>();
  const route = useRoute<MapScreenRouteProp>();
  const { slug, itinerary: initialItinerary } = route.params;

  const cameraRef = useRef<MapLibreGL.CameraRef>(null);
  const mapViewRef = useRef<MapViewRef>(null);
  const mapReadyRef = useRef(false);
  const lastRecalcRef = useRef(0);
  const lastStepRef = useRef(-1);

  // ── État principal ────────────────────────────────────────────────────────
  const [itinerary, setItinerary] = useState<Itinerary | null>(initialItinerary || null);
  const [loading, setLoading] = useState(!initialItinerary);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);

  // ── POI natifs sélectionnés ───────────────────────────────────────────────
  const [selectedNativePOI, setSelectedNativePOI] = useState<NativePOI | null>(null);
  // Réf pour fermeture immédiate sans attendre queryRenderedFeaturesAtPoint
  const popupOpenRef = useRef(false);

  // ── Sélection étape ───────────────────────────────────────────────────────
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [showList, setShowList] = useState(false);

  // ── Offline ───────────────────────────────────────────────────────────────
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [dlProgress, setDlProgress] = useState<number | null>(null);
  const [dlStatus, setDlStatus] = useState<string>('');

  // ── Tracé global inter-jours ───────────────────────────────────────
  const [showGlobalRoute, setShowGlobalRoute] = useState(false);

  // Charger la préférence persistante au montage
  useEffect(() => {
    AsyncStorage.getItem('showGlobalRoute').then(v => {
      if (v === '1') setShowGlobalRoute(true);
    });
  }, []);

  // Sauvegarder la préférence à chaque changement
  useEffect(() => {
    AsyncStorage.setItem('showGlobalRoute', showGlobalRoute ? '1' : '0');
  }, [showGlobalRoute]);

  // ── Navigation GPS ────────────────────────────────────────────────────────
  const [navRoute, setNavRoute] = useState<RouteData | null>(null);
  const [navTarget, setNavTarget] = useState<{ lat: number; lon: number; name: string } | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [distToStep, setDistToStep] = useState<number | null>(null);
  const [remainDist, setRemainDist] = useState<number | null>(null);
  const [isCalcRoute, setIsCalcRoute] = useState(false);

  // ── Chargement itinéraire ─────────────────────────────────────────────────
  useEffect(() => {
    if (!initialItinerary) loadItinerary();
    else checkOffline();
  }, [slug]);

  const loadItinerary = async () => {
    try {
      const cached = await getItineraryBySlug(slug);
      if (cached) {
        setItinerary(cached);
        setLoading(false);
        checkOffline();
        fetchItinerary(slug)
          .then(fresh => { setItinerary(fresh); saveItinerary(fresh).catch(() => {}); })
          .catch(() => {});
        return;
      }
      const data = await fetchItinerary(slug);
      setItinerary(data);
      await saveItinerary(data);
      checkOffline();
    } catch {
      Alert.alert('Erreur', "Impossible de charger l'itinéraire.", [
        { text: 'Retour', onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const checkOffline = async () => {
    const pack = await getOfflinePack(slug);
    setIsOfflineReady(!!pack);
  };

  // ── GPS ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLoc({ lat: loc.coords.latitude, lon: loc.coords.longitude });
      } catch {}
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 8, timeInterval: 2000 },
        loc => setUserLoc({ lat: loc.coords.latitude, lon: loc.coords.longitude })
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  // ── Mise à jour navigation GPS ────────────────────────────────────────────
  useEffect(() => {
    if (!isNavigating || !navRoute || !userLoc) return;
    const steps = navRoute.steps;
    if (!steps.length) return;

    let bestIdx = stepIdx;
    let bestDist = Infinity;
    for (let i = stepIdx; i < Math.min(stepIdx + 6, steps.length); i++) {
      const d = haversine(userLoc.lat, userLoc.lon, steps[i].lat, steps[i].lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setDistToStep(bestDist);

    if (bestDist < 25 && bestIdx < steps.length - 1) {
      const newIdx = bestIdx + 1;
      setStepIdx(newIdx);
      if (newIdx !== lastStepRef.current) {
        lastStepRef.current = newIdx;
        Vibration.vibrate([0, 200, 100, 200]);
      }
    }

    let rem = 0;
    for (let i = stepIdx; i < steps.length; i++) rem += steps[i].distance;
    setRemainDist(rem);

    const now = Date.now();
    if (now - lastRecalcRef.current > 12000 && navTarget) {
      const minDist = Math.min(...navRoute.coordinates.map(([lat, lon]) =>
        haversine(userLoc.lat, userLoc.lon, lat, lon)
      ));
      if (minDist > 100) {
        lastRecalcRef.current = now;
        computeRoute(userLoc.lat, userLoc.lon, navTarget.lat, navTarget.lon).then(r => {
          if (r) { setNavRoute(r); setStepIdx(0); lastStepRef.current = -1; }
        });
      }
    }

    if (cameraRef.current && mapReadyRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [userLoc.lon, userLoc.lat],
        zoomLevel: 17,
        animationDuration: 600,
      });
    }
  }, [userLoc, isNavigating]);

  // ── Filtrage des coordonnées aberrantes par médiane ───────────────────────
  const getValidPlaces = useCallback((itin: Itinerary, day: number | null) => {
    const allPlaces = itin.days.flatMap(d => d.places)
      .filter(p => p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon));
    if (!allPlaces.length) return [];
    const sortedLats = [...allPlaces.map(p => p.lat)].sort((a, b) => a - b);
    const sortedLons = [...allPlaces.map(p => p.lon)].sort((a, b) => a - b);
    const medLat = sortedLats[Math.floor(sortedLats.length / 2)];
    const medLon = sortedLons[Math.floor(sortedLons.length / 2)];

    const places = day
      ? itin.days.find(d => d.dayNumber === day)?.places || []
      : itin.days.flatMap(d => d.places);
    return places.filter(p =>
      p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon) &&
      Math.abs(p.lat - medLat) < 10 && Math.abs(p.lon - medLon) < 10
    );
  }, []);

  // ── Caméra ────────────────────────────────────────────────────────────────
  const fitBounds = useCallback(() => {
    if (!cameraRef.current || !mapReadyRef.current || !itinerary) return;
    const valid = getValidPlaces(itinerary, selectedDay);
    if (!valid.length) return;
    const lats = valid.map(p => p.lat);
    const lons = valid.map(p => p.lon);
    const pad = 0.06;
    cameraRef.current.fitBounds(
      [Math.max(...lons) + pad, Math.max(...lats) + pad],
      [Math.min(...lons) - pad, Math.min(...lats) - pad],
      80, 800
    );
  }, [itinerary, selectedDay, getValidPlaces]);

  useEffect(() => {
    if (itinerary && mapReadyRef.current) setTimeout(fitBounds, 400);
  }, [itinerary, selectedDay]);

  // ── Navigation GPS ────────────────────────────────────────────────────────
  const startNav = async (dest: { lat: number; lon: number; name: string }) => {
    if (!userLoc) { Alert.alert('GPS requis', 'Activez la localisation pour naviguer.'); return; }
    setIsCalcRoute(true);
    setSelectedPlace(null);
    setSelectedNativePOI(null);
    try {
      const r = await computeRoute(userLoc.lat, userLoc.lon, dest.lat, dest.lon);
      if (!r) throw new Error();
      setNavRoute(r);
      setNavTarget(dest);
      setStepIdx(0);
      setIsNavigating(true);
      lastStepRef.current = -1;
    } catch {
      Alert.alert('Erreur', "Impossible de calculer l'itinéraire. Vérifiez votre connexion.");
    } finally {
      setIsCalcRoute(false);
    }
  };

  const stopNav = () => {
    setIsNavigating(false);
    setNavRoute(null);
    setNavTarget(null);
    setStepIdx(0);
    setDistToStep(null);
    setRemainDist(null);
    if (mapReadyRef.current) setTimeout(fitBounds, 300);
  };

  // ── Téléchargement offline ────────────────────────────────────────────────
  const downloadOffline = async () => {
    if (!itinerary) return;
    const daysToDownload = selectedDay
      ? itinerary.days.filter(d => d.dayNumber === selectedDay)
      : itinerary.days;

    const allPlaces = itinerary.days.flatMap(d => d.places)
      .filter(p => p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon));
    if (!allPlaces.length) return;
    const sortedLats = [...allPlaces.map(p => p.lat)].sort((a, b) => a - b);
    const sortedLons = [...allPlaces.map(p => p.lon)].sort((a, b) => a - b);
    const medLat = sortedLats[Math.floor(sortedLats.length / 2)];
    const medLon = sortedLons[Math.floor(sortedLons.length / 2)];

    const allTiles: { z: number; x: number; y: number }[] = [];
    const tileSet = new Set<string>();

    for (const day of daysToDownload) {
      const places = day.places.filter(p =>
        p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon) &&
        Math.abs(p.lat - medLat) < 10 && Math.abs(p.lon - medLon) < 10
      );
      if (!places.length) continue;
      const pad = 0.08;
      for (const place of places) {
        for (const zoom of [10, 11, 12, 13]) {
          for (const t of tilesForBbox(
            place.lat - pad, place.lat + pad,
            place.lon - pad, place.lon + pad,
            zoom
          )) {
            const key = `${t.z}/${t.x}/${t.y}`;
            if (!tileSet.has(key)) { tileSet.add(key); allTiles.push(t); }
          }
        }
      }
    }

    if (!allTiles.length) {
      Alert.alert('Aucune zone', 'Aucune étape valide trouvée.');
      return;
    }

    setDlProgress(0);
    setDlStatus(`0 / ${allTiles.length}`);

    const BATCH = 30;
    let done = 0;
    for (let i = 0; i < allTiles.length; i += BATCH) {
      const batch = allTiles.slice(i, i + BATCH);
      await Promise.all(batch.map(t => downloadOneTile(t.z, t.x, t.y)));
      done += batch.length;
      setDlProgress(Math.round((done / allTiles.length) * 100));
      setDlStatus(`${done} / ${allTiles.length}`);
    }

    setDlProgress(null);
    setDlStatus('');
    setIsOfflineReady(true);
    await saveOfflinePack(slug, `${slug}_osmfr`, itinerary.title);
    Alert.alert(
      '✅ Carte disponible hors ligne',
      `${allTiles.length} tuiles téléchargées (zoom 10-13).`
    );
  };

  // ── GeoJSON tracé global inter-jours ────────────────────────────────────
  const globalRouteGeoJSON = useMemo(() => {
    if (!showGlobalRoute || !itinerary) return null;
    const sortedDays = [...itinerary.days].sort((a, b) => a.dayNumber - b.dayNumber);
    // Construire les segments avec propriété "interDay" pour différencier le style
    const features: any[] = [];
    for (let di = 0; di < sortedDays.length; di++) {
      const day = sortedDays[di];
      const places = day.places.filter(p => p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon));
      // Segments intra-jour (couleur du jour)
      for (let i = 0; i < places.length - 1; i++) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [places[i].lon, places[i].lat],
              [places[i + 1].lon, places[i + 1].lat],
            ],
          },
          properties: {
            interDay: false,
            color: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length],
          },
        });
      }
      // Segment inter-jour (dernier point du jour → premier point du jour suivant)
      if (di < sortedDays.length - 1) {
        const nextDay = sortedDays[di + 1];
        const nextPlaces = nextDay.places.filter(p => p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon));
        if (places.length > 0 && nextPlaces.length > 0) {
          const last = places[places.length - 1];
          const first = nextPlaces[0];
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [last.lon, last.lat],
                [first.lon, first.lat],
              ],
            },
            properties: {
              interDay: true,
              color: '#ffffff',
              label: `J${day.dayNumber} → J${nextDay.dayNumber}`,
            },
          });
        }
      }
    }
    if (!features.length) return null;
    return { type: 'FeatureCollection', features };
  }, [showGlobalRoute, itinerary]);

  // GeoJSON filtré : intra-jour uniquement
  const globalRouteIntraDayGeoJSON = useMemo(() => {
    if (!globalRouteGeoJSON) return null;
    return {
      ...globalRouteGeoJSON,
      features: globalRouteGeoJSON.features.filter((f: any) => !f.properties.interDay),
    };
  }, [globalRouteGeoJSON]);

  // GeoJSON filtré : inter-jours uniquement
  const globalRouteInterDayGeoJSON = useMemo(() => {
    if (!globalRouteGeoJSON) return null;
    return {
      ...globalRouteGeoJSON,
      features: globalRouteGeoJSON.features.filter((f: any) => f.properties.interDay),
    };
  }, [globalRouteGeoJSON]);

  // ── GeoJSON route ─────────────────────────────────────────────────────────
  const routeGeoJSON = useMemo(() => {
    if (!navRoute) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: navRoute.coordinates.map(([lat, lon]) => [lon, lat]),
      },
      properties: {},
    };
  }, [navRoute]);

  // ── Marqueurs filtrés ─────────────────────────────────────────────────────
  const markers = useMemo(() => {
    if (!itinerary) return [];
    const valid = getValidPlaces(itinerary, selectedDay);
    const days = selectedDay
      ? itinerary.days.filter(d => d.dayNumber === selectedDay)
      : itinerary.days;
    return days.flatMap(day =>
      day.places
        .filter(p => valid.includes(p))
        .map((place, idx) => ({
          place,
          dayNumber: day.dayNumber,
          orderIndex: idx + 1,
          color: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length],
        }))
    );
  }, [itinerary, selectedDay, getValidPlaces]);

  // ── ETA ───────────────────────────────────────────────────────────────────
  const eta = useMemo(() => {
    if (remainDist === null) return null;
    const secs = remainDist / 12;
    const d = new Date(Date.now() + secs * 1000);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }, [remainDist]);

  const distFromUser = (lat: number, lon: number) => {
    if (!userLoc) return null;
    return fmtDist(haversine(userLoc.lat, userLoc.lon, lat, lon));
  };

  // ── Gestion du tap sur la carte ───────────────────────────────────────────────
  // IMPORTANT : queryRenderedFeaturesAtPoint utilise les VRAIS layer IDs du style bright
  // vérifiés dans le JSON : poi_r1, poi_r7, poi_r20, poi_transit
  const handleMapPress = useCallback(async (feature: any) => {
    // Si un popup est ouvert, le fermer immédiatement sans lancer la query
    if (popupOpenRef.current) {
      setSelectedPlace(null);
      setSelectedNativePOI(null);
      popupOpenRef.current = false;
      return;
    }
    setSelectedPlace(null);
    setSelectedNativePOI(null);
    if (!mapViewRef.current) return;
    try {
      const sx = feature?.properties?.screenPointX;
      const sy = feature?.properties?.screenPointY;
      if (sx == null || sy == null) return;

      const rendered = await (mapViewRef.current as any).queryRenderedFeaturesAtPoint(
        [sx, sy],
        null,
        POI_LAYER_IDS
      );

      if (!rendered?.features?.length) return;

      const feat = rendered.features[0];
      const props = feat.properties || {};

      // Préférer le nom français, puis latin, puis anglais
      const name =
        props['name:fr'] ||
        props['name:latin'] ||
        props['name:en'] ||
        props['name_en'] ||
        props.name ||
        props.ref ||
        '';

      if (!name) return;

      // Coordonnées du POI depuis la géométrie
      let lon: number, lat: number;
      if (feat.geometry?.type === 'Point') {
        [lon, lat] = feat.geometry.coordinates;
      } else {
        // Fallback : utiliser les coordonnées du tap
        lon = feature?.geometry?.coordinates?.[0];
        lat = feature?.geometry?.coordinates?.[1];
      }

      if (!lon || !lat) return;

      const style = classifyNativePOI(props);

      setSelectedNativePOI({ name, lon, lat, ...style });
      popupOpenRef.current = true;
    } catch (_) {
      // queryRenderedFeaturesAtPoint peut échouer si la carte n'est pas prête
    }
  }, []);

  // ─── Rendu ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color="#f39c12" />
        <Text style={s.loadingText}>Chargement de l'itinéraire...</Text>
      </View>
    );
  }
  if (!itinerary) return null;

  const currentStep = navRoute?.steps?.[stepIdx];
  const nextStep = navRoute?.steps?.[stepIdx + 1];
  const activeDays = selectedDay
    ? itinerary.days.filter(d => d.dayNumber === selectedDay)
    : itinerary.days;

  return (
    <View style={s.container}>

      {/* ═══════════════════════════════════════════════════════════════════
          CARTE — Style vectoriel OpenFreeMap "Bright"
          POI natifs cliquables via queryRenderedFeaturesAtPoint
          Layers : poi_r1, poi_r7, poi_r20, poi_transit (vérifiés JSON)
      ═══════════════════════════════════════════════════════════════════ */}
      <MapLibreGL.MapView
        ref={mapViewRef}
        style={s.map}
        mapStyle={MAP_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={true}
        attributionPosition={{ bottom: 8, right: 8 }}
        onPress={handleMapPress}
        onDidFinishLoadingMap={() => {
          mapReadyRef.current = true;
          setTimeout(fitBounds, 300);
        }}
      >
        <MapLibreGL.Camera ref={cameraRef} />
        <MapLibreGL.UserLocation visible={true} showsUserHeadingIndicator={true} />

        {/* Ligne de navigation */}
        {routeGeoJSON && (
          <MapLibreGL.ShapeSource id="route-src" shape={routeGeoJSON as any}>
            <MapLibreGL.LineLayer
              id="route-shadow"
              style={{ lineColor: '#000', lineWidth: 9, lineOpacity: 0.12, lineCap: 'round', lineJoin: 'round' }}
            />
            <MapLibreGL.LineLayer
              id="route-line"
              style={{ lineColor: '#2980b9', lineWidth: 5, lineOpacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Tracé global inter-jours — segments intra-jour (couleurs) */}
        {globalRouteIntraDayGeoJSON && (
          <MapLibreGL.ShapeSource id="global-intraday-src" shape={globalRouteIntraDayGeoJSON as any}>
            <MapLibreGL.LineLayer
              id="global-intraday-shadow"
              style={{ lineColor: '#000', lineWidth: 8, lineOpacity: 0.18, lineCap: 'round', lineJoin: 'round' }}
            />
            <MapLibreGL.LineLayer
              id="global-intraday-line"
              style={{ lineColor: ['get', 'color'], lineWidth: 5, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Tracé global inter-jours — segments inter-jours (pointillés blancs) */}
        {globalRouteInterDayGeoJSON && (
          <MapLibreGL.ShapeSource id="global-interday-src" shape={globalRouteInterDayGeoJSON as any}>
            <MapLibreGL.LineLayer
              id="global-interday-shadow"
              style={{ lineColor: '#000', lineWidth: 6, lineOpacity: 0.15, lineCap: 'round', lineDasharray: [2, 3] }}
            />
            <MapLibreGL.LineLayer
              id="global-interday-line"
              style={{ lineColor: '#ffffff', lineWidth: 3, lineOpacity: 0.85, lineCap: 'round', lineDasharray: [2, 3] }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Marqueurs étapes — PointAnnotation React Native (ZÉRO SymbolLayer) */}
        {markers.map(m => (
          <MapLibreGL.PointAnnotation
            key={`step-${m.dayNumber}-${m.place.id}`}
            id={`step-${m.dayNumber}-${m.place.id}`}
            coordinate={[m.place.lon, m.place.lat]}
            onSelected={() => {
              setSelectedPlace(m.place);
              setSelectedNativePOI(null);
              popupOpenRef.current = true;
            }}
          >
            <View style={[s.stepMarker, { backgroundColor: m.color }]}>
              <Text style={s.stepMarkerText}>{m.orderIndex}</Text>
            </View>
          </MapLibreGL.PointAnnotation>
        ))}
      </MapLibreGL.MapView>

      {/* ═══ HEADER ═══ */}
      {!isNavigating && (
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
            <Text style={s.backBtnText}>←</Text>
          </TouchableOpacity>
          <View style={s.headerMid}>
            <Text style={s.headerTitle} numberOfLines={1}>{itinerary.title}</Text>
            {selectedDay && (() => {
              const day = itinerary.days.find(d => d.dayNumber === selectedDay);
              if (!day) return null;
              return (
                <Text style={s.headerSubtitle} numberOfLines={1}>
                  {day.date ? formatDate(day.date) : day.title || `Jour ${selectedDay}`}
                </Text>
              );
            })()}
          </View>
          <TouchableOpacity
            style={[s.offlineBtn, isOfflineReady && s.offlineBtnReady]}
            onPress={dlProgress !== null ? undefined : downloadOffline}
            disabled={dlProgress !== null}
          >
            <Text style={s.offlineBtnText}>
              {dlProgress !== null ? `${dlProgress}%` : isOfflineReady ? '✓ Offline' : '⬇ Offline'}
            </Text>
            {dlStatus ? <Text style={s.offlineBtnSub}>{dlStatus}</Text> : null}
          </TouchableOpacity>
        </View>
      )}

      {/* ═══ FILTRES JOURS ═══ */}
      {!isNavigating && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.daysBar}
          contentContainerStyle={s.daysBarContent}
        >
          <TouchableOpacity
            style={[s.dayChip, selectedDay === null && s.dayChipActive]}
            onPress={() => setSelectedDay(null)}
          >
            <Text style={[s.dayChipText, selectedDay === null && s.dayChipTextActive]}>Tous</Text>
          </TouchableOpacity>
          {itinerary.days.map(day => (
            <TouchableOpacity
              key={day.id}
              style={[
                s.dayChip,
                { borderColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] },
                selectedDay === day.dayNumber && { backgroundColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] },
                day.date && { paddingVertical: 5 },
              ]}
              onPress={() => { const next = selectedDay === day.dayNumber ? null : day.dayNumber; setSelectedDay(next); if (next !== null) setShowGlobalRoute(false); }}
            >
              <Text style={[s.dayChipText, selectedDay === day.dayNumber && s.dayChipTextActive]}>
                J{day.dayNumber}
              </Text>
              {day.date && (
                <Text style={[
                  s.dayChipDate,
                  selectedDay === day.dayNumber && { color: 'rgba(255,255,255,0.9)' }
                ]}>
                  {formatDateShort(day.date)}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ═══ BANNIÈRE NAVIGATION ═══ */}
      {isNavigating && currentStep && (
        <View style={s.navBanner}>
          <View style={s.navArrowBox}>
            <Text style={s.navArrow}>{arrowForManeuver(currentStep.maneuver, currentStep.modifier)}</Text>
            <Text style={s.navStepDist}>
              {distToStep !== null ? fmtDist(distToStep) : fmtDist(currentStep.distance)}
            </Text>
          </View>
          <View style={s.navInstrBox}>
            <Text style={s.navInstr} numberOfLines={2}>{currentStep.instruction}</Text>
            {nextStep && (
              <Text style={s.navNext} numberOfLines={1}>
                Ensuite : {arrowForManeuver(nextStep.maneuver, nextStep.modifier)} {nextStep.instruction}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* ═══ BARRE BAS NAVIGATION ═══ */}
      {isNavigating && (
        <View style={s.navBottom}>
          <View>
            <Text style={s.navRemDist}>{remainDist !== null ? fmtDist(remainDist) : '--'}</Text>
            <Text style={s.navRemLabel}>restant</Text>
          </View>
          <View style={s.navDest}>
            <Text style={s.navDestIcon}>🏁</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.navDestName} numberOfLines={1}>{navTarget?.name || 'Destination'}</Text>
              {eta && <Text style={s.navEta}>Arrivée : {eta}</Text>}
            </View>
          </View>
          <TouchableOpacity style={s.navStopBtn} onPress={stopNav}>
            <Text style={s.navStopText}>✕ Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ═══ POPUP ÉTAPE ═══ */}
      {selectedPlace && !isNavigating && (
        <View style={s.popup}>
          <TouchableOpacity
            style={s.popupCloseBtn}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            onPress={() => { setSelectedPlace(null); popupOpenRef.current = false; }}
          >
            <Text style={s.popupCloseTxt}>✕</Text>
          </TouchableOpacity>
          <Text style={s.popupTitle} numberOfLines={2}>{selectedPlace.name}</Text>
          {userLoc && (
            <Text style={s.popupDist}>📍 {distFromUser(selectedPlace.lat, selectedPlace.lon)}</Text>
          )}
          {!!selectedPlace.description && (
            <Text style={s.popupDesc} numberOfLines={3}>{selectedPlace.description}</Text>
          )}
          <View style={s.popupActions}>
            <TouchableOpacity
              style={s.popupNavBtn}
              onPress={() => startNav({ lat: selectedPlace.lat, lon: selectedPlace.lon, name: selectedPlace.name })}
              disabled={isCalcRoute}
            >
              {isCalcRoute
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.popupNavBtnTxt}>🧭 Naviguer</Text>
              }
            </TouchableOpacity>

          </View>
        </View>
      )}

      {/* ═══ POPUP POI NATIF ═══ */}
      {selectedNativePOI && !isNavigating && (
        <View style={s.popup}>
          <TouchableOpacity
            style={s.popupCloseBtn}
            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            onPress={() => { setSelectedNativePOI(null); popupOpenRef.current = false; }}
          >
            <Text style={s.popupCloseTxt}>✕</Text>
          </TouchableOpacity>
          <View style={s.poiPopupRow}>
            <View style={[s.poiPopupIcon, { backgroundColor: selectedNativePOI.color }]}>
              <Text style={{ fontSize: 18 }}>{selectedNativePOI.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.popupTitle} numberOfLines={2}>{selectedNativePOI.name}</Text>
              <Text style={s.poiPopupType}>
                {selectedNativePOI.category}
                {userLoc ? `  ·  ${distFromUser(selectedNativePOI.lat, selectedNativePOI.lon)}` : ''}
              </Text>
            </View>
          </View>
          <View style={s.popupActions}>
            <TouchableOpacity
              style={s.popupNavBtn}
              onPress={() => startNav({ lat: selectedNativePOI.lat, lon: selectedNativePOI.lon, name: selectedNativePOI.name })}
              disabled={isCalcRoute}
            >
              {isCalcRoute
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.popupNavBtnTxt}>🧭 Naviguer</Text>
              }
            </TouchableOpacity>

          </View>
        </View>
      )}

      {/* ═══ PANNEAU LISTE ═══ */}
      {showList && !isNavigating && (
        <View style={s.listPanel}>
          <View style={s.listPanelHeader}>
            <Text style={s.listPanelTitle}>
              {selectedDay ? `Jour ${selectedDay}` : 'Tous les lieux'}
            </Text>
            <TouchableOpacity onPress={() => setShowList(false)}>
              <Text style={s.listPanelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={s.listPanelScroll}>
            {activeDays.map(day => (
              <View key={day.id}>
                <View style={[s.listDayHeader, { borderLeftColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] }]}>
                  <Text style={s.listDayTitle}>Jour {day.dayNumber} — {day.title}</Text>
                  {day.date && <Text style={s.listDayDate}>{formatDateShort(day.date)}</Text>}
                </View>
                {day.places
                  .filter(p => p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon))
                  .map((place, idx) => (
                    <TouchableOpacity
                      key={place.id}
                      style={s.listItem}
                      onPress={() => {
                        setSelectedPlace(place);
                        setShowList(false);
                        if (cameraRef.current && mapReadyRef.current) {
                          cameraRef.current.setCamera({
                            centerCoordinate: [place.lon, place.lat],
                            zoomLevel: 15,
                            animationDuration: 800,
                          });
                        }
                      }}
                    >
                      <View style={[s.listBadge, { backgroundColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] }]}>
                        <Text style={s.listBadgeText}>{idx + 1}</Text>
                      </View>
                      <View style={s.listItemContent}>
                        <Text style={s.listItemName}>{place.name}</Text>
                        {userLoc && (
                          <Text style={s.listItemDist}>{distFromUser(place.lat, place.lon)}</Text>
                        )}
                      </View>
                      <Text style={s.listItemArrow}>›</Text>
                    </TouchableOpacity>
                  ))}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ═══ BOUTONS FLOTTANTS ═══ */}
      {!isNavigating && (
        <>
          <TouchableOpacity style={s.listBtn} onPress={() => setShowList(!showList)}>
            <Text style={s.listBtnText}>{showList ? '✕' : '☰ Lieux'}</Text>
          </TouchableOpacity>
          {/* Bouton Tracé global */}
          <TouchableOpacity
            style={[s.globalRouteBtn, showGlobalRoute && s.globalRouteBtnActive]}
            onPress={() => setShowGlobalRoute(v => !v)}
          >
            <Text style={[s.globalRouteBtnText, showGlobalRoute && s.globalRouteBtnTextActive]}>
              {showGlobalRoute ? '✖ Tracé' : '🗺 Tracé global'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.centerBtn} onPress={fitBounds}>
            <Text style={s.centerBtnText}>⊙</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 16 },

  stepMarker: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4,
  },
  stepMarkerText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10,10,25,0.93)',
    paddingTop: Platform.OS === 'ios' ? 54 : 34,
    paddingBottom: 12, paddingHorizontal: 12, gap: 8,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { color: '#fff', fontSize: 20 },
  headerMid: { flex: 1 },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1 },
  offlineBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1.5, borderColor: '#f39c12',
  },
  offlineBtnReady: { borderColor: '#2ecc71' },
  offlineBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  offlineBtnSub: { color: 'rgba(255,255,255,0.6)', fontSize: 9, marginTop: 1, textAlign: 'center' },

  daysBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 90,
    left: 0, right: 0,
  },
  daysBarContent: { paddingHorizontal: 10, gap: 6 },
  dayChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1.5, borderColor: '#555',
    backgroundColor: 'rgba(10,10,25,0.88)',
    alignItems: 'center',
  },
  dayChipActive: { backgroundColor: '#f39c12', borderColor: '#f39c12' },
  dayChipText: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  dayChipTextActive: { color: '#fff' },
  dayChipDate: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 1, fontWeight: '500' },

  navBanner: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a3a5c',
    paddingTop: Platform.OS === 'ios' ? 54 : 34,
    paddingBottom: 14, paddingHorizontal: 14, gap: 14,
  },
  navArrowBox: { alignItems: 'center', minWidth: 64 },
  navArrow: { fontSize: 40, color: '#fff' },
  navStepDist: { color: '#7ec8e3', fontSize: 14, fontWeight: '700', marginTop: 2 },
  navInstrBox: { flex: 1 },
  navInstr: { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 22 },
  navNext: { color: '#aac4d8', fontSize: 12, marginTop: 4 },

  navBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10,10,25,0.96)',
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    paddingTop: 14, paddingHorizontal: 16, gap: 12,
  },
  navRemDist: { color: '#fff', fontSize: 22, fontWeight: '800' },
  navRemLabel: { color: '#888', fontSize: 11 },
  navDest: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  navDestIcon: { fontSize: 20 },
  navDestName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  navEta: { color: '#888', fontSize: 11 },
  navStopBtn: {
    backgroundColor: '#c0392b',
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
  },
  navStopText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  popup: {
    position: 'absolute', bottom: 80, left: 12, right: 12,
    backgroundColor: 'rgba(10,10,25,0.97)',
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3, shadowRadius: 8,
    elevation: 20, zIndex: 100,
  },
  popupCloseBtn: { position: 'absolute', top: 8, right: 8, padding: 10, zIndex: 10 },
  popupCloseTxt: { color: '#bbb', fontSize: 20, fontWeight: '700' },
  popupTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4, paddingRight: 24 },
  popupDist: { color: '#f39c12', fontSize: 13, marginBottom: 4 },
  popupDesc: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  popupActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  popupNavBtn: {
    flex: 1, backgroundColor: '#2980b9',
    paddingVertical: 11, borderRadius: 10, alignItems: 'center',
  },
  popupNavBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  poiPopupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  poiPopupIcon: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  poiPopupType: { color: '#888', fontSize: 12, marginTop: 2 },

  listPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(10,10,25,0.97)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '60%',
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  listPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  listPanelTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  listPanelClose: { color: '#888', fontSize: 18 },
  listPanelScroll: { flex: 1 },
  listDayHeader: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderLeftWidth: 3, marginLeft: 8, marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  listDayTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  listDayDate: { color: '#888', fontSize: 11, marginTop: 2 },
  listItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  listBadge: {
    width: 28, height: 28, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  listBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  listItemContent: { flex: 1 },
  listItemName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  listItemDist: { color: '#888', fontSize: 12, marginTop: 2 },
  listItemArrow: { color: '#555', fontSize: 20 },

  listBtn: {
    position: 'absolute', bottom: 70, left: 16,
    backgroundColor: 'rgba(10,10,25,0.92)',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  listBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  globalRouteBtn: {
    position: 'absolute', bottom: 20, left: 16,
    backgroundColor: 'rgba(10,10,25,0.92)',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  globalRouteBtnActive: {
    backgroundColor: '#27797d',
    borderColor: '#27797d',
  },
  globalRouteBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  globalRouteBtnTextActive: { color: '#fff' },
  centerBtn: {
    position: 'absolute', bottom: 20, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(10,10,25,0.92)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  centerBtnText: { color: '#fff', fontSize: 20 },
});
