import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Itinerary } from '../types';
import { getSavedItineraries, deleteItinerary, getRecentSlug } from '../utils/storage';
import { fetchItinerary } from '../utils/api';

type HomeNavProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Couleurs par jour (pour les badges)
const DAY_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63',
];

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavProp>();
  const [savedItineraries, setSavedItineraries] = useState<Itinerary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Recharger à chaque fois que l'écran est affiché
  useFocusEffect(
    useCallback(() => {
      loadSavedItineraries();
    }, [])
  );

  const loadSavedItineraries = async () => {
    const itineraries = await getSavedItineraries();
    setSavedItineraries(itineraries);
    setLoading(false);
    setRefreshing(false);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadSavedItineraries();
  };

  const openItinerary = (itinerary: Itinerary) => {
    navigation.navigate('Map', { slug: itinerary.slug, itinerary });
  };

  const confirmDelete = (itinerary: Itinerary) => {
    Alert.alert(
      'Supprimer l\'itinéraire',
      `Voulez-vous supprimer "${itinerary.title}" de vos itinéraires sauvegardés ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deleteItinerary(itinerary.slug);
            loadSavedItineraries();
          },
        },
      ]
    );
  };

  const getTotalPlaces = (itinerary: Itinerary) => {
    return itinerary.days.reduce((sum, day) => sum + day.places.length, 0);
  };

  const getCountryEmoji = (title: string): string => {
    const lower = title.toLowerCase();
    if (lower.includes('cambodge') || lower.includes('cambodia')) return '🇰🇭';
    if (lower.includes('france') || lower.includes('paris')) return '🇫🇷';
    if (lower.includes('japon') || lower.includes('japan')) return '🇯🇵';
    if (lower.includes('italie') || lower.includes('italy')) return '🇮🇹';
    if (lower.includes('espagne') || lower.includes('spain')) return '🇪🇸';
    if (lower.includes('thaïlande') || lower.includes('thailand')) return '🇹🇭';
    if (lower.includes('vietnam')) return '🇻🇳';
    if (lower.includes('maroc') || lower.includes('morocco')) return '🇲🇦';
    if (lower.includes('grèce') || lower.includes('greece')) return '🇬🇷';
    if (lower.includes('portugal')) return '🇵🇹';
    return '🌍';
  };

  return (
    <View style={styles.container}>
      {/* En-tête */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSubtitle}>Bienvenue sur</Text>
          <Text style={styles.headerTitle}>QRMap Voyage</Text>
        </View>
        <View style={styles.headerIcon}>
          <Text style={styles.headerIconText}>🗺</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#f39c12"
            colors={['#f39c12']}
          />
        }
      >
        {/* Bouton principal : Scanner */}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => navigation.navigate('Scanner')}
          activeOpacity={0.85}
        >
          <View style={styles.scanButtonIcon}>
            <Text style={styles.scanButtonIconText}>📷</Text>
          </View>
          <View style={styles.scanButtonContent}>
            <Text style={styles.scanButtonTitle}>Scanner un QR code</Text>
            <Text style={styles.scanButtonSubtitle}>
              Scannez le QR code de votre guide de voyage
            </Text>
          </View>
          <Text style={styles.scanButtonArrow}>›</Text>
        </TouchableOpacity>

        {/* Section itinéraires sauvegardés */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {savedItineraries.length > 0 ? 'Mes itinéraires' : 'Aucun itinéraire'}
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color="#f39c12" style={{ marginTop: 32 }} />
          ) : savedItineraries.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>✈️</Text>
              <Text style={styles.emptyStateTitle}>Prêt pour l'aventure ?</Text>
              <Text style={styles.emptyStateText}>
                Scannez le QR code de votre guide de voyage pour charger votre itinéraire et l'utiliser hors ligne.
              </Text>
            </View>
          ) : (
            savedItineraries.map(itinerary => (
              <TouchableOpacity
                key={itinerary.slug}
                style={styles.itineraryCard}
                onPress={() => openItinerary(itinerary)}
                onLongPress={() => confirmDelete(itinerary)}
                activeOpacity={0.8}
              >
                <View style={styles.itineraryCardLeft}>
                  <Text style={styles.itineraryEmoji}>{getCountryEmoji(itinerary.title)}</Text>
                </View>
                <View style={styles.itineraryCardContent}>
                  <Text style={styles.itineraryTitle} numberOfLines={2}>{itinerary.title}</Text>
                  <View style={styles.itineraryMeta}>
                    <Text style={styles.itineraryMetaText}>
                      {itinerary.days.length} jours · {getTotalPlaces(itinerary)} lieux
                    </Text>
                    {itinerary.startDate && (
                      <Text style={styles.itineraryMetaDate}>
                        {new Date(itinerary.startDate + 'T00:00:00').toLocaleDateString('fr-FR', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </Text>
                    )}
                  </View>
                  {/* Badges jours */}
                  <View style={styles.dayBadges}>
                    {itinerary.days.slice(0, 8).map(day => (
                      <View
                        key={day.id}
                        style={[
                          styles.dayBadge,
                          { backgroundColor: DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length] },
                        ]}
                      >
                        <Text style={styles.dayBadgeText}>J{day.dayNumber}</Text>
                      </View>
                    ))}
                    {itinerary.days.length > 8 && (
                      <Text style={styles.dayBadgeMore}>+{itinerary.days.length - 8}</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.itineraryArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Aide */}
        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>Comment ça marche ?</Text>
          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>1</Text>
            <Text style={styles.helpStepText}>
              Votre guide vous envoie un QR code ou un lien qrmap.site
            </Text>
          </View>
          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>2</Text>
            <Text style={styles.helpStepText}>
              Scannez le QR code avec cette application
            </Text>
          </View>
          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>3</Text>
            <Text style={styles.helpStepText}>
              Votre itinéraire s'affiche sur la carte, même sans connexion
            </Text>
          </View>
          <View style={styles.helpStep}>
            <Text style={styles.helpStepNumber}>4</Text>
            <Text style={styles.helpStepText}>
              Appuyez sur un lieu pour naviguer depuis votre position GPS
            </Text>
          </View>
        </View>

        {/* Pied de page */}
        <Text style={styles.footer}>qrmap.site · Cartes OpenStreetMap</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },

  // En-tête
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 20,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(243,156,18,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(243,156,18,0.3)',
  },
  headerIconText: { fontSize: 26 },

  // Scroll
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // Bouton scan principal
  scanButton: {
    margin: 16,
    backgroundColor: '#f39c12',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#f39c12',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  scanButtonIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  scanButtonIconText: { fontSize: 26 },
  scanButtonContent: { flex: 1 },
  scanButtonTitle: {
    color: '#1a1a2e',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  scanButtonSubtitle: {
    color: 'rgba(26,26,46,0.7)',
    fontSize: 13,
    lineHeight: 18,
  },
  scanButtonArrow: {
    color: 'rgba(26,26,46,0.5)',
    fontSize: 28,
    fontWeight: '300',
    marginLeft: 8,
  },

  // Section
  section: { paddingHorizontal: 16, marginTop: 8 },
  sectionTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 8,
  },

  // État vide
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyStateIcon: { fontSize: 56, marginBottom: 16 },
  emptyStateTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyStateText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },

  // Carte itinéraire
  itineraryCard: {
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  itineraryCardLeft: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(243,156,18,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  itineraryEmoji: { fontSize: 28 },
  itineraryCardContent: { flex: 1 },
  itineraryTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  itineraryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  itineraryMetaText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  itineraryMetaDate: {
    color: '#f39c12',
    fontSize: 12,
    fontWeight: '600',
  },
  dayBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dayBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dayBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  dayBadgeMore: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    alignSelf: 'center',
  },
  itineraryArrow: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 24,
    marginLeft: 8,
  },

  // Aide
  helpSection: {
    margin: 16,
    marginTop: 24,
    backgroundColor: '#16213e',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  helpTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  helpStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  helpStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(243,156,18,0.15)',
    color: '#f39c12',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
    marginRight: 12,
    overflow: 'hidden',
  },
  helpStepText: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    lineHeight: 20,
  },

  // Pied de page
  footer: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
});
