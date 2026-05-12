import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Vibration,
  Platform,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { fetchItinerary, extractSlugFromUrl } from '../utils/api';
import { saveItinerary } from '../utils/storage';

type ScannerNavProp = NativeStackNavigationProp<RootStackParamList, 'Scanner'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_BOX_SIZE = SCREEN_WIDTH * 0.7;

export default function ScannerScreen() {
  const navigation = useNavigation<ScannerNavProp>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const lastScannedRef = useRef<string>('');

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    // Éviter les scans multiples
    if (scanned || loading || data === lastScannedRef.current) return;
    lastScannedRef.current = data;
    setScanned(true);

    // Vibration de confirmation
    Vibration.vibrate(100);

    // Extraire le slug depuis l'URL ou le QR code
    const slug = extractSlugFromUrl(data);

    if (!slug) {
      Alert.alert(
        'QR code non reconnu',
        'Ce QR code ne correspond pas à un itinéraire QRMap.\n\nAssurez-vous de scanner un QR code depuis qrmap.site',
        [
          {
            text: 'Réessayer',
            onPress: () => {
              setScanned(false);
              lastScannedRef.current = '';
            },
          },
        ]
      );
      return;
    }

    // Charger l'itinéraire
    setLoading(true);
    setLoadingText('Chargement de l\'itinéraire...');

    try {
      const itinerary = await fetchItinerary(slug);
      setLoadingText('Sauvegarde locale...');
      await saveItinerary(itinerary);

      // Naviguer vers la carte
      navigation.replace('Map', { slug, itinerary });
    } catch (error: any) {
      Alert.alert(
        'Erreur de chargement',
        'Impossible de charger l\'itinéraire. Vérifiez votre connexion internet.',
        [
          {
            text: 'Réessayer',
            onPress: () => {
              setScanned(false);
              setLoading(false);
              lastScannedRef.current = '';
            },
          },
          { text: 'Annuler', onPress: () => navigation.goBack() },
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#f39c12" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionTitle}>📷 Accès caméra requis</Text>
        <Text style={styles.permissionText}>
          L'application a besoin d'accéder à votre caméra pour scanner les QR codes des itinéraires.
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Autoriser la caméra</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
          <Text style={styles.backLinkText}>← Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Caméra */}
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned || loading ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
      />

      {/* Overlay sombre */}
      <View style={styles.overlay}>
        {/* Zone de scan */}
        <View style={styles.scanArea}>
          {/* Coins du cadre */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />

          {/* Ligne de scan animée */}
          {!loading && !scanned && (
            <View style={styles.scanLine} />
          )}
        </View>
      </View>

      {/* En-tête */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scanner un QR code</Text>
      </View>

      {/* Instructions */}
      <View style={styles.instructions}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#f39c12" />
            <Text style={styles.loadingText}>{loadingText}</Text>
          </View>
        ) : scanned ? (
          <View style={styles.loadingBox}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.loadingText}>QR code détecté !</Text>
          </View>
        ) : (
          <>
            <Text style={styles.instructionTitle}>Pointez vers le QR code</Text>
            <Text style={styles.instructionText}>
              Scannez le QR code de votre itinéraire de voyage depuis qrmap.site
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Zone de scan
  scanArea: {
    width: SCAN_BOX_SIZE,
    height: SCAN_BOX_SIZE,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#f39c12',
    borderWidth: 3,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2,
    backgroundColor: '#f39c12',
    opacity: 0.8,
  },

  // En-tête
  header: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  backButtonText: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // Instructions
  instructions: {
    position: 'absolute',
    bottom: 60,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  instructionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  instructionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingBox: {
    backgroundColor: 'rgba(26,26,46,0.95)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '100%',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 12,
    fontWeight: '600',
  },
  successIcon: {
    fontSize: 40,
    color: '#2ecc71',
  },

  // Permission
  permissionTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  permissionText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 32,
    marginBottom: 32,
  },
  permissionButton: {
    backgroundColor: '#f39c12',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 16,
    marginBottom: 16,
  },
  permissionButtonText: { color: '#1a1a2e', fontSize: 16, fontWeight: '700' },
  backLink: { padding: 12 },
  backLinkText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },
});
