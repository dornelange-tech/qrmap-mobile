import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Dimensions,
  Linking,
} from 'react-native';
import {
  MapView,
  Camera,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  LineLayer,
  OfflineManager,
  UserLocation,
  type CameraRef,
  type MapViewRef,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Itinerary, Day, Place } from '../types';
import { fetchItinerary, fetchRoute, formatDistance, formatDuration, formatDateShort } from '../utils/api';
import { saveItinerary, getItineraryBySlug, saveOfflinePack, getOfflinePack } from '../utils/storage';

// Style carte vectoriel OpenFreeMap (gratuit, sans clé API)
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Couleurs par jour
const DAY_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
  '#ff5722', '#607d8b',
];

type MapScreenRouteProp = RouteProp<RootStackParamList, 'Map'>;
type MapScreenNavProp = NativeStackNavigationProp<RootStackParamList, 'Map'>;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface RouteData {
  coordinates: [number, number][];
  distance: number;
  duration: number;
}

export default function MapScreen() {
  const navigation = useNavigation<MapScreenNavProp>();
  const route = useRoute<MapScreenRouteProp>();
  const { slug, itinerary: initialItinerary } = route.params;

  const [itinerary, setItinerary] = useState<Itinerary | null>(initialItinerary || null);
  const [loading, setLoading] = useState(!initialItinerary);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [navigationRoute, setNavigationRoute] = useState<RouteData | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [showDayPanel, setShowDayPanel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isOfflineReady, setIsOfflineReady] = useState(false);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);

  const cameraRef = useRef<CameraRef>(null);

  // Charger l'itinéraire
  useEffect(() => {
    if (!initialItinerary) {
      loadItinerary();
    } else {
      checkOfflineStatus();
    }
  }, [slug]);

  // Géolocalisation
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setUserLocation({
        lat: location.coords.latitude,
        lon: location.coords.longitude,
      });
    })();
  }, []);

  const loadItinerary = async () => {
    try {
      setLoading(true);
      const cached = await getItineraryBySlug(slug);
      if (cached) {
        setItinerary(cached);
        setLoading(false);
        checkOfflineStatus();
        fetchItinerary(slug).then(fresh => {
          setItinerary(fresh);
          saveItinerary(fresh);
        }).catch(() => {});
        return;
      }
      const data = await fetchItinerary(slug);
      setItinerary(data);
      await saveItinerary(data);
      checkOfflineStatus();
    } catch {
      Alert.alert(
        'Erreur de chargement',
        'Impossible de charger l\'itinéraire. Vérifiez votre connexion internet.',
        [{ text: 'Retour', onPress: () => navigation.goBack() }]
      );
    } finally {
      setLoading(false);
    }
  };

  const checkOfflineStatus = async () => {
    const pack = await getOfflinePack(slug);
    setIsOfflineReady(!!pack);
  };

  // Calculer la bounding box
  const getBounds = useCallback(() => {
    if (!itinerary) return null;
    const places = selectedDay
      ? itinerary.days.find(d => d.dayNumber === selectedDay)?.places || []
      : itinerary.days.flatMap(d => d.places);
    if (places.length === 0) return null;
    const lats = places.map(p => p.lat);
    const lons = places.map(p => p.lon);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    };
  }, [itinerary, selectedDay]);

  // Centrer la carte
  const fitBounds = useCallback(() => {
    const bounds = getBounds();
    if (!bounds || !cameraRef.current) return;
    const pad = 0.05;
    cameraRef.current.fitBounds(
      [bounds.maxLon + pad, bounds.maxLat + pad],
      [bounds.minLon - pad, bounds.minLat - pad],
      50,
      1000
    );
  }, [getBounds]);

  useEffect(() => {
    if (itinerary) setTimeout(fitBounds, 600);
  }, [itinerary, selectedDay]);

  // Télécharger les cartes offline
  const downloadOfflineMaps = async () => {
    if (!itinerary) return;
    const bounds = getBounds();
    if (!bounds) return;

    const pad = 0.5;
    const packName = `itinerary_${slug}`;

    try {
      setDownloadProgress(0);
      await OfflineManager.createPack(
        {
          name: packName,
          styleURL: MAP_STYLE_URL,
          minZoom: 5,
          maxZoom: 16,
          bounds: [
            [bounds.minLon - pad, bounds.minLat - pad],
            [bounds.maxLon + pad, bounds.maxLat + pad],
          ],
        },
        (pack, status) => {
          const pct = (status as any).percentage ?? 0;
          setDownloadProgress(pct);
          if ((status as any).state === 'complete' || pct >= 100) {
            setDownloadProgress(null);
            setIsOfflineReady(true);
            saveOfflinePack(slug, packName, itinerary.title);
            Alert.alert('✅ Carte disponible offline', 'La carte est téléchargée. Vous pouvez l\'utiliser sans connexion.');
          }
        },
        (_pack, error) => {
          setDownloadProgress(null);
          console.warn('Offline pack error:', error);
          Alert.alert('Info', 'Téléchargement partiel. La carte sera disponible pour les zones visitées.');
        }
      );
    } catch (err) {
      setDownloadProgress(null);
      Alert.alert('Erreur', 'Impossible de télécharger la carte offline.');
    }
  };

  // Naviguer vers un lieu
  const navigateToPlace = async (place: Place) => {
    if (!userLocation) {
      Alert.alert('GPS requis', 'Activez la localisation pour naviguer vers ce lieu.');
      return;
    }
    setIsCalculatingRoute(true);
    try {
      const routeData = await fetchRoute(
        userLocation.lat, userLocation.lon,
        place.lat, place.lon
      );
      setNavigationRoute(routeData);
      setSelectedPlace(null);
      // Centrer sur la route
      if (cameraRef.current) {
        const allLats = [userLocation.lat, place.lat, ...routeData.coordinates.map(c => c[0])];
        const allLons = [userLocation.lon, place.lon, ...routeData.coordinates.map(c => c[1])];
        cameraRef.current.fitBounds(
          [Math.max(...allLons) + 0.01, Math.max(...allLats) + 0.01],
          [Math.min(...allLons) - 0.01, Math.min(...allLats) - 0.01],
          80,
          1000
        );
      }
    } catch {
      // Fallback app native
      const url = Platform.OS === 'ios'
        ? `maps://?daddr=${place.lat},${place.lon}&dirflg=d`
        : `google.navigation:q=${place.lat},${place.lon}`;
      Linking.openURL(url).catch(() => {
        Alert.alert('Navigation', `Coordonnées :\n${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`);
      });
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  // Ouvrir dans Organic Maps
  const openInOrganicMaps = (place: Place) => {
    const url = `om://map?v=1&ll=${place.lat},${place.lon}&n=${encodeURIComponent(place.name)}&z=16`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://maps.google.com/?q=${place.lat},${place.lon}`);
    });
  };

  // GeoJSON des marqueurs
  const markersGeoJSON = useCallback(() => {
    if (!itinerary) return { type: 'FeatureCollection', features: [] as any[] };
    const days = selectedDay
      ? itinerary.days.filter(d => d.dayNumber === selectedDay)
      : itinerary.days;
    const features = days.flatMap(day =>
      day.places.map((place, idx) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
        properties: {
          id: place.id,
          name: place.name,
          description: place.description || '',
          dayNumber: day.dayNumber,
          orderIndex: idx + 1,
          color: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length],
          label: String(idx + 1),
        },
      }))
    );
    return { type: 'FeatureCollection', features };
  }, [itinerary, selectedDay]);

  // GeoJSON de la route
  const routeGeoJSON = useCallback(() => {
    if (!navigationRoute) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: navigationRoute.coordinates.map(([lat, lon]) => [lon, lat]),
      },
      properties: {},
    };
  }, [navigationRoute]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f39c12" />
        <Text style={styles.loadingText}>Chargement de l'itinéraire...</Text>
      </View>
    );
  }

  if (!itinerary) return null;

  const activeDays = selectedDay
    ? itinerary.days.filter(d => d.dayNumber === selectedDay)
    : itinerary.days;

  const markers = markersGeoJSON();
  const routeLine = routeGeoJSON();

  return (
    <View style={styles.container}>
      {/* Carte MapLibre */}
      <MapView
        style={styles.map}
        mapStyle={MAP_STYLE_URL}
        logoEnabled={false}
        attributionEnabled={true}
        attributionPosition={{ bottom: 8, right: 8 }}
        onPress={() => {
          setSelectedPlace(null);
        }}
      >
        <Camera ref={cameraRef} />

        {/* Position utilisateur */}
        <UserLocation visible={true} showsUserHeadingIndicator={true} />

        {/* Ligne de navigation */}
        {routeLine && (
          <ShapeSource id="route-source" shape={routeLine as any}>
            <LineLayer
              id="route-line"
              style={{
                lineColor: '#3498db',
                lineWidth: 5,
                lineOpacity: 0.85,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Marqueurs des lieux */}
        <ShapeSource
          id="markers-source"
          shape={markers as any}
          onPress={(e: any) => {
            const feature = e?.features?.[0];
            if (!feature?.properties) return;
            const props = feature.properties;
            const day = itinerary.days.find(d => d.dayNumber === props.dayNumber);
            const place = day?.places.find(p => p.id === props.id);
            if (place) setSelectedPlace(place);
          }}
        >
          <CircleLayer
            id="marker-circle"
            style={{
              circleRadius: 18,
              circleColor: ['get', 'color'],
              circleStrokeWidth: 2,
              circleStrokeColor: '#ffffff',
            }}
          />
          <SymbolLayer
            id="marker-label"
            style={{
              textField: ['get', 'label'],
              textSize: 12,
              textColor: '#ffffff',
              textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
              textAllowOverlap: true,
            }}
          />
        </ShapeSource>
      </MapView>

      {/* En-tête */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{itinerary.title}</Text>
        <TouchableOpacity
          style={[styles.offlineButton, isOfflineReady && styles.offlineButtonReady]}
          onPress={downloadProgress !== null ? undefined : downloadOfflineMaps}
        >
          {downloadProgress !== null ? (
            <Text style={styles.offlineButtonText}>{Math.round(downloadProgress)}%</Text>
          ) : (
            <Text style={styles.offlineButtonText}>{isOfflineReady ? '✓ Offline' : '⬇ Offline'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Filtres par jour */}
      <View style={styles.dayFilters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayFiltersContent}>
          <TouchableOpacity
            style={[styles.dayButton, selectedDay === null && styles.dayButtonActive]}
            onPress={() => setSelectedDay(null)}
          >
            <Text style={[styles.dayButtonText, selectedDay === null && styles.dayButtonTextActive]}>Tous</Text>
          </TouchableOpacity>
          {itinerary.days.map(day => (
            <TouchableOpacity
              key={day.id}
              style={[
                styles.dayButton,
                selectedDay === day.dayNumber && styles.dayButtonActive,
                { borderColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] },
              ]}
              onPress={() => setSelectedDay(day.dayNumber === selectedDay ? null : day.dayNumber)}
            >
              <Text style={[styles.dayButtonText, selectedDay === day.dayNumber && styles.dayButtonTextActive]}>
                J{day.dayNumber}
              </Text>
              {day.date && (
                <Text style={styles.dayButtonDate}>{formatDateShort(day.date)}</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Popup lieu sélectionné */}
      {selectedPlace && (
        <View style={styles.placePopup}>
          <View style={styles.placePopupHeader}>
            <Text style={styles.placePopupName}>{selectedPlace.name}</Text>
            <TouchableOpacity onPress={() => setSelectedPlace(null)}>
              <Text style={styles.placePopupClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {!!selectedPlace.description && (
            <Text style={styles.placePopupDesc} numberOfLines={2}>{selectedPlace.description}</Text>
          )}
          <View style={styles.placePopupActions}>
            <TouchableOpacity
              style={[styles.placeActionButton, styles.placeActionNavigate]}
              onPress={() => navigateToPlace(selectedPlace)}
              disabled={isCalculatingRoute}
            >
              {isCalculatingRoute
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.placeActionText}>🧭 Naviguer</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.placeActionButton, styles.placeActionMaps]}
              onPress={() => openInOrganicMaps(selectedPlace)}
            >
              <Text style={styles.placeActionText}>🗺 Organic Maps</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Info route active */}
      {navigationRoute && !selectedPlace && (
        <View style={styles.routeInfo}>
          <Text style={styles.routeInfoText}>
            📍 {formatDistance(navigationRoute.distance)} · {formatDuration(navigationRoute.duration)}
          </Text>
          <TouchableOpacity onPress={() => setNavigationRoute(null)}>
            <Text style={styles.routeInfoClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Boutons flottants */}
      <TouchableOpacity style={styles.listButton} onPress={() => setShowDayPanel(!showDayPanel)}>
        <Text style={styles.listButtonText}>{showDayPanel ? '✕' : '☰ Lieux'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.centerButton} onPress={fitBounds}>
        <Text style={styles.centerButtonText}>⊙</Text>
      </TouchableOpacity>

      {/* Panneau liste */}
      {showDayPanel && (
        <View style={styles.dayPanel}>
          <ScrollView>
            {activeDays.map(day => (
              <View key={day.id}>
                <View style={[styles.dayPanelHeader, { borderLeftColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] }]}>
                  <Text style={styles.dayPanelTitle}>Jour {day.dayNumber} — {day.title}</Text>
                  {day.date && <Text style={styles.dayPanelDate}>{formatDateShort(day.date)}</Text>}
                </View>
                {day.places.map((place, idx) => (
                  <TouchableOpacity
                    key={place.id}
                    style={styles.placeItem}
                    onPress={() => {
                      setSelectedPlace(place);
                      setShowDayPanel(false);
                      cameraRef.current?.setCamera({
                        centerCoordinate: [place.lon, place.lat],
                        zoomLevel: 15,
                        animationDuration: 800,
                      });
                    }}
                  >
                    <View style={[styles.placeItemBadge, { backgroundColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] }]}>
                      <Text style={styles.placeItemBadgeText}>{idx + 1}</Text>
                    </View>
                    <View style={styles.placeItemContent}>
                      <Text style={styles.placeItemName}>{place.name}</Text>
                      {!!place.description && (
                        <Text style={styles.placeItemDesc} numberOfLines={1}>{place.description}</Text>
                      )}
                    </View>
                    <Text style={styles.placeItemArrow}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  loadingText: { color: '#f39c12', marginTop: 16, fontSize: 16 },

  header: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,26,46,0.93)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  backButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  backButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  offlineButton: {
    backgroundColor: 'rgba(243,156,18,0.2)',
    borderWidth: 1, borderColor: '#f39c12',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  offlineButtonReady: { backgroundColor: 'rgba(46,204,113,0.2)', borderColor: '#2ecc71' },
  offlineButtonText: { color: '#f39c12', fontSize: 12, fontWeight: '600' },

  dayFilters: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 90,
    left: 0, right: 0,
  },
  dayFiltersContent: { paddingHorizontal: 12, gap: 8 },
  dayButton: {
    backgroundColor: 'rgba(26,26,46,0.9)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', minWidth: 52,
  },
  dayButtonActive: { backgroundColor: '#f39c12', borderColor: '#f39c12' },
  dayButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  dayButtonTextActive: { color: '#1a1a2e' },
  dayButtonDate: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 1 },

  placePopup: {
    position: 'absolute', bottom: 100, left: 12, right: 12,
    backgroundColor: 'rgba(26,26,46,0.97)',
    borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  placePopupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  placePopupName: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, marginRight: 8 },
  placePopupClose: { color: 'rgba(255,255,255,0.5)', fontSize: 20, padding: 4 },
  placePopupDesc: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 12 },
  placePopupActions: { flexDirection: 'row', gap: 10 },
  placeActionButton: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  placeActionNavigate: { backgroundColor: '#3498db' },
  placeActionMaps: { backgroundColor: '#2ecc71' },
  placeActionText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  routeInfo: {
    position: 'absolute', bottom: 100, left: 12, right: 12,
    backgroundColor: 'rgba(52,152,219,0.95)',
    borderRadius: 12, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  routeInfoText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  routeInfoClose: { color: 'rgba(255,255,255,0.8)', fontSize: 20, padding: 4 },

  listButton: {
    position: 'absolute', bottom: 40, left: 12,
    backgroundColor: 'rgba(26,26,46,0.95)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  listButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  centerButton: {
    position: 'absolute', bottom: 40, right: 12,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(26,26,46,0.95)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  centerButtonText: { color: '#fff', fontSize: 22 },

  dayPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: SCREEN_HEIGHT * 0.55,
    backgroundColor: 'rgba(26,26,46,0.98)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 12,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  dayPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderLeftWidth: 4, marginLeft: 8, marginBottom: 4,
  },
  dayPanelTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  dayPanelDate: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  placeItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  placeItemBadge: {
    width: 30, height: 30, borderRadius: 15,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  placeItemBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  placeItemContent: { flex: 1 },
  placeItemName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  placeItemDesc: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  placeItemArrow: { color: 'rgba(255,255,255,0.3)', fontSize: 20, marginLeft: 8 },
});
