(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.droid;
  const { showToast, openModal, closeModal, escapeHTML: esc } = window.PitayaUI;

  let status = null;      // wynik check()
  let avds = [];
  let images = [];
  let meta = { devices: [] };
  let currentTab = 'devices';
  let appsAvd = null;
  let renderingApps = false;

  // Wywołanie IPC z komunikatem przy błędzie; zwraca result albo undefined
  async function call(fn, ...args) {
    const res = await fn(...args);
    if (!res || !res.ok) {
      showToast((res && res.error) || 'Coś poszło nie tak', 'error');
      return undefined;
    }
    return res.result;
  }

  // ───── Zakładki ─────
  document.querySelectorAll('.m-tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });
  function setTab(name) {
    currentTab = name;
    document.querySelectorAll('.m-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.m-view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    if (name === 'apps') renderApps();
    if (name === 'systems') loadImages();
  }

  // ───── Przygotowanie SDK ─────
  async function loadCheck() {
    status = await call(api.check);
    if (!status) return;
    const rows = [
      ['Android SDK', status.hasSdk, status.sdkRoot],
      ['Emulator', status.hasEmulator, ''],
      ['adb', status.hasAdb, ''],
      ['Java (dla sdkmanager)', status.hasJava, status.hasJava ? '' : 'sudo dnf install java-headless'],
      ['Przyspieszenie KVM', status.kvm, status.kvm ? '' : 'włącz wirtualizację w BIOS'],
      ['scrcpy (okna pojedynczych aplikacji)', status.hasScrcpy, status.hasScrcpy ? '' : 'sudo dnf install scrcpy'],
    ];
    $('checkList').innerHTML = rows.map(([label, ok, note]) =>
      `<div class="check-row"><span class="m-status-dot ${ok ? 'active' : 'bad'}"></span>${esc(label)}${note ? ` <code>${esc(note)}</code>` : ''}</div>`).join('');
    $('setupHint').textContent = status.hasJava
      ? 'Pobierzemy emulator i narzędzia Androida od Google (ok. 400 MB). Obrazy systemu wybierzesz potem w zakładce „Wersje Androida”.'
      : 'Najpierw zainstaluj Javę, potem kliknij przycisk poniżej.';
    $('setupPanel').style.display = status.ready ? 'none' : '';
    $('btnSetup').disabled = !status.hasJava;
    $('sdkPathText').textContent = status.sdkRoot;
  }
  $('btnSetup').addEventListener('click', async () => {
    $('btnSetup').disabled = true;
    const r = await call(api.setupSdk);
    if (r) showToast('Emulator gotowy', 'success');
    await loadCheck();
    loadImages(true);
  });

  // ───── Urządzenia ─────
  function deviceIcon(a) {
    const d = a.device || '';
    if (/tv/.test(d)) return 'i-tv';
    if (/tablet|pixel_c|Nexus (7|9|10)/.test(d)) return 'i-tablet';
    return 'i-phone';
  }
  function stateLabel(a) {
    if (a.state === 'booting') return '<span class="m-status"><span class="m-status-dot" style="background:var(--m-accent)"></span>Uruchamianie…</span>';
    if (a.state === 'running') return `<span class="m-status"><span class="m-status-dot active"></span>${a.headless ? 'Działa w tle' : 'Działa'}${a.apps ? ` · okna aplikacji: ${a.apps}` : ''}</span>`;
    return '<span class="m-status"><span class="m-status-dot"></span>Wyłączone</span>';
  }

  async function loadAvds() {
    const list = await call(api.avds);
    if (!list) return;
    avds = list;
    renderAvds();
    renderAppsSelect();
  }

  function renderAvds() {
    const el = $('devList');
    if (!avds.length) {
      el.style.display = 'block';
      el.innerHTML = `<div class="m-panel"><div class="empty">
        <div class="big"><svg class="ico"><use href="#i-android"/></svg></div>
        <strong>Nie masz jeszcze żadnego urządzenia</strong>
        <div>Wybierz wersję Androida i rodzaj urządzenia — obraz systemu pobierze się sam.</div>
        <button class="m-btn accent" data-act="new"><svg class="ico"><use href="#i-plus"/></svg>Nowe urządzenie</button>
      </div></div>`;
      return;
    }
    el.style.display = '';
    el.innerHTML = avds.map((a) => {
      const on = a.state !== 'off';
      return `<div class="dev ${on ? 'on' : ''}" data-avd="${esc(a.name)}">
        <div class="dev-top">
          <div class="dev-ico"><svg class="ico"><use href="#${deviceIcon(a)}"/></svg></div>
          <div style="min-width:0">
            <div class="dev-name" title="${esc(a.name)}">${esc(a.displayName)}</div>
            <div class="dev-sub">${stateLabel(a)}</div>
          </div>
        </div>
        <div class="chips">
          <span class="m-chip">Android ${esc(a.androidName)}</span>
          <span class="m-chip muted">${esc(a.variant)}</span>
          ${a.ram ? `<span class="m-chip muted">${Math.round(a.ram / 1024)} GB RAM</span>` : ''}
          ${a.size ? `<span class="m-chip muted">${esc(a.size)}</span>` : ''}
        </div>
        <div class="dev-actions">
          ${on
            ? `<button class="m-btn small danger" data-act="stop"><svg class="ico"><use href="#i-stop"/></svg>Zatrzymaj</button>`
            : `<button class="m-btn small accent" data-act="start"><svg class="ico"><use href="#i-play"/></svg>Uruchom system</button>`}
          <button class="m-btn small" data-act="apps"><svg class="ico"><use href="#i-apps"/></svg>Aplikacje</button>
          <div class="dev-more">
            <button class="m-btn small icon-only" data-act="menu" title="Więcej"><svg class="ico"><use href="#i-more"/></svg></button>
            <div class="menu">
              ${on ? '' : '<button data-act="headless">Uruchom w tle (bez okna)</button>'}
              ${on ? '' : '<button data-act="cold">Uruchom od zera (bez szybkiego startu)</button>'}
              ${on && a.state === 'running' ? '<button data-act="shot">Zrzut ekranu</button>' : ''}
              ${on ? '' : '<button data-act="wipe">Przywróć ustawienia fabryczne</button>'}
              <button class="danger" data-act="delete">Usuń urządzenie</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('') + `<button class="dev" data-act="new" style="align-items:center;justify-content:center;cursor:pointer;border-style:dashed;color:var(--m-text-3);font:inherit;min-height:160px">
        <svg class="ico" style="width:28px;height:28px;color:var(--m-accent)"><use href="#i-plus"/></svg>
        <span style="font-weight:700;color:var(--m-text)">Nowe urządzenie</span>
        <span style="font-size:12px">dowolna wersja Androida</span>
      </button>`;
  }

  $('devList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-avd]');
    const name = card && card.dataset.avd;
    const act = btn.dataset.act;
    if (act !== 'menu') document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    if (act === 'new') return openCreate();
    if (act === 'menu') {
      const m = btn.nextElementSibling;
      const wasOpen = m.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
      if (!wasOpen) m.classList.add('open');
      return;
    }
    if (act === 'start') { btn.disabled = true; await call(api.start, name, {}); }
    if (act === 'headless') await call(api.start, name, { headless: true });
    if (act === 'cold') await call(api.start, name, { coldBoot: true });
    if (act === 'wipe') {
      if (!confirm('Przywrócić ustawienia fabryczne? Wszystkie aplikacje i dane w tym urządzeniu zostaną usunięte.')) return;
      await call(api.start, name, { wipe: true });
    }
    if (act === 'stop') { btn.disabled = true; await call(api.stop, name); }
    if (act === 'shot') { const f = await call(api.screenshot, name); if (f) showToast('Zapisano zrzut ekranu', 'success'); }
    if (act === 'delete') { const ok = await call(api.deleteAvd, name); if (ok) showToast('Usunięto urządzenie', 'success'); }
    if (act === 'apps') { appsAvd = name; setTab('apps'); }
    loadAvds();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dev-more')) document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  });

  // ───── Nowe urządzenie ─────
  async function openCreate(preselectPkg) {
    if (status && !status.hasSdk) { showToast('Najpierw zainstaluj emulator (przycisk u góry)', 'error'); return; }
    if (!images.length) await loadImages();
    const apis = [...new Set(images.map((i) => i.api))];
    $('cApi').innerHTML = apis.map((v) => {
      const any = images.find((i) => i.api === v);
      const inst = images.some((i) => i.api === v && i.installed);
      return `<option value="${esc(v)}">Android ${esc(any.name)}${inst ? ' ✓' : ''}</option>`;
    }).join('');
    $('cDevice').innerHTML = meta.devices.map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
    const pre = preselectPkg && images.find((i) => i.pkg === preselectPkg);
    // Domyślnie: najnowsza pobrana wersja, a gdy nic nie ma — najnowsza stabilna z Google Play
    const def = pre || images.find((i) => i.installed) || images.find((i) => !i.api.includes('.') && i.tag === 'google_apis_playstore') || images[0];
    if (def) $('cApi').value = def.api;
    fillTags(def && def.tag);
    $('cName').value = '';
    openModal('modalCreate');
  }
  function fillTags(prefer) {
    const list = images.filter((i) => i.api === $('cApi').value);
    $('cTag').innerHTML = list.map((i) => `<option value="${esc(i.pkg)}">${esc(i.variant)}${i.installed ? ' ✓' : ''}</option>`).join('');
    const p = list.find((i) => i.tag === prefer) || list.find((i) => i.installed) || list[0];
    if (p) $('cTag').value = p.pkg;
    updateCreateHint();
  }
  function updateCreateHint() {
    const img = images.find((i) => i.pkg === $('cTag').value);
    if (!img) { $('cHint').textContent = ''; return; }
    $('cName').placeholder = `Android ${img.name.split(' (')[0]}`;
    $('cHint').innerHTML = img.installed
      ? 'Obraz systemu jest już pobrany — urządzenie będzie gotowe od razu.'
      : `Obraz <b>Android ${esc(img.name)} — ${esc(img.variantShort)}</b> zostanie pobrany (ok. 1–2 GB).`;
  }
  $('cApi').addEventListener('change', () => fillTags(images.find((i) => i.pkg === $('cTag').value)?.tag));
  $('cTag').addEventListener('change', updateCreateHint);
  $('btnCreate').addEventListener('click', async () => {
    const image = $('cTag').value;
    if (!image) return;
    const img = images.find((i) => i.pkg === image);
    const opts = {
      displayName: $('cName').value.trim() || `Android ${img.name.split(' (')[0]}`,
      image, device: $('cDevice').value, ram: Number($('cRam').value), storage: Number($('cStorage').value),
    };
    closeModal('modalCreate');
    const name = await call(api.createAvd, opts);
    if (name) {
      showToast(`Utworzono „${opts.displayName}”`, 'success');
      setTab('devices');
    }
    loadAvds();
    if (!img.installed) loadImages();
  });

  // ───── Wersje Androida ─────
  async function loadImages(refresh = false) {
    if (refresh) $('imageList').innerHTML = '<div class="m-small">Pobieranie listy od Google…</div>';
    const list = await call(api.images, { refresh });
    if (!list) return;
    images = list;
    // Pierwsze uruchomienie: brak listy w pamięci — pobieramy ją od razu
    if (!images.length && !refresh && status && status.hasSdk) return loadImages(true);
    renderImages();
  }
  function renderImages() {
    if (!images.length) {
      $('imageList').innerHTML = `<div class="m-small">${status && status.hasSdk ? 'Brak listy — kliknij „Odśwież listę”.' : 'Najpierw zainstaluj emulator.'}</div>`;
      return;
    }
    const byApi = new Map();
    for (const i of images) { if (!byApi.has(i.api)) byApi.set(i.api, []); byApi.get(i.api).push(i); }
    $('imageList').innerHTML = [...byApi.entries()].map(([v, list]) => {
      const inst = list.some((i) => i.installed);
      return `<div class="img-row ${inst ? 'inst' : ''}">
        <div class="img-api"><b>${esc(v)}</b><small>API</small></div>
        <div class="img-main"><div class="img-title">Android ${esc(list[0].name)}</div></div>
        <div class="img-variants">${list.map((i) => `<button class="var-btn ${i.installed ? 'inst' : ''}" data-pkg="${esc(i.pkg)}" title="${i.installed ? 'Utwórz urządzenie z tego obrazu' : 'Pobierz obraz'}">
          ${i.installed ? '✓' : '<svg class="ico" style="width:13px;height:13px"><use href="#i-download"/></svg>'}${esc(i.variantShort)}
          ${i.installed ? '<span class="x" data-remove="1" title="Usuń obraz z dysku">✕</span>' : ''}
        </button>`).join('')}</div>
      </div>`;
    }).join('');
  }
  $('imageList').addEventListener('click', async (e) => {
    const btn = e.target.closest('.var-btn');
    if (!btn) return;
    const img = images.find((i) => i.pkg === btn.dataset.pkg);
    if (e.target.closest('[data-remove]')) {
      if (!confirm(`Usunąć obraz Android ${img.name} (${img.variantShort}) z dysku?`)) return;
      if (await call(api.removeImage, img.pkg) !== undefined) showToast('Usunięto obraz', 'success');
      return loadImages();
    }
    if (img.installed) return openCreate(img.pkg);
    btn.disabled = true;
    if (await call(api.installImage, img.pkg) !== undefined) showToast(`Pobrano Android ${img.name}`, 'success');
    loadImages();
  });
  $('btnRefreshImages').addEventListener('click', () => loadImages(true));

  // ───── Aplikacje ─────
  function renderAppsSelect() {
    const sel = $('appsAvd');
    if (!avds.length) {
      sel.innerHTML = '<option value="">— najpierw utwórz urządzenie —</option>';
      appsAvd = null;
    } else {
      if (!appsAvd || !avds.some((a) => a.name === appsAvd)) appsAvd = (avds.find((a) => a.state !== 'off') || avds[0]).name;
      sel.innerHTML = avds.map((a) => `<option value="${esc(a.name)}">${esc(a.displayName)} — Android ${esc(a.androidName)}</option>`).join('');
      sel.value = appsAvd;
    }
    const a = avds.find((x) => x.name === appsAvd);
    $('appsState').innerHTML = a ? stateLabel(a) : '—';
    if (currentTab === 'apps') renderApps();
  }
  $('appsAvd').addEventListener('change', () => { appsAvd = $('appsAvd').value; renderAppsSelect(); });

  let lastAppsKey = '';
  async function renderApps(force = false) {
    if (!appsAvd || renderingApps) { if (!appsAvd) $('appList').innerHTML = ''; return; }
    renderingApps = true;
    try {
      const res = await call(api.apps, appsAvd);
      if (!res) return;
      const key = appsAvd + JSON.stringify(res);
      if (!force && key === lastAppsKey) return;
      lastAppsKey = key;
      if (!res.apps.length) {
        $('appList').innerHTML = `<div class="m-small" style="grid-column:1/-1;padding:6px 4px">${res.live
          ? 'Brak zainstalowanych aplikacji. Upuść plik APK powyżej albo zainstaluj coś ze Sklepu Play w systemie.'
          : 'Brak aplikacji zainstalowanych przez Pitaya Droid. Uruchom urządzenie, żeby zobaczyć wszystkie aplikacje.'}</div>`;
        return;
      }
      $('appList').innerHTML = res.apps.map((app) => `<div class="app" data-pkg="${esc(app.pkg)}" data-label="${esc(app.label)}" data-icon="${esc(app.icon || '')}">
        <div class="app-top">
          ${app.icon ? `<img class="app-icon" src="file://${esc(app.icon)}" alt="">` : `<div class="app-icon">${esc(app.label.charAt(0).toUpperCase())}</div>`}
          <div style="min-width:0">
            <div class="app-name" title="${esc(app.label)}">${esc(app.label)}</div>
            <div class="app-pkg" title="${esc(app.pkg)}">${esc(app.pkg)}${app.version ? ' · ' + esc(app.version) : ''}</div>
          </div>
        </div>
        <div class="app-actions">
          <button class="m-btn small accent" data-act="window" title="Otwórz samą aplikację w osobnym oknie"><svg class="ico"><use href="#i-window"/></svg>Otwórz</button>
          <button class="m-btn small icon-only" data-act="system" title="Otwórz w pełnym systemie Android"><svg class="ico"><use href="#i-android"/></svg></button>
          <div class="dev-more">
            <button class="m-btn small icon-only" data-act="menu" title="Więcej"><svg class="ico"><use href="#i-more"/></svg></button>
            <div class="menu">
              <button data-act="shortcut">Skrót na pulpicie i w menu</button>
              <button class="danger" data-act="uninstall">Odinstaluj</button>
            </div>
          </div>
        </div>
      </div>`).join('');
    } finally { renderingApps = false; }
  }

  $('appList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-pkg]');
    const { pkg, label, icon } = card.dataset;
    const act = btn.dataset.act;
    if (act === 'menu') {
      const m = btn.nextElementSibling;
      const wasOpen = m.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
      if (!wasOpen) m.classList.add('open');
      return;
    }
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    if (act === 'window' || act === 'system') {
      btn.disabled = true;
      showToast(`Otwieranie ${label}…`, 'info');
      await call(api.launch, appsAvd, pkg, act);
      btn.disabled = false;
    }
    if (act === 'shortcut') { if (await call(api.shortcut, appsAvd, pkg, label, icon || null)) showToast(`Dodano skrót „${label}”`, 'success'); }
    if (act === 'uninstall') {
      if (!confirm(`Odinstalować ${label}? Dane tej aplikacji w urządzeniu zostaną usunięte.`)) return;
      if (await call(api.uninstall, appsAvd, pkg) !== undefined) showToast(`Odinstalowano ${label}`, 'success');
      renderApps(true);
    }
  });

  async function installFiles(files) {
    if (!appsAvd) { showToast('Najpierw utwórz urządzenie', 'error'); return; }
    for (const f of files) {
      const r = await call(api.install, appsAvd, f);
      if (r) showToast(`Zainstalowano ${r.label}`, 'success');
      renderApps(true);
    }
  }
  const drop = $('dropZone');
  drop.addEventListener('click', async () => {
    const files = await call(api.pickApk);
    if (files && files.length) installFiles(files);
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('active'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('active'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('active');
    const files = [...e.dataTransfer.files].map((f) => api.getPathForFile(f)).filter((p) => /\.(apk|xapk|apks|apkm)$/i.test(p));
    if (!files.length) { showToast('To nie jest plik aplikacji Androida', 'error'); return; }
    setTab('apps');
    installFiles(files);
  });
  // Upuszczenie APK gdziekolwiek w oknie też instaluje
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (e.target.closest('#dropZone')) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files].map((f) => api.getPathForFile(f)).filter((p) => /\.(apk|xapk|apks|apkm)$/i.test(p));
    if (files.length) { setTab('apps'); installFiles(files); }
  });

  // ───── Pasek zadań (pobieranie, uruchamianie) ─────
  function renderTask(t) {
    $('taskbar').classList.toggle('show', Boolean(t));
    if (!t) return;
    $('taskLabel').textContent = t.label || '';
    $('taskDetail').textContent = [t.detail, t.percent != null ? `${t.percent}%` : ''].filter(Boolean).join(' · ');
    const indet = t.percent == null;
    $('taskProgress').classList.toggle('indeterminate', indet);
    $('taskBar').style.width = indet ? '' : `${t.percent}%`;
  }
  api.onTask(renderTask);

  // ───── Licencja ─────
  api.onLicense((l) => {
    $('licenseText').textContent = l.text || '';
    openModal('modalLicense');
  });
  $('btnLicenseYes').addEventListener('click', () => { closeModal('modalLicense'); api.answerLicense(true); });
  $('btnLicenseNo').addEventListener('click', () => { closeModal('modalLicense'); api.answerLicense(false); });

  api.onNotice((n) => showToast(n.text, n.type || 'info'));
  api.onChanged(() => { loadAvds(); });

  // ───── Ustawienia ─────
  async function loadSettings() {
    const s = await window.pitayaBridge.getSettings();
    $('sGpu').value = s.gpu || 'auto';
    $('sAppWindow').value = s.appWindow || '';
    $('sAudio').checked = s.audio !== false;
    $('sStopHeadless').checked = s.stopHeadlessOnClose !== false;
  }
  const save = (patch) => window.pitayaBridge.setSettings(patch);
  $('sGpu').addEventListener('change', () => save({ gpu: $('sGpu').value }));
  $('sAppWindow').addEventListener('change', () => save({ appWindow: $('sAppWindow').value }));
  $('sAudio').addEventListener('change', () => save({ audio: $('sAudio').checked }));
  $('sStopHeadless').addEventListener('change', () => save({ stopHeadlessOnClose: $('sStopHeadless').checked }));
  $('btnPickSdk').addEventListener('click', async () => {
    if (await call(api.pickSdk)) { await loadCheck(); loadImages(true); }
  });

  // ───── Start ─────
  (async () => {
    meta = (await call(api.meta)) || meta;
    loadSettings();
    await loadCheck();
    await loadAvds();
    renderTask(await call(api.task));
    if (status && status.hasSdk) loadImages();
  })();
})();
