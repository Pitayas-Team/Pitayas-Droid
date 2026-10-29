# Pitaya Droid – emulator Androida (cały system albo pojedyncze aplikacje)

> Plik przekazania projektu między narzędziami AI (Claude Code ⇄ Antigravity ⇄ inne).
> Przeczytaj go w całości, zanim cokolwiek zmienisz. **Nie ma tu żadnych sekretów** – hasła i klucze są poza repozytorium i nie wolno ich kopiować do kodu, logów ani rozmów.
> Stan na: 2026-10-29. Jeśli zmieniasz architekturę albo sposób wdrażania, zaktualizuj ten plik.

## 1. Czym to jest
**Pitaya Droid** to emulator Androida z rodziny Pitayas: cały system w oknie albo tylko wybrana aplikacja (osobny wirtualny ekran Androida 10+, obraz H.264, dźwięk). Ma tryb gry z mapowaniem klawiszy, pasek opcji (zrzut ekranu, głośność, schowek, instalacja APK, obrót, pełny ekran).

## 2. Zasady od właściciela
- Obraz ma być ostry: Android rysuje w Full HD (albo 2560 px), okno go zmniejsza.
- Gry przez OpenGL ES; nie przywracaj Vulkana.

## 3. Gdzie co leży i jak uruchamiać
Wymaga zainstalowanego Android SDK, KVM i scrcpy. `npm install`, `npm start`. Wydania robi Pitayas Admin.

## 4. Struktura
```
main.js, android.js     okno, emulator, ADB, ustawienia (gpu, audio, dpi, maxFps, jakość)
player.html/js, player-preload.js, player-renderer.js   okno aplikacji (dekodowanie obrazu)
renderer.js, index.html, preload.js    okno główne
```

## 5. Testowanie
Wymaga emulatora i sprzętu — w tym środowisku nie sprawdzisz działania, tylko składnię.

## 6. Zasady wspólne
- **Język:** interfejs, komentarze, opisy zmian i odpowiedzi po polsku. Marka „Pitayas”; kolory: róż pitai `#ff4fa6`, ciemne tło `#121116`.
- **Wygląd:** matowy, spokojny, czytelny — **nie „AI slop”**: bez świecących gradientów w tytułach, poświat pod przyciskami i udawanego szkła w CSS. Prawdziwe szkło tylko natywne (iOS 26) na elementach, które się nie ruszają.
- **Pitaya Core:** folder `core/` w aplikacji to **kopia** z projektu `Pitayas-Core`. Nie edytuj jej w aplikacji — zmieniaj w `Pitayas-Core` i uruchom `~/Pitayas-Projects/ADMIN/sync-core.sh`. Każda aplikacja rejestruje się w `~/.config/Pitayas/apps/<id>.json` i wystawia kanał sterowania (kontrakt Core 0.2, dla przyszłego Pitaya Hub).
- **Lista zmian:** po **każdej** zmianie w aplikacji dopisz wpis: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis po polsku"`. `<id>` = nazwa folderu bez „Pitayas-”, małymi literami (np. `screen`, `mobile`, `accounts`, `admin`, `website`). Wpisy trafiają do opisu wydania na GitHubie.
- **Git:** commity jako właściciel (`Pitayas <inbox@rakunek.com>`), krótki opis po polsku, **bez** `Co-Authored-By` i wzmianek o narzędziach AI. Push tylko na bieżącą gałąź, bez force-push bez zgody.
- **Budowanie i wydania:** nie buduj, nie pakuj i nie publikuj wersji bez wyraźnej prośby właściciela. Wydania robi **Pitayas Admin** (`ADMIN/cli.js`, GitHub Releases organizacji Pitayas-Team). Po budowie nie uruchamiaj aplikacji właściciela.
- **Sekrety:** hasła, tokeny, klucze i pliki `.env` nigdy do kodu, logów, commitów ani rozmów.
- **Uczciwość:** nie masz telefonu, iPhone'a ani Windowsa — wyraźnie napisz, czego nie dało się sprawdzić, zamiast twierdzić, że działa.
- **Praca na serwerze:** projekty leżą w `~/Pitayas-Projects` na serwerze rakunek.com (kopia na komputerze właściciela to zapas). Nie startuj zbędnych procesów w tle ani dodatkowych sesji/agentów.
