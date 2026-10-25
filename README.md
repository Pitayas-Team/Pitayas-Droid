# Pitaya Droid

Emulator Androida z rodziny Pitayas. Działa na oficjalnym emulatorze Google (Android SDK, przyspieszenie KVM)
i scrcpy.

- **Cały system** — Android w oknie, jak telefon na ekranie komputera.
- **Tylko aplikacja** — emulator działa w tle, a wybrana aplikacja otwiera się we własnym oknie
  (osobny wirtualny ekran, Android 10+; na starszych pokazuje cały ekran z tą aplikacją).
- **Dowolna wersja Androida** — od 5.0 do najnowszej, w odmianach: Google Play / Google APIs / czysty AOSP.
- **Instalacja aplikacji** — przeciągnij `.apk`, `.xapk`, `.apks` albo `.apkm` (paczki dzielone i pliki OBB też).
- **Skróty** — aplikacja Androida jako ikona na pulpicie i w menu (`--droid-run=<urządzenie>:<pakiet>`).

## Wymagania (Fedora / Nobara)

```bash
sudo dnf install java-headless scrcpy unzip
```

Android SDK jest szukany w `ANDROID_HOME`, `~/Android/Sdk`, a gdy go nie ma — aplikacja pobiera go sama
do `~/.config/Pitayas/Droid/data/sdk`. Emulator, adb i obrazy systemu instalują się z poziomu okna.
Urządzenia (AVD) leżą tam gdzie zwykle (`~/.android/avd`), więc widzi je też Android Studio.

## Uruchomienie

```bash
npm install
npm start
```

## Pitaya Core

Dane: `~/.config/Pitayas/Droid`. Polecenia kanału sterowania (dla huba):

| Polecenie | Argumenty                    | Co robi                                 |
| --------- | ---------------------------- | --------------------------------------- |
| `devices` | —                            | lista urządzeń i ich stan               |
| `start`   | `avd`, `headless`            | uruchom urządzenie                      |
| `stop`    | `avd`                        | zatrzymaj urządzenie                    |
| `install` | `avd`, `path`                | zainstaluj aplikację                    |
| `apps`    | `avd`                        | lista aplikacji                         |
| `run-app` | `avd`, `pkg`, `mode`         | otwórz aplikację (`window` / `system`)  |
