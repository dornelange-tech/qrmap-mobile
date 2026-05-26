#!/bin/bash

# ============================================================
#  QRMap Voyage — Script d'installation iOS automatique
#  Double-cliquez sur ce fichier ou lancez-le dans le terminal
# ============================================================

set -e

PROJECT_DIR="$HOME/Documents/qrmap-mobile"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   QRMap Voyage — Installation iOS            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1. Vérifier que le dossier existe
if [ ! -d "$PROJECT_DIR" ]; then
  echo "❌ Dossier non trouvé : $PROJECT_DIR"
  echo "   Vérifiez que le projet est bien dans ~/Documents/qrmap-mobile"
  read -p "Appuyez sur Entrée pour quitter..."
  exit 1
fi

cd "$PROJECT_DIR"
echo "✅ Dossier trouvé : $PROJECT_DIR"
echo ""

# 2. Vérifier Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js n'est pas installé."
  echo "   Installez-le depuis https://nodejs.org puis relancez ce script."
  read -p "Appuyez sur Entrée pour quitter..."
  exit 1
fi
echo "✅ Node.js $(node --version) détecté"

# 3. Nettoyer le cache npm corrompu
echo ""
echo "🧹 Nettoyage du cache npm..."
npm cache clean --force 2>/dev/null || true

# Supprimer node_modules si existant (repart de zéro)
if [ -d "node_modules" ]; then
  echo "🗑  Suppression de node_modules existant..."
  rm -rf node_modules
fi

# Supprimer package-lock.json si existant
if [ -f "package-lock.json" ]; then
  rm -f package-lock.json
fi

# 4. Installer les dépendances
echo ""
echo "📦 Installation des dépendances (2-5 minutes)..."
npm install --legacy-peer-deps

echo ""
echo "✅ Dépendances installées"

# 5. Générer le projet iOS natif
echo ""
echo "🔨 Génération du projet iOS (Expo prebuild)..."
npx expo prebuild --platform ios --clean

echo ""
echo "✅ Projet iOS généré"

# 6. Installer les pods CocoaPods
if command -v pod &> /dev/null; then
  echo ""
  echo "🍫 Installation des CocoaPods..."
  cd ios && pod install && cd ..
  echo "✅ CocoaPods installés"
else
  echo ""
  echo "⚠️  CocoaPods non trouvé. Installation..."
  sudo gem install cocoapods
  cd ios && pod install && cd ..
  echo "✅ CocoaPods installés"
fi

# 7. Ouvrir dans Xcode
echo ""
echo "🚀 Ouverture dans Xcode..."
WORKSPACE=$(find ios -name "*.xcworkspace" | head -1)
if [ -n "$WORKSPACE" ]; then
  open "$WORKSPACE"
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║   ✅ Xcode est ouvert !                      ║"
  echo "║                                              ║"
  echo "║   Dans Xcode :                               ║"
  echo "║   1. Signing & Capabilities → votre équipe  ║"
  echo "║   2. Sélectionnez votre iPhone ou simulateur ║"
  echo "║   3. Cliquez ▶ Run                           ║"
  echo "╚══════════════════════════════════════════════╝"
else
  echo "❌ Fichier .xcworkspace non trouvé dans ios/"
  echo "   Vérifiez que le prebuild s'est bien terminé."
fi

echo ""
read -p "Appuyez sur Entrée pour fermer cette fenêtre..."
