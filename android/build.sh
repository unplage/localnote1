#!/bin/bash
set -e

# 路径可通过环境变量覆盖；未设置时自动探测本机 SDK/JDK
if [ -z "$ANDROID_HOME" ]; then
    if [ -d /opt/android-sdk ]; then
        ANDROID_HOME=/opt/android-sdk
    else
        ANDROID_HOME=/home/jamax/.local/pwa-android/sdk
    fi
fi
if [ -z "$JAVA_HOME" ]; then
    JAVAC=$(command -v javac)
else
    JAVAC=$JAVA_HOME/bin/javac
fi
BUILD_TOOLS=${BUILD_TOOLS:-$ANDROID_HOME/build-tools/34.0.0}
PLATFORM=${PLATFORM:-$ANDROID_HOME/platforms/android-34}
PROJECT=${PROJECT:-$(cd "$(dirname "$0")" && pwd)}
OUTDIR=$PROJECT/build
APPNAME=仿素记日记

VERSION_CODE=3
VERSION_NAME=1.2.2

rm -rf $OUTDIR
mkdir -p $OUTDIR/out $OUTDIR/dex

echo "==> 1. 编译 Java"
$JAVAC -d $OUTDIR/out \
    -cp $PLATFORM/android.jar \
    $PROJECT/app/src/main/java/com/localnote/app/MainActivity.java

echo "==> 2. 转换 DEX"
$BUILD_TOOLS/d8 --lib $PLATFORM/android.jar \
    --output $OUTDIR/dex \
    $(find $OUTDIR/out -name "*.class")

echo "==> 3. 打包 APK（manifest + res + assets）"
$BUILD_TOOLS/aapt package -f \
    -M $PROJECT/app/src/main/AndroidManifest.xml \
    -S $PROJECT/app/src/main/res \
    -A $PROJECT/app/src/main/assets \
    -I $PLATFORM/android.jar \
    --version-code $VERSION_CODE \
    --version-name "$VERSION_NAME" \
    -F $OUTDIR/${APPNAME}-unsigned.apk

echo "==> 4. 写入 classes.dex"
cd $OUTDIR/dex
$BUILD_TOOLS/aapt add $OUTDIR/${APPNAME}-unsigned.apk classes.dex

echo "==> 5. Zipalign"
$BUILD_TOOLS/zipalign -f -v 4 \
    $OUTDIR/${APPNAME}-unsigned.apk \
    $OUTDIR/${APPNAME}-unsigned-aligned.apk

echo "==> 6. Debug 签名"
$BUILD_TOOLS/apksigner sign \
    --ks $HOME/.android/debug.keystore \
    --ks-pass pass:android \
    --ks-key-alias androiddebugkey \
    --key-pass pass:android \
    --out $OUTDIR/${APPNAME}-v${VERSION_NAME}-debug.apk \
    $OUTDIR/${APPNAME}-unsigned-aligned.apk

rm -f $OUTDIR/${APPNAME}-unsigned.apk $OUTDIR/${APPNAME}-unsigned-aligned.apk
echo ""
echo "✅ APK 生成完毕: $OUTDIR/${APPNAME}-v${VERSION_NAME}-debug.apk"
ls -lh $OUTDIR/${APPNAME}-v${VERSION_NAME}-debug.apk
