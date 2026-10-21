#!/usr/bin/env python3
"""生成 PWA 图标。

唯一源文件是 icons/icon.svg，本脚本据此导出各平台需要的位图：
  icons/icon-192.png / icon-512.png            普通图标（圆角背景）
  icons/icon-maskable-192.png / -512.png       Android 自适应图标（满幅背景 + 安全区）
  icons/apple-touch-icon.png                   iOS 主屏图标（满幅背景，系统自行裁圆角）
  favicon.ico                                 浏览器标签页图标

依赖：cairosvg、Pillow
用法：python3 tools/make_icons.py
"""

import os
import re
import sys

try:
    import cairosvg
except ImportError:
    sys.exit('缺少依赖：pip install cairosvg')

try:
    from PIL import Image
except ImportError:
    sys.exit('缺少依赖：pip install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, 'icons')
SOURCE = os.path.join(ICON_DIR, 'icon.svg')


def extract_glyph(source):
    """取出 <g id="glyph"> ... </g> 的完整内容。"""
    start = source.index('<g id="glyph">')
    depth = 0
    pos = start
    while True:
        match = re.compile(r'<g\b|</g>').search(source, pos)
        if not match:
            break
        if match.group(0) == '</g>':
            depth -= 1
            if depth == 0:
                return source[start:match.end()]
        else:
            depth += 1
        pos = match.end()
    raise SystemExit('未能在 %s 中找到 <g id="glyph">' % SOURCE)


def build_variant(defs, glyph, scale, rounded):
    """按满幅背景 + 缩放图形拼装新的 SVG 文本。"""
    bg = ('<rect width="512" height="512" rx="112" fill="url(#bg)"/>' if rounded
          else '<rect width="512" height="512" fill="url(#bg)"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
        + defs + bg
        + '<g transform="translate(256 256) scale(%s) translate(-256 -256)">' % scale
        + glyph
        + '</g></svg>'
    )


def render(svg_text, out_path, size):
    cairosvg.svg2png(bytestring=svg_text.encode('utf-8'),
                     write_to=out_path,
                     output_width=size,
                     output_height=size)
    print('生成 %s (%dx%d)' % (os.path.relpath(out_path, ROOT), size, size))


def main():
    with open(SOURCE, encoding='utf-8') as fp:
        source = fp.read()

    defs_match = re.search(r'<defs>.*?</defs>', source, re.S)
    if not defs_match:
        raise SystemExit('未能在 %s 中找到 <defs>' % SOURCE)
    defs = defs_match.group(0)
    glyph = extract_glyph(source)

    # 普通图标：直接使用源文件
    render(source, os.path.join(ICON_DIR, 'icon-192.png'), 192)
    render(source, os.path.join(ICON_DIR, 'icon-512.png'), 512)

    # 自适应图标：满幅背景，图形缩到安全区内
    maskable = build_variant(defs, glyph, 0.78, rounded=False)
    render(maskable, os.path.join(ICON_DIR, 'icon-maskable-192.png'), 192)
    render(maskable, os.path.join(ICON_DIR, 'icon-maskable-512.png'), 512)

    # iOS 主屏图标：满幅背景，图形稍大（系统负责裁圆角）
    apple = build_variant(defs, glyph, 0.86, rounded=False)
    render(apple, os.path.join(ICON_DIR, 'apple-touch-icon.png'), 180)

    # 标签页图标（多尺寸 ICO）
    Image.open(os.path.join(ICON_DIR, 'icon-512.png')).convert('RGBA').save(
        os.path.join(ROOT, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    print('生成 favicon.ico (16/32/48)')

    make_android_icons(source, defs, glyph)


ANDROID_RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
# 启动器图标：传统图标尺寸 / 自适应图标前景尺寸（108dp 画布）
MIPMAPS = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216),
           'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}


def make_android_icons(source, defs, glyph):
    """生成 Android 启动器图标（res/mipmap-*）。"""
    legacy = source
    round_icon = build_variant(defs, glyph, 0.78, rounded=False)
    foreground = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
        + defs
        + '<g transform="translate(256 256) scale(0.78) translate(-256 -256)">'
        + glyph + '</g></svg>'
    )

    for density, (legacy_size, fg_size) in MIPMAPS.items():
        folder = os.path.join(ANDROID_RES, 'mipmap-' + density)
        os.makedirs(folder, exist_ok=True)
        for name, svg in (('ic_launcher', legacy), ('ic_launcher_round', round_icon),
                          ('ic_launcher_foreground', foreground)):
            render(svg, os.path.join(folder, name + '.png'), legacy_size if name != 'ic_launcher_foreground' else fg_size)

    os.makedirs(os.path.join(ANDROID_RES, 'mipmap-anydpi-v26'), exist_ok=True)
    os.makedirs(os.path.join(ANDROID_RES, 'values'), exist_ok=True)
    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@drawable/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n'
    )
    for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with open(os.path.join(ANDROID_RES, 'mipmap-anydpi-v26', name), 'w', encoding='utf-8') as fp:
            fp.write(adaptive)

    os.makedirs(os.path.join(ANDROID_RES, 'drawable'), exist_ok=True)
    with open(os.path.join(ANDROID_RES, 'drawable', 'ic_launcher_background.xml'), 'w', encoding='utf-8') as fp:
        fp.write('<?xml version="1.0" encoding="utf-8"?>\n'
                 '<shape xmlns:android="http://schemas.android.com/apk/res/android"\n'
                 '    android:shape="rectangle">\n'
                 '    <gradient\n'
                 '        android:startColor="#7E7DF7"\n'
                 '        android:centerColor="#5D5CDE"\n'
                 '        android:endColor="#4645C4"\n'
                 '        android:angle="315" />\n'
                 '</shape>\n')
    print('生成 Android 启动器图标: %s' % os.path.relpath(ANDROID_RES, ROOT))


if __name__ == '__main__':
    main()
