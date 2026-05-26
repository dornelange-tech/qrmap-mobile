#!/bin/bash
set -e
cd ~/Documents/qrmap-mobile/ios

echo "=== Patch ZXingObjC ==="
find Pods/ZXingObjC -name "*.m" -exec perl -i -pe '
  s/\(kCGBitmapAlphaInfoMask \& /((CGBitmapInfo)kCGBitmapAlphaInfoMask \& /g;
  s/ \| kCGImageAlpha/ | (CGBitmapInfo)kCGImageAlpha/g;
  s/kCGBitmapByteOrder32Big \| kCGImageAlpha/kCGBitmapByteOrder32Big | (CGBitmapInfo)kCGImageAlpha/g;
' {} \;

echo "=== Patch SocketRocket ==="
SR_DIR="Pods/SocketRocket/SocketRocket"
mkdir -p "$SR_DIR"
cat > "$SR_DIR/SRSecurityPolicy.h" << 'EOF'
#import <Foundation/Foundation.h>
#import <Security/Security.h>
typedef NS_ENUM(NSUInteger, SRSSLPinningMode) {
    SRSSLPinningModeNone,
    SRSSLPinningModePublicKey,
    SRSSLPinningModeCertificate,
};
@interface SRSecurityPolicy : NSObject
@property (nonatomic, assign) SRSSLPinningMode SSLPinningMode;
@property (nonatomic, assign) BOOL allowInvalidCertificates;
@property (nonatomic, assign) BOOL validatesDomainName;
+ (instancetype)defaultPolicy;
- (BOOL)evaluateServerTrust:(SecTrustRef)serverTrust forDomain:(NSString *)domain;
@end
EOF

echo "=== Nettoyage DerivedData ==="
rm -rf ~/Library/Developer/Xcode/DerivedData/QRMapVoyage*

echo "=== Patches appliqués avec succès ==="
