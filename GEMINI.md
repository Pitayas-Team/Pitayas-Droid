# Instrukcje dla Antigravity / Gemini

Cały kontekst projektu **Pitaya Droid** (cel, zasady od właściciela, struktura, uruchamianie i wdrażanie, testowanie, znane ograniczenia) jest w pliku **`AGENTS.md`** w tym samym katalogu – przeczytaj go najpierw i traktuj jako obowiązujący.

Najważniejsze w skrócie:
- Electron na oficjalnym emulatorze Google (Android SDK, KVM) i scrcpy; tryb „cały system” albo „tylko aplikacja” we własnym oknie.
- Na laptopach z dwiema kartami emulator renderuje na dedykowanej; **Vulkan w Androidzie jest wyłączony** (wysypywał gry na Unity) — nie włączaj go z powrotem.
- Tryb gry (F10) mapuje klawisze na dotyk; edytor klawiszy F9.
- Wszystko po polsku; wygląd matowy i spokojny, nie „AI slop”.
- Po każdej zmianie dopisz wpis w liście zmian: `node ~/Pitayas-Projects/ADMIN/changelog.js add <id> <feature|fix|change> "opis"`.
- Commity jako właściciel, **bez** „Co-Authored-By” i wzmianek o AI. Nie buduj ani nie publikuj wersji bez prośby.
- Nigdy nie kopiuj sekretów (hasła, tokeny, `.env`) do kodu, logów ani czatu. Napisz, czego nie mogłeś sprawdzić.
