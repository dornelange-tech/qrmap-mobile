# QRMap Voyage — Application Mobile

Application mobile native iOS et Android pour consulter des itinéraires de voyage interactifs, avec cartes offline, scanner QR et navigation GPS.

## Fonctionnalités

- **Scanner QR code** : scannez le QR code de votre guide de voyage pour charger l'itinéraire
- **Carte détaillée** : carte OpenStreetMap avec rues, restaurants et points d'intérêt
- **Mode offline** : téléchargez la carte du pays pour l'utiliser sans connexion
- **Navigation GPS** : calculez un itinéraire depuis votre position vers n'importe quel lieu
- **Organic Maps** : ouvrez directement un lieu dans Organic Maps
- **Itinéraires sauvegardés** : retrouvez vos voyages passés sans rescanner

## Architecture

```
App.tsx                 ← Point d'entrée, navigation
src/
  screens/
    HomeScreen.tsx      ← Accueil : liste des itinéraires + bouton scanner
    ScannerScreen.tsx   ← Scanner QR code avec expo-camera
    MapScreen.tsx       ← Carte interactive MapLibre + navigation GPS
  utils/
    api.ts              ← Appels API qrmap.site + OSRM routing
    storage.ts          ← Stockage local AsyncStorage
  types/
    index.ts            ← Types TypeScript partagés
```

## Backend

L'application utilise le backend **qrmap.site** :
- `GET https://www.qrmap.site/api/itinerary/:slug` — données de l'itinéraire
- `GET https://router.project-osrm.org/route/v1/driving/...` — calcul d'itinéraire GPS (gratuit)

## Installation et développement

### Prérequis

- Node.js 18+
- Expo CLI : `npm install -g expo-cli`
- EAS CLI : `npm install -g eas-cli`
- Android Studio (pour Android) ou Xcode (pour iOS)

### Démarrer en développement

```bash
cd qrmap-mobile
npm install
npx expo start
```

Puis scanner le QR code avec **Expo Go** sur votre téléphone.

### Build APK Android (sans compte développeur)

```bash
# Option 1 : Build cloud EAS (gratuit pour Android)
npx eas-cli build --platform android --profile preview

# Option 2 : Build local (nécessite Android Studio)
npx expo run:android --variant release
```

### Build iOS (nécessite un compte Apple Developer à $99/an)

```bash
npx eas-cli build --platform ios --profile preview
```

## Cartes offline

L'application utilise **MapLibre React Native** avec le style vectoriel [OpenFreeMap](https://openfreemap.org/) (gratuit, sans clé API).

Le téléchargement offline utilise `OfflineManager.createPack()` de MapLibre :
- Zoom 5–16 pour la zone de l'itinéraire + 50km de marge
- Stockage dans la base de données MapLibre native (iOS : ~200MB max, Android : illimité)

## Navigation GPS

L'itinéraire de navigation est calculé via **OSRM** (Open Source Routing Machine) :
- Endpoint : `https://router.project-osrm.org/route/v1/driving/`
- Gratuit, basé sur OpenStreetMap
- Affichage de la ligne de route sur la carte + distance + durée

## Déploiement App Store / Play Store

### Android (Google Play)

1. Créer un compte Google Play Developer ($25 unique)
2. `npx eas-cli build --platform android --profile production`
3. Soumettre l'AAB via Google Play Console

### iOS (App Store)

1. Créer un compte Apple Developer ($99/an)
2. `npx eas-cli build --platform ios --profile production`
3. Soumettre via App Store Connect

## Technologies

| Composant | Technologie |
|---|---|
| Framework | Expo SDK 52 + React Native 0.76 |
| Carte | MapLibre React Native v10 |
| Style carte | OpenFreeMap Liberty (vectoriel gratuit) |
| Scanner QR | expo-camera v16 |
| GPS | expo-location |
| Navigation | OSRM (gratuit) |
| Stockage | AsyncStorage |
| Navigation app | React Navigation v6 |
