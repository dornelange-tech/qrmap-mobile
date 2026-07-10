# CONTEXT.md — QRMap Voyage Mobile

Dernière mise à jour : 10 juillet 2026

---

## État actuel

| Élément | Valeur |
|---|---|
| Version App Store | **1.2.0** (en cours de review Apple) |
| Version précédente live | 1.1.0 |
| Build number | 7 |
| Commit GitHub HEAD | `7412e5a` |
| Plateforme | iOS (App Store) + Android (Play Store) |

---

## Historique des versions

| Version | Build | Statut | Contenu |
|---|---|---|---|
| 1.0.0 | 1 | Live | Version initiale |
| 1.1.0 | 3 | Live (App Store) | NavigationScreen GPS complet |
| 1.2.0 | 7 | En attente review Apple | Fix crash navigation GPS + versions corrigées |

---

## Corrections apportées en 1.2.0

### Bug TypeScript — crash au lancement de NavigationScreen
- **Fichier** : `src/types/index.ts`
- **Problème** : `Navigation: { destination: Place; itinerary: Itinerary }` — params obligatoires non fournis
- **Fix** : `Navigation: undefined`

### Cast `(as any)` supprimé
- **Fichier** : `src/screens/MapScreen.tsx`
- **Avant** : `(navigation as any).navigate('Navigation')`
- **Après** : `navigation.navigate('Navigation')`

### Versions natives corrigées
- **Fichier** : `ios/QRMapVoyage/Info.plist`
  - `CFBundleShortVersionString` : `1.1.0` → `1.2.0`
  - `CFBundleVersion` : `4` → `7`
- **Fichier** : `ios/QRMapVoyage.xcodeproj/project.pbxproj`
  - `MARKETING_VERSION` : `1.1` → `1.2.0`
  - `CURRENT_PROJECT_VERSION` : `5` → `6`
- **Fichier** : `eas.json`
  - `appVersionSource` : `remote` → `local`

---

## Architecture des fichiers clés

```
App.tsx                          ← Navigation stack (Home, Scanner, Map, DayDetail, Navigation)
src/
  screens/
    HomeScreen.tsx               ← Accueil : liste itinéraires + scanner
    ScannerScreen.tsx            ← Scanner QR code
    MapScreen.tsx                ← Carte MapLibre + bouton 🧭 → NavigationScreen
    NavigationScreen.tsx         ← GPS turn-by-turn (autonome, sans params)
    DayDetailScreen.tsx          ← Détail d'une journée
  types/
    index.ts                     ← RootStackParamList + types partagés
  utils/
    api.ts                       ← API qrmap.site + OSRM routing
    storage.ts                   ← AsyncStorage
ios/
  QRMapVoyage/Info.plist         ← CFBundleShortVersionString + CFBundleVersion
  QRMapVoyage.xcodeproj/
    project.pbxproj              ← MARKETING_VERSION + CURRENT_PROJECT_VERSION
eas.json                         ← appVersionSource: local (IMPORTANT — ne pas changer en remote)
app.json                         ← version: 1.2.0
```

---

## Fonctionnalités NavigationScreen (v1.1.0+)

- 🔍 Recherche d'adresse via Nominatim (OpenStreetMap, gratuit)
- 🚶 🚴 🚗 3 modes de transport : pied / vélo / voiture
- 🗺 Jusqu'à 3 itinéraires alternatifs avec distance et durée
- 📋 Instructions turn-by-turn en français avec flèches directionnelles
- 🔄 Recalcul automatique si déviation > 80m
- ⊙ Bouton recentrer sur position GPS pendant la navigation
- Routage via OSRM (gratuit, basé OpenStreetMap)

---

## Règles importantes pour les prochains builds

### Ne jamais changer `appVersionSource` en `remote`
Le fichier `eas.json` doit toujours avoir `"appVersionSource": "local"`. Si cette valeur passe à `remote`, EAS ignore les fichiers natifs et utilise sa propre version distante, causant des rejets Apple.

### Toujours bumper les 3 endroits pour une nouvelle version
Pour chaque nouvelle version, mettre à jour :
1. `app.json` → `"version"`
2. `ios/QRMapVoyage/Info.plist` → `CFBundleShortVersionString` + `CFBundleVersion`
3. `ios/QRMapVoyage.xcodeproj/project.pbxproj` → `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`

### Toujours faire `git reset --hard origin/main` avant un build EAS
Pour éviter que EAS compile un ancien commit local, toujours synchroniser avec GitHub avant de lancer `eas build`.

---

## Backend

- API itinéraires : `https://www.qrmap.site/api/itinerary/:slug`
- Routage GPS : `https://router.project-osrm.org/route/v1/`
- Geocoding : `https://nominatim.openstreetmap.org/search`
- Cartes : OpenFreeMap (vectoriel, gratuit, sans clé API)

---

## Commandes utiles

```bash
# Synchroniser avec GitHub avant tout build
git fetch origin && git reset --hard origin/main

# Build iOS production
eas build --platform ios --profile production --clear-cache

# Vérifier le dernier build
eas build:list --platform ios --limit 3

# Soumettre le dernier build à Apple
eas submit --platform ios --latest

# Vérifier les versions dans les fichiers natifs
grep "MARKETING_VERSION" ios/QRMapVoyage.xcodeproj/project.pbxproj
grep -A1 "CFBundleShortVersionString" ios/QRMapVoyage/Info.plist
grep "appVersionSource" eas.json
```
