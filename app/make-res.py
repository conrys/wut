#!/usr/bin/env python3
"""Іконка й заставка Android-застосунку 41games з крокодила (img/icon.png, прозоре тло).

Запуск: python3 app/make-res.py   (потрібен Pillow). Результат — у app/android/app/src/main/res.
Крокодил ніде не розтягується: лише пропорційно вписується в безпечну зону Android
(іконки обрізаються колом/«сквіркілом», заставка Android 12+ — колом).
"""
import math, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "app", "android", "app", "src", "main", "res")
BG = (0x14, 0x16, 0x1A, 255)      # тло застосунку (як --bg сайту)
ICON_BG = (0, 0, 0, 255)          # тло іконки — як у img/icon_graph.png
DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

src = Image.open(os.path.join(ROOT, "img", "icon.png")).convert("RGBA")
croc = src.crop(src.getbbox())
diag = math.hypot(*croc.size)


def croc_fit(diag_px):
    """Крокодил, вписаний так, що його діагональ = diag_px (влазить у коло цього діаметра)."""
    k = diag_px / diag
    return croc.resize((max(1, round(croc.width * k)), max(1, round(croc.height * k))), Image.LANCZOS)


def centered(canvas, img):
    canvas.alpha_composite(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
    return canvas


def save(img, folder, name):
    d = os.path.join(RES, folder)
    os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, name), optimize=True)


for dens, k in DENS.items():
    px = lambda dp: round(dp * k)
    # адаптивна іконка: полотно 108dp, видима зона ~72dp → крокодил по діагоналі 70dp
    save(centered(Image.new("RGBA", (px(108), px(108)), (0, 0, 0, 0)), croc_fit(px(70))), f"mipmap-{dens}", "ic_launcher_foreground.png")
    # стара іконка (Android 7): чорний заокруглений квадрат 48dp
    sq = Image.new("RGBA", (px(48), px(48)), (0, 0, 0, 0))
    ImageDraw.Draw(sq).rounded_rectangle([0, 0, px(48) - 1, px(48) - 1], radius=px(10), fill=ICON_BG)
    save(centered(sq, croc_fit(px(44))), f"mipmap-{dens}", "ic_launcher.png")
    rd = Image.new("RGBA", (px(48), px(48)), (0, 0, 0, 0))
    ImageDraw.Draw(rd).ellipse([0, 0, px(48) - 1, px(48) - 1], fill=ICON_BG)
    save(centered(rd, croc_fit(px(40))), f"mipmap-{dens}", "ic_launcher_round.png")
    # заставка Android 12+: полотно 288dp, видиме коло 192dp
    save(centered(Image.new("RGBA", (px(288), px(288)), (0, 0, 0, 0)), croc_fit(px(186))), f"drawable-{dens}", "splash_icon.png")

# повноекранні splash.png (старі Android і фон під час запуску) — перемальовуємо в тих самих розмірах
for folder in sorted(os.listdir(RES)):
    f = os.path.join(RES, folder, "splash.png")
    if not folder.startswith("drawable") or not os.path.exists(f):
        continue
    w, h = Image.open(f).size
    img = centered(Image.new("RGBA", (w, h), BG), croc_fit(min(w, h) * 0.42))
    img.convert("RGB").save(f, optimize=True)

print("✓ іконки й заставки оновлено в", RES)
