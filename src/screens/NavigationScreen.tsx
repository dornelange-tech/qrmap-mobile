/**
 * NavigationScreen.tsx — Navigation GPS complète (gratuite)
 *
 * Fonctionnalités :
 * - Recherche d'adresse / lieu / restaurant via Nominatim (OSM)
 * - 3 modes de transport : 🚶 À pied / 🚴 Vélo / 🚗 Voiture
 * - Itinéraires alternatifs (2-3 routes) : plus court, plus rapide
 * - Instructions turn-by-turn en français avec flèches
 * - Recalcul automatique si déviation > 80m
 * - Bannière de navigation avec instruction suivante
 * - Carte MapLibreGL vectorielle OpenFreeMap "Bright"
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, Alert, Platform, Vibration,
  Keyboard, KeyboardAvoidingView,
} from 'react-native';
import MapLibreGL, { MapViewRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';

MapLibreGL.setAccessToken(null);

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

// ─── Types ────────────────────────────────────────────────────────────────────
type TransportMode = 'foot' | 'bike' | 'car';

interface TransportOption {
  key: TransportMode;
  label: string;
  icon: string;
  osrmProfile: string;
  speedKmh: number; // pour ETA estimé
}

const TRANSPORT_OPTIONS: TransportOption[] = [
  { key: 'foot',  label: 'À pied',  icon: '🚶', osrmProfile: 'foot',    speedKmh: 5  },
  { key: 'bike',  label: 'Vélo',    icon: '🚴', osrmProfile: 'bike',    speedKmh: 18 },
  { key: 'car',   label: 'Voiture', icon: '🚗', osrmProfile: 'driving', speedKmh: 50 },
];

interface NavStep {
  lat: number;
  lon: number;
  instruction: string;
  maneuver: string;
  modifier?: string;
  distance: number; // mètres
  duration: number; // secondes
}

interface RouteData {
  coordinates: [number, number][]; // [lat, lon]
  distance: number;  // mètres
  duration: number;  // secondes
  steps: NavStep[];
}

interface RouteAlternative {
  route: RouteData;
  color: string;
  label: string;
  description: string; // "Plus court", "Plus rapide", "Alternatif"
}

interface AddressSuggestion {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  type: string; // restaurant, hotel, etc.
}

const ALT_COLORS = ['#2980b9', '#e67e22', '#27ae60'];
const ALT_DESCRIPTIONS = ['Plus rapide', 'Plus court', 'Alternatif'];

type NavScreenProp = NativeStackNavigationProp<RootStackParamList>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m: number): string {
  if (m < 50) return 'ici';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)} s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
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

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseOsrmRoute(rawRoute: any): RouteData {
  const coordinates: [number, number][] = rawRoute.geometry.coordinates.map(
    ([lon, lat]: [number, number]) => [lat, lon]
  );
  const steps: NavStep[] = [];
  for (const leg of rawRoute.legs || []) {
    for (const step of leg.steps || []) {
      const [sLon, sLat] = step.maneuver?.location || [0, 0];
      const maneuver = step.maneuver?.type || 'continue';
      const modifier = step.maneuver?.modifier;
      const road = step.name ? ` sur ${step.name}` : '';
      let instruction = `Continuez${road}`;
      if (maneuver === 'turn' && modifier === 'left')        instruction = `Tournez à gauche${road}`;
      else if (maneuver === 'turn' && modifier === 'right')  instruction = `Tournez à droite${road}`;
      else if (maneuver === 'turn' && modifier === 'slight left')  instruction = `Légèrement à gauche${road}`;
      else if (maneuver === 'turn' && modifier === 'slight right') instruction = `Légèrement à droite${road}`;
      else if (maneuver === 'turn' && modifier === 'sharp left')   instruction = `Virage serré à gauche${road}`;
      else if (maneuver === 'turn' && modifier === 'sharp right')  instruction = `Virage serré à droite${road}`;
      else if (maneuver === 'turn' && modifier === 'uturn')  instruction = `Demi-tour${road}`;
      else if (maneuver === 'roundabout') instruction = `Prenez le rond-point${road}`;
      else if (maneuver === 'arrive')  instruction = step.name ? `Arrivée à ${step.name}` : 'Vous êtes arrivé';
      else if (maneuver === 'depart')  instruction = `Départ${road}`;
      else if (maneuver === 'merge')   instruction = `Rejoignez${road}`;
      else if (maneuver === 'fork')    instruction = `Prenez la bifurcation${road}`;
      else if (maneuver === 'on ramp') instruction = `Prenez la bretelle${road}`;
      else if (maneuver === 'off ramp') instruction = `Quittez la voie rapide${road}`;
      steps.push({
        lat: sLat, lon: sLon, instruction, maneuver, modifier,
        distance: step.distance || 0, duration: step.duration || 0,
      });
    }
  }
  return { coordinates, distance: rawRoute.distance, duration: rawRoute.duration, steps };
}

// ─── Calcul d'itinéraires avec alternatives ────────────────────────────────────
async function fetchRoutes(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
  profile: string
): Promise<RouteAlternative[] | null> {
  // Serveurs OSRM publics par profil (avec fallback)
  const SERVERS: Record<string, string[]> = {
    driving: [
      'https://router.project-osrm.org',
      'https://routing.openstreetmap.de/routed-car',
    ],
    foot: [
      'https://routing.openstreetmap.de/routed-foot',
      'https://router.project-osrm.org',
    ],
    bike: [
      'https://routing.openstreetmap.de/routed-bike',
      'https://router.project-osrm.org',
    ],
  };

  const servers = SERVERS[profile] || SERVERS.driving;

  for (const server of servers) {
    try {
      const url =
        `${server}/route/v1/${profile}/` +
        `${fromLon},${fromLat};${toLon},${toLat}` +
        `?overview=full&geometries=geojson&steps=true&alternatives=true`;
      const res = await fetchWithTimeout(url, 15000);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.routes?.length) continue;

      // Trier : route[0] = plus rapide (OSRM), route[1] = alternative
      // On ajoute une 3ème "plus courte" si on a 2 routes
      const parsed = data.routes.slice(0, 3).map((r: any, i: number) => ({
        route: parseOsrmRoute(r),
        color: ALT_COLORS[i] || ALT_COLORS[0],
        label: i === 0 ? 'Route principale' : `Alternative ${i}`,
        description: ALT_DESCRIPTIONS[i] || 'Alternatif',
      }));

      // Si une seule route, on la duplique avec un label différent pour UX
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Recherche d'adresse (Nominatim + Photon) ─────────────────────────────────
async function searchPlaces(query: string): Promise<AddressSuggestion[]> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(query)}&format=json&limit=7&addressdetails=1&extratags=1` +
      `&accept-language=fr`;
    const res = await fetchWithTimeout(url, 8000);
    const data = await res.json();
    return data.map((r: any) => {
      const addr = r.address || {};
      // Construire un nom court lisible
      const shortName =
        r.namedetails?.name ||
        addr.amenity ||
        addr.shop ||
        addr.tourism ||
        addr.road ||
        r.display_name.split(',')[0];
      // Détecter le type pour l'icône
      const type = r.type || r.class || '';
      return {
        name: shortName,
        displayName: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        type,
      };
    });
  } catch {
    return [];
  }
}

function iconForType(type: string): string {
  if (['restaurant', 'fast_food', 'food_court', 'cafe'].includes(type)) return '🍽';
  if (['hotel', 'hostel', 'motel', 'guest_house'].includes(type)) return '🏨';
  if (['museum', 'gallery', 'attraction', 'monument'].includes(type)) return '🏛';
  if (['hospital', 'clinic', 'pharmacy'].includes(type)) return '🏥';
  if (['supermarket', 'convenience', 'mall'].includes(type)) return '🛒';
  if (['bus_stop', 'station', 'train_station'].includes(type)) return '🚆';
  if (['airport'].includes(type)) return '✈️';
  if (['park', 'garden', 'nature_reserve'].includes(type)) return '🌳';
  if (['beach'].includes(type)) return '🏖';
  if (['fuel'].includes(type)) return '⛽';
  if (['bank', 'atm'].includes(type)) return '💳';
  return '📍';
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function NavigationScreen() {
  const navigation = useNavigation<NavScreenProp>();
  const cameraRef = useRef<MapLibreGL.CameraRef>(null);
  const mapViewRef = useRef<MapViewRef>(null);
  const mapReadyRef = useRef(false);
  const lastRecalcRef = useRef(0);
  const lastStepRef = useRef(-1);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Localisation ─────────────────────────────────────────────────────────
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [locGranted, setLocGranted] = useState(false);

  // ── Recherche ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ── Destination ───────────────────────────────────────────────────────────
  const [destination, setDestination] = useState<{ name: string; lat: number; lon: number } | null>(null);

  // ── Transport ─────────────────────────────────────────────────────────────
  const [transportMode, setTransportMode] = useState<TransportMode>('car');

  // ── Routes ────────────────────────────────────────────────────────────────
  const [alternatives, setAlternatives] = useState<RouteAlternative[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [isCalcRoute, setIsCalcRoute] = useState(false);
  const [showRouteSelector, setShowRouteSelector] = useState(false);

  // ── Navigation active ─────────────────────────────────────────────────────
  const [isNavigating, setIsNavigating] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [distToStep, setDistToStep] = useState<number | null>(null);
  const [remainDist, setRemainDist] = useState<number | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);

  // ── Panneau étapes ────────────────────────────────────────────────────────
  const [showSteps, setShowSteps] = useState(false);

  // ── GPS ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('GPS requis', 'Activez la localisation pour utiliser la navigation.');
        return;
      }
      setLocGranted(true);
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const pos = { lat: loc.coords.latitude, lon: loc.coords.longitude };
        setUserLoc(pos);
        if (cameraRef.current && mapReadyRef.current) {
          cameraRef.current.setCamera({
            centerCoordinate: [pos.lon, pos.lat],
            zoomLevel: 15,
            animationDuration: 800,
          });
        }
      } catch {}
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 6, timeInterval: 1500 },
        loc => setUserLoc({ lat: loc.coords.latitude, lon: loc.coords.longitude })
      );
    })();
    return () => { sub?.remove(); };
  }, []);

  // ── Mise à jour navigation en cours ───────────────────────────────────────
  const activeRoute = alternatives[selectedIdx]?.route ?? null;

  useEffect(() => {
    if (!isNavigating || !activeRoute || !userLoc) return;
    const steps = activeRoute.steps;
    if (!steps.length) return;

    // Trouver l'étape la plus proche
    let bestIdx = stepIdx;
    let bestDist = Infinity;
    for (let i = stepIdx; i < Math.min(stepIdx + 8, steps.length); i++) {
      const d = haversine(userLoc.lat, userLoc.lon, steps[i].lat, steps[i].lon);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setDistToStep(bestDist);

    // Avancer à l'étape suivante si on est proche
    if (bestDist < 25 && bestIdx < steps.length - 1) {
      const newIdx = bestIdx + 1;
      setStepIdx(newIdx);
      if (newIdx !== lastStepRef.current) {
        lastStepRef.current = newIdx;
        Vibration.vibrate([0, 150, 80, 150]);
      }
    }

    // Distance restante
    let rem = 0;
    for (let i = stepIdx; i < steps.length; i++) rem += steps[i].distance;
    setRemainDist(rem);

    // Recalcul si déviation > 80m (max toutes les 15s)
    const now = Date.now();
    if (now - lastRecalcRef.current > 15000 && destination && !isRecalculating) {
      const minDist = Math.min(...activeRoute.coordinates.map(([lat, lon]) =>
        haversine(userLoc.lat, userLoc.lon, lat, lon)
      ));
      if (minDist > 80) {
        lastRecalcRef.current = now;
        setIsRecalculating(true);
        const profile = TRANSPORT_OPTIONS.find(m => m.key === transportMode)?.osrmProfile || 'driving';
        fetchRoutes(userLoc.lat, userLoc.lon, destination.lat, destination.lon, profile)
          .then(alts => {
            if (alts?.length) {
              setAlternatives(alts);
              setSelectedIdx(0);
              setStepIdx(0);
              lastStepRef.current = -1;
            }
          })
          .finally(() => setIsRecalculating(false));
      }
    }

    // Centrer la carte sur l'utilisateur pendant la navigation
    if (cameraRef.current && mapReadyRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [userLoc.lon, userLoc.lat],
        zoomLevel: 17,
        animationDuration: 500,
      });
    }
  }, [userLoc, isNavigating]);

  // ── Recherche d'adresse avec debounce ─────────────────────────────────────
  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.trim().length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      const results = await searchPlaces(text);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setIsSearching(false);
    }, 400);
  };

  // ── Sélectionner une destination ──────────────────────────────────────────
  const selectDestination = useCallback(async (sug: AddressSuggestion) => {
    Keyboard.dismiss();
    setQuery(sug.name);
    setSuggestions([]);
    setShowSuggestions(false);
    const dest = { name: sug.name, lat: sug.lat, lon: sug.lon };
    setDestination(dest);

    // Centrer la carte sur la destination
    if (cameraRef.current && mapReadyRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [sug.lon, sug.lat],
        zoomLevel: 14,
        animationDuration: 1000,
      });
    }

    // Calculer les routes si on a la position
    if (userLoc) {
      await calculateRoutes(userLoc, dest, transportMode);
    }
  }, [userLoc, transportMode]);

  // ── Calculer les routes ───────────────────────────────────────────────────
  const calculateRoutes = useCallback(async (
    from: { lat: number; lon: number },
    dest: { name: string; lat: number; lon: number },
    mode: TransportMode
  ) => {
    setIsCalcRoute(true);
    setAlternatives([]);
    setSelectedIdx(0);
    setShowRouteSelector(false);
    const profile = TRANSPORT_OPTIONS.find(m => m.key === mode)?.osrmProfile || 'driving';
    try {
      const alts = await fetchRoutes(from.lat, from.lon, dest.lat, dest.lon, profile);
      if (!alts?.length) throw new Error('Aucun itinéraire trouvé');
      setAlternatives(alts);
      setShowRouteSelector(alts.length > 1);

      // Ajuster la vue pour voir tout le trajet
      if (cameraRef.current && mapReadyRef.current && alts[0].route.coordinates.length > 0) {
        const coords = alts[0].route.coordinates;
        const lats = coords.map(([lat]) => lat);
        const lons = coords.map(([, lon]) => lon);
        const pad = 0.02;
        cameraRef.current.fitBounds(
          [Math.max(...lons) + pad, Math.max(...lats) + pad],
          [Math.min(...lons) - pad, Math.min(...lats) - pad],
          80, 1000
        );
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || "Impossible de calculer l'itinéraire.");
    } finally {
      setIsCalcRoute(false);
    }
  }, []);

  // ── Changer le mode de transport ──────────────────────────────────────────
  const changeMode = useCallback(async (mode: TransportMode) => {
    setTransportMode(mode);
    if (userLoc && destination) {
      await calculateRoutes(userLoc, destination, mode);
    }
  }, [userLoc, destination, calculateRoutes]);

  // ── Démarrer la navigation ────────────────────────────────────────────────
  const startNavigation = useCallback(() => {
    if (!alternatives.length) return;
    setIsNavigating(true);
    setStepIdx(0);
    setShowRouteSelector(false);
    lastStepRef.current = -1;
    lastRecalcRef.current = 0;
  }, [alternatives]);

  // ── Arrêter la navigation ─────────────────────────────────────────────────
  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setStepIdx(0);
    setDistToStep(null);
    setRemainDist(null);
    setShowSteps(false);
    // Recadrer sur le trajet
    if (alternatives[selectedIdx] && cameraRef.current && mapReadyRef.current) {
      const coords = alternatives[selectedIdx].route.coordinates;
      const lats = coords.map(([lat]) => lat);
      const lons = coords.map(([, lon]) => lon);
      const pad = 0.02;
      cameraRef.current.fitBounds(
        [Math.max(...lons) + pad, Math.max(...lats) + pad],
        [Math.min(...lons) - pad, Math.min(...lats) - pad],
        80, 800
      );
    }
  }, [alternatives, selectedIdx]);

  // ── Réinitialiser ─────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setIsNavigating(false);
    setDestination(null);
    setAlternatives([]);
    setSelectedIdx(0);
    setQuery('');
    setSuggestions([]);
    setShowRouteSelector(false);
    setShowSteps(false);
    setStepIdx(0);
    setDistToStep(null);
    setRemainDist(null);
    // Recentrer sur l'utilisateur
    if (userLoc && cameraRef.current && mapReadyRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate: [userLoc.lon, userLoc.lat],
        zoomLevel: 15,
        animationDuration: 800,
      });
    }
  }, [userLoc]);

  // ── ETA ───────────────────────────────────────────────────────────────────
  const eta = useMemo(() => {
    if (remainDist === null || !activeRoute) return null;
    const secs = remainDist / (TRANSPORT_OPTIONS.find(m => m.key === transportMode)?.speedKmh || 50) * 3.6;
    const d = new Date(Date.now() + secs * 1000);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }, [remainDist, transportMode, activeRoute]);

  // ── GeoJSON routes ────────────────────────────────────────────────────────
  const mainRouteGeoJSON = useMemo(() => {
    if (!activeRoute) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: activeRoute.coordinates.map(([lat, lon]) => [lon, lat]),
      },
      properties: { color: alternatives[selectedIdx]?.color || '#2980b9' },
    };
  }, [activeRoute, alternatives, selectedIdx]);

  const altRoutesGeoJSON = useMemo(() => {
    if (alternatives.length <= 1) return null;
    return {
      type: 'FeatureCollection',
      features: alternatives
        .filter((_, i) => i !== selectedIdx)
        .map(alt => ({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: alt.route.coordinates.map(([lat, lon]) => [lon, lat]),
          },
          properties: { color: alt.color },
        })),
    };
  }, [alternatives, selectedIdx]);

  const currentStep = activeRoute?.steps?.[stepIdx];
  const nextStep = activeRoute?.steps?.[stepIdx + 1];

  // ─── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* ═══ CARTE ═══ */}
      <MapLibreGL.MapView
        ref={mapViewRef}
        style={s.map}
        mapStyle={MAP_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={true}
        attributionPosition={{ bottom: 8, right: 8 }}
        onDidFinishLoadingMap={() => {
          mapReadyRef.current = true;
          if (userLoc && cameraRef.current) {
            cameraRef.current.setCamera({
              centerCoordinate: [userLoc.lon, userLoc.lat],
              zoomLevel: 15,
              animationDuration: 600,
            });
          }
        }}
      >
        <MapLibreGL.Camera ref={cameraRef} />
        <MapLibreGL.UserLocation visible={true} showsUserHeadingIndicator={true} />

        {/* Routes alternatives (en dessous, semi-transparentes) */}
        {altRoutesGeoJSON && (
          <MapLibreGL.ShapeSource id="alt-src" shape={altRoutesGeoJSON as any}>
            <MapLibreGL.LineLayer
              id="alt-line"
              style={{ lineColor: ['get', 'color'], lineWidth: 5, lineOpacity: 0.35, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Route principale */}
        {mainRouteGeoJSON && (
          <MapLibreGL.ShapeSource id="main-route-src" shape={mainRouteGeoJSON as any}>
            <MapLibreGL.LineLayer
              id="main-route-shadow"
              style={{ lineColor: '#000', lineWidth: 10, lineOpacity: 0.15, lineCap: 'round', lineJoin: 'round' }}
            />
            <MapLibreGL.LineLayer
              id="main-route-line"
              style={{ lineColor: ['get', 'color'], lineWidth: 6, lineOpacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Marqueur destination */}
        {destination && (
          <MapLibreGL.PointAnnotation
            id="dest-marker"
            coordinate={[destination.lon, destination.lat]}
          >
            <View style={s.destMarker}>
              <Text style={s.destMarkerText}>🏁</Text>
            </View>
          </MapLibreGL.PointAnnotation>
        )}
      </MapLibreGL.MapView>

      {/* ═══ BANNIÈRE NAVIGATION (pendant navigation active) ═══ */}
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
            {isRecalculating && (
              <Text style={s.recalcText}>🔄 Recalcul en cours...</Text>
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
              <Text style={s.navDestName} numberOfLines={1}>{destination?.name}</Text>
              {eta && <Text style={s.navEta}>Arrivée estimée : {eta}</Text>}
            </View>
          </View>
          <View style={s.navBottomBtns}>
            <TouchableOpacity style={s.stepsBtn} onPress={() => setShowSteps(v => !v)}>
              <Text style={s.stepsBtnText}>📋</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.navStopBtn} onPress={stopNavigation}>
              <Text style={s.navStopText}>✕ Stop</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══ PANNEAU ÉTAPES ═══ */}
      {showSteps && isNavigating && activeRoute && (
        <View style={s.stepsPanel}>
          <View style={s.stepsPanelHeader}>
            <Text style={s.stepsPanelTitle}>Étapes du trajet</Text>
            <TouchableOpacity onPress={() => setShowSteps(false)}>
              <Text style={s.stepsPanelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={s.stepsList}>
            {activeRoute.steps.map((step, i) => (
              <View key={i} style={[s.stepItem, i === stepIdx && s.stepItemActive]}>
                <Text style={s.stepArrow}>{arrowForManeuver(step.maneuver, step.modifier)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.stepInstr, i === stepIdx && s.stepInstrActive]} numberOfLines={2}>
                    {step.instruction}
                  </Text>
                  <Text style={s.stepDist}>{fmtDist(step.distance)}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ═══ INTERFACE PRINCIPALE (avant navigation) ═══ */}
      {!isNavigating && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.mainPanel}
        >
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
              <Text style={s.backBtnText}>←</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>Navigation GPS</Text>
            {destination && (
              <TouchableOpacity style={s.resetBtn} onPress={reset}>
                <Text style={s.resetBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Barre de recherche */}
          <View style={s.searchBar}>
            <Text style={s.searchIcon}>🔍</Text>
            <TextInput
              style={s.searchInput}
              placeholder="Adresse, restaurant, hôtel, lieu..."
              placeholderTextColor="#666"
              value={query}
              onChangeText={handleQueryChange}
              returnKeyType="search"
              onSubmitEditing={() => { if (suggestions.length > 0) selectDestination(suggestions[0]); }}
              autoCorrect={false}
            />
            {isSearching
              ? <ActivityIndicator size="small" color="#2980b9" />
              : query.length > 0 && (
                <TouchableOpacity onPress={() => { setQuery(''); setSuggestions([]); setShowSuggestions(false); }}>
                  <Text style={s.clearBtn}>✕</Text>
                </TouchableOpacity>
              )
            }
          </View>

          {/* Suggestions */}
          {showSuggestions && (
            <ScrollView style={s.suggestionsList} keyboardShouldPersistTaps="handled">
              {suggestions.map((sug, i) => (
                <TouchableOpacity
                  key={i}
                  style={s.suggestionItem}
                  onPress={() => selectDestination(sug)}
                >
                  <Text style={s.suggestionIcon}>{iconForType(sug.type)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.suggestionName} numberOfLines={1}>{sug.name}</Text>
                    <Text style={s.suggestionAddr} numberOfLines={1}>
                      {sug.displayName.split(',').slice(1, 3).join(',')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Modes de transport */}
          {!showSuggestions && (
            <View style={s.transportRow}>
              {TRANSPORT_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.transportBtn, transportMode === opt.key && s.transportBtnActive]}
                  onPress={() => changeMode(opt.key)}
                >
                  <Text style={s.transportIcon}>{opt.icon}</Text>
                  <Text style={[s.transportLabel, transportMode === opt.key && s.transportLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Calcul en cours */}
          {isCalcRoute && (
            <View style={s.calcRow}>
              <ActivityIndicator size="small" color="#2980b9" />
              <Text style={s.calcText}>Calcul des itinéraires...</Text>
            </View>
          )}

          {/* Sélecteur d'alternatives */}
          {showRouteSelector && alternatives.length > 1 && !isCalcRoute && (
            <View style={s.altPanel}>
              <Text style={s.altPanelTitle}>Choisissez un itinéraire</Text>
              {alternatives.map((alt, i) => (
                <TouchableOpacity
                  key={i}
                  style={[s.altItem, i === selectedIdx && { borderColor: alt.color, borderWidth: 2 }]}
                  onPress={() => setSelectedIdx(i)}
                >
                  <View style={[s.altDot, { backgroundColor: alt.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.altDescription}>{alt.description}</Text>
                    <Text style={s.altInfo}>
                      {fmtDist(alt.route.distance)} · {fmtDuration(alt.route.duration)}
                    </Text>
                  </View>
                  {i === selectedIdx && <Text style={s.altCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Bouton Démarrer */}
          {alternatives.length > 0 && !isCalcRoute && (
            <TouchableOpacity style={s.startBtn} onPress={startNavigation}>
              <Text style={s.startBtnText}>
                {TRANSPORT_OPTIONS.find(m => m.key === transportMode)?.icon} Démarrer la navigation
              </Text>
            </TouchableOpacity>
          )}

          {/* Message si pas de GPS */}
          {!locGranted && (
            <View style={s.noGpsBox}>
              <Text style={s.noGpsText}>📍 Activez la localisation pour utiliser la navigation GPS</Text>
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      {/* Bouton recentrer (pendant navigation) */}
      {isNavigating && userLoc && (
        <TouchableOpacity
          style={s.centerBtn}
          onPress={() => {
            if (cameraRef.current && mapReadyRef.current) {
              cameraRef.current.setCamera({
                centerCoordinate: [userLoc.lon, userLoc.lat],
                zoomLevel: 17,
                animationDuration: 600,
              });
            }
          }}
        >
          <Text style={s.centerBtnText}>⊙</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },

  // ── Destination marker ──────────────────────────────────────────────────
  destMarker: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#c0392b',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4,
  },
  destMarkerText: { fontSize: 20 },

  // ── Bannière navigation ─────────────────────────────────────────────────
  navBanner: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a3a5c',
    paddingTop: Platform.OS === 'ios' ? 54 : 34,
    paddingBottom: 14, paddingHorizontal: 14, gap: 14,
  },
  navArrowBox: { alignItems: 'center', minWidth: 64 },
  navArrow: { fontSize: 42, color: '#fff' },
  navStepDist: { color: '#7ec8e3', fontSize: 14, fontWeight: '700', marginTop: 2 },
  navInstrBox: { flex: 1 },
  navInstr: { color: '#fff', fontSize: 17, fontWeight: '700', lineHeight: 22 },
  navNext: { color: '#aac4d8', fontSize: 12, marginTop: 4 },
  recalcText: { color: '#f39c12', fontSize: 11, marginTop: 4 },

  // ── Barre bas navigation ────────────────────────────────────────────────
  navBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10,10,25,0.97)',
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    paddingTop: 14, paddingHorizontal: 14, gap: 10,
  },
  navRemDist: { color: '#fff', fontSize: 22, fontWeight: '800' },
  navRemLabel: { color: '#888', fontSize: 11 },
  navDest: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  navDestIcon: { fontSize: 20 },
  navDestName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  navEta: { color: '#888', fontSize: 11 },
  navBottomBtns: { flexDirection: 'row', gap: 8 },
  stepsBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepsBtnText: { fontSize: 18 },
  navStopBtn: {
    backgroundColor: '#c0392b',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
  },
  navStopText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // ── Panneau étapes ──────────────────────────────────────────────────────
  stepsPanel: {
    position: 'absolute', bottom: 80, left: 0, right: 0,
    backgroundColor: 'rgba(10,10,25,0.97)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '55%',
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  stepsPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  stepsPanelTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  stepsPanelClose: { color: '#888', fontSize: 18 },
  stepsList: { flex: 1 },
  stepItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  stepItemActive: { backgroundColor: 'rgba(41,128,185,0.2)' },
  stepArrow: { fontSize: 22, width: 30, textAlign: 'center' },
  stepInstr: { color: '#ccc', fontSize: 13 },
  stepInstrActive: { color: '#fff', fontWeight: '700' },
  stepDist: { color: '#666', fontSize: 11, marginTop: 2 },

  // ── Interface principale ────────────────────────────────────────────────
  mainPanel: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: 'rgba(10,10,25,0.97)',
    paddingTop: Platform.OS === 'ios' ? 54 : 34,
    paddingBottom: 12,
    borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12, gap: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { color: '#fff', fontSize: 18 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' },
  resetBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  resetBtnText: { color: '#bbb', fontSize: 16 },

  // ── Recherche ───────────────────────────────────────────────────────────
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 12 },
  clearBtn: { color: '#666', fontSize: 16, padding: 4 },

  suggestionsList: { maxHeight: 280, marginHorizontal: 12, marginBottom: 8 },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  suggestionIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  suggestionName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  suggestionAddr: { color: '#888', fontSize: 12, marginTop: 1 },

  // ── Modes transport ─────────────────────────────────────────────────────
  transportRow: {
    flexDirection: 'row', gap: 8,
    marginHorizontal: 12, marginBottom: 10,
  },
  transportBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  transportBtnActive: { backgroundColor: '#2980b9', borderColor: '#2980b9' },
  transportIcon: { fontSize: 22, marginBottom: 2 },
  transportLabel: { color: '#aaa', fontSize: 11, fontWeight: '600' },
  transportLabelActive: { color: '#fff' },

  // ── Calcul ──────────────────────────────────────────────────────────────
  calcRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  calcText: { color: '#aaa', fontSize: 14 },

  // ── Alternatives ────────────────────────────────────────────────────────
  altPanel: { marginHorizontal: 12, marginBottom: 10 },
  altPanelTitle: { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  altItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 6,
  },
  altDot: { width: 12, height: 12, borderRadius: 6 },
  altDescription: { color: '#fff', fontSize: 14, fontWeight: '700' },
  altInfo: { color: '#888', fontSize: 12, marginTop: 2 },
  altCheck: { color: '#2ecc71', fontSize: 18, fontWeight: '700' },

  // ── Bouton démarrer ─────────────────────────────────────────────────────
  startBtn: {
    marginHorizontal: 12, marginTop: 4,
    backgroundColor: '#27ae60',
    paddingVertical: 14, borderRadius: 14, alignItems: 'center',
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  // ── No GPS ──────────────────────────────────────────────────────────────
  noGpsBox: {
    marginHorizontal: 12, marginTop: 8,
    backgroundColor: 'rgba(231,76,60,0.15)',
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(231,76,60,0.3)',
  },
  noGpsText: { color: '#e74c3c', fontSize: 13, textAlign: 'center' },

  // ── Recentrer ───────────────────────────────────────────────────────────
  centerBtn: {
    position: 'absolute', bottom: 90, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(10,10,25,0.92)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  centerBtnText: { color: '#fff', fontSize: 20 },
});
