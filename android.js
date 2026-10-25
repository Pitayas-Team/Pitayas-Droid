// Silnik Pitaya Droid: Android SDK (sdkmanager / avdmanager), emulator, adb i scrcpy.
// Bez Electrona — main.js podaje folder danych, dziennik i ustawienia.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const https = require('https');
const { EventEmitter } = require('events');

const HOST_ABI = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
const CMDLINE_TOOLS_URL = 'https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip';

const ANDROID_NAMES = {
    21: '5.0 Lollipop', 22: '5.1 Lollipop', 23: '6.0 Marshmallow', 24: '7.0 Nougat', 25: '7.1 Nougat',
    26: '8.0 Oreo', 27: '8.1 Oreo', 28: '9 Pie', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13',
    34: '14', 35: '15', 36: '16', 37: '17', 38: '18',
};
const VARIANTS = {
    google_apis_playstore: { label: 'Sklep Google Play', short: 'Google Play' },
    google_apis: { label: 'Usługi Google (bez sklepu)', short: 'Google APIs' },
    default: { label: 'Czysty Android (AOSP)', short: 'AOSP' },
};
const DEVICES = [
    { id: 'pixel_9', label: 'Telefon — Pixel 9' },
    { id: 'pixel_7', label: 'Telefon — Pixel 7' },
    { id: 'pixel_9_pro_xl', label: 'Duży telefon — Pixel 9 Pro XL' },
    { id: 'small_phone', label: 'Mały telefon' },
    { id: 'pixel_9_pro_fold', label: 'Składany — Pixel 9 Pro Fold' },
    { id: 'pixel_tablet', label: 'Tablet — Pixel Tablet' },
    { id: 'medium_tablet', label: 'Tablet średni' },
    { id: 'tv_1080p', label: 'Telewizor 1080p' },
];

function androidName(api) {
    const major = parseInt(api, 10);
    const base = ANDROID_NAMES[major] || `API ${api}`;
    return String(api).includes('.') && !/\.0$/.test(api) ? `${base} (API ${api})` : base;
}

function run(cmd, args, { timeout = 60000, input, env } = {}) {
    return new Promise((resolve, reject) => {
        const child = execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, env: env || process.env }, (err, stdout, stderr) => {
            if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
            resolve(String(stdout));
        });
        if (input != null) { child.stdin.end(input); }
    });
}

function which(name) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        const p = path.join(dir, name);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
    return null;
}

const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(port, '127.0.0.1');
    });
}

function download(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return download(res.headers.location, dest, onProgress).then(resolve, reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const total = Number(res.headers['content-length']) || 0;
            let got = 0;
            const out = fs.createWriteStream(dest);
            res.on('data', (c) => { got += c.length; if (total && onProgress) onProgress(Math.round((got / total) * 100)); });
            res.pipe(out);
            out.on('finish', () => out.close(resolve));
            out.on('error', reject);
        }).on('error', reject);
    });
}

function createAndroid({ dataDir, log, settings }) {
    const events = new EventEmitter();
    const catalogFile = path.join(dataDir, 'apps.json');
    const imagesCacheFile = path.join(dataDir, 'images-cache.json');
    const iconsDir = path.join(dataDir, 'icons');
    fs.mkdirSync(iconsDir, { recursive: true });

    // Emulatory uruchomione przez nas: avd → { proc, serial, headless, booted, sessions:Set }
    const running = new Map();
    let task = null;   // bieżące długie zadanie (pobieranie) — widoczne w oknie
    let licenseWait = null;

    // ───── Ścieżki ─────
    function sdkRoot() {
        const own = path.join(dataDir, 'sdk');
        const list = [settings.get('sdkPath'), process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
            path.join(os.homedir(), 'Android', 'Sdk'), own].filter(Boolean);
        return list.find((p) => exists(path.join(p, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'))) || own;
    }
    function avdHome() {
        if (process.env.ANDROID_AVD_HOME) return process.env.ANDROID_AVD_HOME;
        const user = process.env.ANDROID_USER_HOME || path.join(os.homedir(), '.android');
        return path.join(user, 'avd');
    }
    function latestBuildTool(name) {
        const dir = path.join(sdkRoot(), 'build-tools');
        try {
            const vers = fs.readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            for (const v of vers) if (exists(path.join(dir, v, name))) return path.join(dir, v, name);
        } catch {}
        return null;
    }
    function tools() {
        const root = sdkRoot();
        const bin = path.join(root, 'cmdline-tools', 'latest', 'bin');
        const sdkAdb = path.join(root, 'platform-tools', 'adb');
        return {
            root,
            sdkmanager: exists(path.join(bin, 'sdkmanager')) ? path.join(bin, 'sdkmanager') : null,
            avdmanager: exists(path.join(bin, 'avdmanager')) ? path.join(bin, 'avdmanager') : null,
            emulator: exists(path.join(root, 'emulator', 'emulator')) ? path.join(root, 'emulator', 'emulator') : null,
            // Jeden adb dla wszystkiego — dwa różne serwery adb wyrzucają się nawzajem
            adb: exists(sdkAdb) ? sdkAdb : which('adb'),
            aapt: latestBuildTool('aapt'),
            scrcpy: which('scrcpy'),
            java: which('java') || (process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java')),
            kvm: exists('/dev/kvm'),
        };
    }
    function sdkEnv() {
        const root = sdkRoot();
        const t = tools();
        return { ...process.env, ANDROID_HOME: root, ANDROID_SDK_ROOT: root, ...(t.adb ? { ADB: t.adb } : {}) };
    }

    function setTask(next) {
        task = next ? { ...(task || {}), ...next } : null;
        events.emit('task', task);
    }

    // ───── Stan narzędzi ─────
    function check() {
        const t = tools();
        return {
            sdkRoot: t.root, avdHome: avdHome(), abi: HOST_ABI,
            hasSdk: Boolean(t.sdkmanager), hasEmulator: Boolean(t.emulator), hasAdb: Boolean(t.adb),
            hasAapt: Boolean(t.aapt), hasScrcpy: Boolean(t.scrcpy), hasJava: Boolean(t.java), kvm: t.kvm,
            ready: Boolean(t.sdkmanager && t.emulator && t.adb && t.java),
        };
    }

    // ───── sdkmanager ─────
    // Instalacja pakietów z postępem; prośbę o licencję przekazujemy do okna (answerLicense)
    function sdkInstall(packages, label) {
        const t = tools();
        if (!t.sdkmanager) return Promise.reject(new Error('Brak Android SDK — zainstaluj je w zakładce Systemy.'));
        if (!t.java) return Promise.reject(new Error('Brak Javy (potrzebna dla sdkmanager): sudo dnf install java-21-openjdk'));
        log.info('sdkmanager --install', packages.join(' '));
        setTask({ label, percent: 0, detail: 'Przygotowanie…' });
        return new Promise((resolve, reject) => {
            const child = spawn(t.sdkmanager, ['--sdk_root=' + t.root, '--install', ...packages], { env: sdkEnv() });
            let buf = '';
            let licenseText = '';
            const onData = (chunk) => {
                const text = String(chunk);
                buf = (buf + text).slice(-20000);
                licenseText += text;
                const m = [...text.matchAll(/(\d{1,3})%\s*([^\r\n[]*)/g)].pop();
                if (m) setTask({ percent: Math.min(100, Number(m[1])), detail: m[2].trim() || task?.detail });
                if (/Accept\? \(y\/N\):\s*$/.test(buf)) {
                    const body = licenseText.split(/-{10,}/).slice(-2).join('\n').replace(/Accept\? \(y\/N\):\s*$/, '').trim();
                    licenseText = '';
                    buf = '';
                    licenseWait = (yes) => child.stdin.write(yes ? 'y\n' : 'n\n');
                    events.emit('license', { text: body.slice(-12000) });
                }
            };
            child.stdout.on('data', onData);
            child.stderr.on('data', onData);
            child.on('error', (err) => { setTask(null); reject(err); });
            child.on('close', (code) => {
                licenseWait = null;
                setTask(null);
                if (code === 0 && !/Failed to install|License .* not accepted/i.test(buf)) return resolve();
                const line = buf.split(/[\r\n]+/).filter((l) => /error|warning|fail|not accepted/i.test(l)).pop();
                reject(new Error(line ? line.trim() : `sdkmanager zakończył się kodem ${code}`));
            });
        });
    }
    function answerLicense(yes) {
        if (licenseWait) { licenseWait(yes); licenseWait = null; }
    }

    async function setupSdk() {
        const t = tools();
        if (!t.java) throw new Error('Brak Javy (potrzebna dla Android SDK). Zainstaluj: sudo dnf install java-21-openjdk');
        if (!t.sdkmanager) {
            const root = path.join(dataDir, 'sdk');
            const zip = path.join(dataDir, 'cmdline-tools.zip');
            const tmp = path.join(root, 'cmdline-tools', '.tmp');
            setTask({ label: 'Pobieranie Android SDK', percent: 0, detail: 'cmdline-tools' });
            try {
                await download(CMDLINE_TOOLS_URL, zip, (p) => setTask({ percent: p }));
                fs.rmSync(tmp, { recursive: true, force: true });
                fs.mkdirSync(tmp, { recursive: true });
                await run('unzip', ['-q', '-o', zip, '-d', tmp], { timeout: 120000 });
                const latest = path.join(root, 'cmdline-tools', 'latest');
                fs.rmSync(latest, { recursive: true, force: true });
                fs.renameSync(path.join(tmp, 'cmdline-tools'), latest);
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
                fs.rmSync(zip, { force: true });
                setTask(null);
            }
        }
        const missing = [];
        if (!tools().emulator) missing.push('emulator');
        if (!exists(path.join(sdkRoot(), 'platform-tools', 'adb'))) missing.push('platform-tools');
        if (!tools().aapt) missing.push('build-tools;36.0.0');
        if (missing.length) await sdkInstall(missing, 'Instalacja emulatora Androida');
        return check();
    }

    // Lista obrazów systemu: zainstalowane + dostępne do pobrania (z pamięcią podręczną na offline)
    async function listImages({ refresh = false } = {}) {
        const t = tools();
        let cached = null;
        try { cached = JSON.parse(fs.readFileSync(imagesCacheFile, 'utf8')); } catch {}
        const installedNow = installedImages();
        if (cached && !refresh) return mergeImages(cached.available, installedNow);
        if (!t.sdkmanager || !t.java) return mergeImages(cached ? cached.available : [], installedNow);
        let out = '';
        try {
            out = await run(t.sdkmanager, ['--sdk_root=' + t.root, '--list', '--include_obsolete'], { timeout: 180000, env: sdkEnv() });
        } catch (err) {
            log.warn('sdkmanager --list:', err.message);
            return mergeImages(cached ? cached.available : [], installedNow);
        }
        const available = [];
        const seen = new Set();
        for (const line of out.split('\n')) {
            const m = line.match(/^\s*(system-images;android-([\d.]+);([\w-]+);([\w-]+))\s*\|\s*([^|]+)\|/);
            if (!m || m[4] !== HOST_ABI || !VARIANTS[m[3]] || seen.has(m[1])) continue;
            seen.add(m[1]);
            available.push({ pkg: m[1], api: m[2], tag: m[3] });
        }
        try { fs.writeFileSync(imagesCacheFile, JSON.stringify({ at: Date.now(), available })); } catch {}
        return mergeImages(available, installedNow);
    }
    function installedImages() {
        const base = path.join(sdkRoot(), 'system-images');
        const list = [];
        try {
            for (const a of fs.readdirSync(base)) {
                const api = a.replace(/^android-/, '');
                if (!/^[\d.]+$/.test(api)) continue;
                for (const tag of fs.readdirSync(path.join(base, a))) {
                    if (!VARIANTS[tag]) continue;
                    if (exists(path.join(base, a, tag, HOST_ABI, 'system.img'))) list.push({ pkg: `system-images;${a};${tag};${HOST_ABI}`, api, tag });
                }
            }
        } catch {}
        return list;
    }
    function mergeImages(available, installed) {
        const map = new Map();
        for (const i of available || []) map.set(i.pkg, { ...i, installed: false });
        for (const i of installed) map.set(i.pkg, { ...(map.get(i.pkg) || i), installed: true });
        return [...map.values()]
            .map((i) => ({ ...i, name: androidName(i.api), variant: VARIANTS[i.tag].label, variantShort: VARIANTS[i.tag].short }))
            .sort((a, b) => parseFloat(b.api) - parseFloat(a.api) || Object.keys(VARIANTS).indexOf(a.tag) - Object.keys(VARIANTS).indexOf(b.tag));
    }
    async function installImage(pkg) {
        const img = mergeImages([parseImagePkg(pkg)], []).pop();
        const extra = [];
        if (!tools().emulator) extra.push('emulator');
        if (!exists(path.join(sdkRoot(), 'platform-tools', 'adb'))) extra.push('platform-tools');
        await sdkInstall([pkg, ...extra], `Pobieranie Android ${img.name} — ${img.variantShort}`);
    }
    async function removeImage(pkg) {
        const users = (await listAvds()).filter((a) => a.image === pkg);
        if (users.length) throw new Error(`Obrazu używa: ${users.map((u) => u.displayName).join(', ')}. Najpierw usuń te urządzenia.`);
        const t = tools();
        await run(t.sdkmanager, ['--sdk_root=' + t.root, '--uninstall', pkg], { timeout: 180000, env: sdkEnv() });
    }
    function parseImagePkg(pkg) {
        const [, a, tag] = pkg.split(';');
        return { pkg, api: a.replace(/^android-/, ''), tag };
    }

    // ───── Urządzenia (AVD) ─────
    function readIni(file) {
        const out = {};
        try {
            for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
                const i = line.indexOf('=');
                if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            }
        } catch {}
        return out;
    }
    function writeIni(file, patch) {
        const cur = readIni(file);
        Object.assign(cur, patch);
        fs.writeFileSync(file, Object.entries(cur).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    }

    async function listAvds() {
        const home = avdHome();
        let files = [];
        try { files = fs.readdirSync(home).filter((f) => f.endsWith('.ini')); } catch {}
        const meta = settings.get('avdMeta') || {};
        const list = [];
        for (const f of files) {
            const name = f.slice(0, -4);
            const ini = readIni(path.join(home, f));
            const dir = ini.path && exists(ini.path) ? ini.path : path.join(home, name + '.avd');
            const cfg = readIni(path.join(dir, 'config.ini'));
            const sys = (cfg['image.sysdir.1'] || '').split(/[\\/]/).filter(Boolean); // system-images/android-34/google_apis/x86_64
            const api = (sys[1] || '').replace(/^android-/, '') || ini.target?.replace(/^android-/, '') || '?';
            const tag = sys[2] || cfg['tag.id'] || 'default';
            const r = running.get(name);
            list.push({
                name, dir,
                displayName: meta[name]?.displayName || cfg['avd.ini.displayname'] || name.replace(/_/g, ' '),
                api, tag, androidName: androidName(api), variant: VARIANTS[tag]?.short || tag,
                image: sys.length >= 4 ? `system-images;${sys[1]};${sys[2]};${sys[3]}` : null,
                device: cfg['hw.device.name'] || '', ram: Number(cfg['hw.ramSize']) || null,
                size: cfg['hw.lcd.width'] && `${cfg['hw.lcd.width']}×${cfg['hw.lcd.height']}`,
                state: r ? (r.booted ? 'running' : 'booting') : 'off',
                headless: r ? r.headless : false, serial: r ? r.serial : null,
                apps: r ? r.sessions.size : 0,
            });
        }
        return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    async function createAvd({ displayName, image, device = 'pixel_9', ram = 4096, storage = 8, keyboard = true }) {
        const t = tools();
        if (!t.avdmanager) throw new Error('Brak Android SDK.');
        if (!installedImages().some((i) => i.pkg === image)) await installImage(image);
        const info = parseImagePkg(image);
        const base = (displayName || `Android ${info.api}`).normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Android';
        let name = `Pitaya_${base}`;
        const taken = new Set((await listAvds()).map((a) => a.name));
        for (let i = 2; taken.has(name); i++) name = `Pitaya_${base}_${i}`;
        setTask({ label: `Tworzenie urządzenia ${displayName || name}`, percent: null, detail: '' });
        try {
            await run(t.avdmanager, ['create', 'avd', '-n', name, '-k', image, '-d', device, '--force'], { input: 'no\n', timeout: 120000, env: sdkEnv() });
        } catch (err) {
            throw new Error((err.stderr || err.message || '').trim().split('\n').pop());
        } finally { setTask(null); }
        const dir = path.join(avdHome(), name + '.avd');
        writeIni(path.join(dir, 'config.ini'), {
            'avd.ini.displayname': displayName || name,
            'hw.ramSize': String(ram),
            'disk.dataPartition.size': `${storage}G`,
            'hw.keyboard': keyboard ? 'yes' : 'no',
            'hw.gpu.enabled': 'yes',
            'hw.gpu.mode': 'auto',
            'showDeviceFrame': 'yes',
            'fastboot.forceColdBoot': 'no',
        });
        const meta = settings.get('avdMeta') || {};
        meta[name] = { displayName: displayName || name, createdAt: new Date().toISOString() };
        settings.set('avdMeta', meta);
        log.info('Utworzono urządzenie', name, image, device);
        return name;
    }

    async function deleteAvd(name) {
        if (running.has(name)) await stop(name);
        const t = tools();
        await run(t.avdmanager, ['delete', 'avd', '-n', name], { timeout: 60000, env: sdkEnv() });
        const meta = settings.get('avdMeta') || {};
        delete meta[name];
        settings.set('avdMeta', meta);
        const catalog = readCatalog();
        delete catalog[name];
        writeCatalog(catalog);
    }

    // ───── adb ─────
    function adb(serial, args, opts = {}) {
        const t = tools();
        if (!t.adb) return Promise.reject(new Error('Brak adb'));
        return run(t.adb, serial ? ['-s', serial, ...args] : args, { timeout: 60000, ...opts, env: sdkEnv() });
    }
    async function adbDevices() {
        try {
            const out = await adb(null, ['devices']);
            return out.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^emulator-\d+$/.test(p[0])).map((p) => ({ serial: p[0], state: p[1] }));
        } catch { return []; }
    }

    // Emulatory uruchomione poza aplikacją (np. z Android Studio) też pokazujemy
    async function refreshForeign() {
        const devices = await adbDevices();
        const known = new Set([...running.values()].map((r) => r.serial));
        for (const d of devices) {
            if (known.has(d.serial) || d.state !== 'device') continue;
            try {
                const name = (await adb(d.serial, ['emu', 'avd', 'name'], { timeout: 5000 })).split(/\r?\n/)[0].trim();
                if (name && !running.has(name)) running.set(name, { serial: d.serial, proc: null, headless: false, booted: true, foreign: true, sessions: new Set() });
            } catch {}
        }
        for (const [name, r] of running) {
            if (r.foreign && !devices.some((d) => d.serial === r.serial)) running.delete(name);
        }
    }

    async function freePort() {
        const used = new Set((await adbDevices()).map((d) => Number(d.serial.split('-')[1])));
        for (const r of running.values()) used.add(Number(r.serial.split('-')[1]));
        for (let p = 5554; p <= 5680; p += 2) {
            if (used.has(p)) continue;
            if (await portFree(p) && await portFree(p + 1)) return p;
        }
        throw new Error('Brak wolnego portu dla emulatora');
    }

    async function start(name, { headless = false, coldBoot = false, wipe = false } = {}) {
        const existing = running.get(name);
        if (existing) return existing;
        const t = tools();
        if (!t.emulator) throw new Error('Emulator nie jest zainstalowany — kliknij „Zainstaluj emulator” w zakładce Systemy.');
        const port = await freePort();
        const serial = `emulator-${port}`;
        const gpu = settings.get('gpu') || 'auto';
        const args = ['-avd', name, '-port', String(port), '-gpu', gpu, '-netdelay', 'none', '-netspeed', 'full'];
        if (headless) args.push('-no-window', '-no-boot-anim');
        if (coldBoot) args.push('-no-snapshot-load');
        if (wipe) args.push('-wipe-data');
        if (!settings.get('audio')) args.push('-no-audio');
        log.info('emulator', args.join(' '));
        const proc = spawn(t.emulator, args, { env: sdkEnv(), detached: !headless, stdio: ['ignore', 'pipe', 'pipe'] });
        const entry = { proc, serial, headless, booted: false, sessions: new Set(), output: '' };
        running.set(name, entry);
        const collect = (c) => { entry.output = (entry.output + c).slice(-8000); };
        proc.stdout.on('data', collect);
        proc.stderr.on('data', collect);
        proc.on('close', (code) => {
            log.info('Emulator', name, 'zakończył pracę, kod', code);
            if (running.get(name) === entry) running.delete(name);
            for (const s of entry.sessions) { try { s.kill(); } catch {} }
            if (!entry.booted && code) {
                const line = entry.output.split('\n').filter((l) => /ERROR|FATAL|PANIC/i.test(l)).pop();
                events.emit('notice', { type: 'error', text: `Emulator ${name} nie wystartował${line ? ': ' + line.replace(/^.*?(ERROR|FATAL|PANIC)\s*\|?\s*/i, '') : ''}` });
            }
            events.emit('changed');
        });
        if (!headless) proc.unref();
        events.emit('changed');
        waitBoot(name).catch(() => {});
        return entry;
    }

    async function waitBoot(name, timeoutMs = 6 * 60 * 1000) {
        const entry = running.get(name);
        if (!entry) throw new Error('Emulator nie działa');
        if (entry.booted) return entry;
        if (!entry.bootPromise) {
            entry.bootPromise = (async () => {
                const end = Date.now() + timeoutMs;
                while (Date.now() < end) {
                    if (running.get(name) !== entry) throw new Error('Emulator został zamknięty');
                    try {
                        const v = (await adb(entry.serial, ['shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 })).trim();
                        if (v === '1') {
                            entry.booted = true;
                            log.info('Uruchomiono', name, entry.serial);
                            events.emit('changed');
                            return entry;
                        }
                    } catch {}
                    await sleep(1500);
                }
                throw new Error('Emulator uruchamia się zbyt długo');
            })();
        }
        return entry.bootPromise;
    }

    async function stop(name) {
        const entry = running.get(name);
        if (!entry) return;
        for (const s of entry.sessions) { try { s.kill(); } catch {} }
        try { await adb(entry.serial, ['emu', 'kill'], { timeout: 10000 }); } catch {}
        if (entry.proc) {
            const proc = entry.proc;
            setTimeout(() => { if (proc.exitCode == null) { try { proc.kill('SIGTERM'); } catch {} } }, 15000);
        } else running.delete(name);
        events.emit('changed');
    }

    async function ensureRunning(name, headless) {
        if (!running.has(name)) {
            setTask({ label: `Uruchamianie ${name.replace(/^Pitaya_/, '').replace(/_/g, ' ')}`, percent: null, detail: headless ? 'w tle' : '' });
            await start(name, { headless });
        }
        try { return await waitBoot(name); } finally { if (task && task.label.startsWith('Uruchamianie')) setTask(null); }
    }

    // ───── Aplikacje ─────
    function readCatalog() { try { return JSON.parse(fs.readFileSync(catalogFile, 'utf8')); } catch { return {}; } }
    function writeCatalog(c) { fs.writeFileSync(catalogFile, JSON.stringify(c, null, 2)); }

    async function apkInfo(apk) {
        const t = tools();
        if (!t.aapt) return {};
        let out = '';
        try { out = await run(t.aapt, ['dump', 'badging', apk], { timeout: 30000 }); } catch (err) { out = err.stdout || ''; }
        const pick = (re) => (out.match(re) || [])[1];
        const info = {
            pkg: pick(/package: name='([^']+)'/),
            version: pick(/versionName='([^']*)'/),
            label: pick(/application-label-pl:'([^']+)'/) || pick(/application-label:'([^']+)'/),
            minSdk: Number(pick(/sdkVersion:'(\d+)'/)) || null,
            abis: (pick(/native-code: (.+)/) || '').replace(/'/g, '').split(/\s+/).filter(Boolean),
        };
        // Najwyższa gęstość ikony w PNG (ikony XML pomijamy)
        const icons = [...out.matchAll(/application-icon-(\d+):'([^']+)'/g)].map((m) => ({ d: Number(m[1]), p: m[2] }))
            .filter((i) => /\.(png|webp)$/i.test(i.p)).sort((a, b) => b.d - a.d);
        if (icons.length && info.pkg) {
            const dest = path.join(iconsDir, `${info.pkg}${path.extname(icons[0].p)}`);
            try {
                const buf = await new Promise((resolve, reject) => {
                    execFile('unzip', ['-p', apk, icons[0].p], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }, (e, so) => (e ? reject(e) : resolve(so)));
                });
                if (buf.length) { fs.writeFileSync(dest, buf); info.icon = dest; }
            } catch {}
        }
        return info;
    }

    // .apk, albo paczki dzielone .xapk / .apks / .apkm (zip z wieloma apk + ewentualnie obb)
    async function install(name, file) {
        const entry = await ensureRunning(name, true);
        const ext = path.extname(file).toLowerCase();
        let apks = [file];
        let tmp = null;
        let obb = null;
        const label = path.basename(file);
        setTask({ label: `Instalowanie ${label}`, percent: null, detail: '' });
        try {
            if (['.xapk', '.apks', '.apkm', '.zip'].includes(ext)) {
                tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pitaya-droid-'));
                await run('unzip', ['-q', '-o', file, '-d', tmp], { timeout: 300000 });
                const all = [];
                (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.apk')) all.push(p); } })(tmp);
                if (!all.length) throw new Error('W paczce nie ma plików .apk');
                all.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
                const baseIdx = all.findIndex((p) => /base\.apk$/.test(p));
                if (baseIdx > 0) all.unshift(...all.splice(baseIdx, 1));
                apks = all;
                const obbDir = path.join(tmp, 'Android', 'obb');
                if (exists(obbDir)) obb = obbDir;
            }
            const info = await apkInfo(apks[0]);
            setTask({ detail: info.label || info.pkg || '' });
            const args = apks.length > 1 ? ['install-multiple', '-r', ...apks] : ['install', '-r', apks[0]];
            let out;
            try { out = await adb(entry.serial, args, { timeout: 600000 }); } catch (err) { out = (err.stdout || '') + (err.stderr || err.message); }
            if (!/Success/.test(out)) {
                const code = (out.match(/INSTALL_[A-Z_]+/) || [])[0];
                const hints = {
                    INSTALL_FAILED_NO_MATCHING_ABIS: 'aplikacja jest tylko na procesory ARM — wybierz obraz z Androidem 11+ (ma tłumaczenie ARM) albo inną wersję aplikacji',
                    INSTALL_FAILED_OLDER_SDK: `aplikacja wymaga nowszego Androida (min. API ${info.minSdk || '?'})`,
                    INSTALL_FAILED_INSUFFICIENT_STORAGE: 'za mało miejsca w urządzeniu',
                    INSTALL_FAILED_UPDATE_INCOMPATIBLE: 'zainstalowana jest inna wersja z innym podpisem — najpierw ją odinstaluj',
                    INSTALL_FAILED_VERSION_DOWNGRADE: 'zainstalowana jest nowsza wersja',
                };
                throw new Error(hints[code] ? `${code}: ${hints[code]}` : (code || out.trim().split('\n').pop() || 'Instalacja nie powiodła się'));
            }
            if (obb) await adb(entry.serial, ['push', obb + '/.', '/sdcard/Android/obb/'], { timeout: 600000 });
            const pkg = info.pkg || (await listPackages(name)).find((p) => !readCatalog()[name]?.[p]);
            if (pkg) {
                const catalog = readCatalog();
                catalog[name] = catalog[name] || {};
                catalog[name][pkg] = { label: info.label || pkg, version: info.version || '', icon: info.icon || null, installedAt: new Date().toISOString() };
                writeCatalog(catalog);
            }
            log.info('Zainstalowano', file, '→', name, pkg);
            return { pkg, label: info.label || pkg };
        } finally {
            if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
            setTask(null);
        }
    }

    async function listPackages(name) {
        const entry = running.get(name);
        if (!entry || !entry.booted) return [];
        const out = await adb(entry.serial, ['shell', 'pm', 'list', 'packages', '-3'], { timeout: 20000 });
        return out.split('\n').map((l) => l.replace(/^package:/, '').trim()).filter(Boolean);
    }

    async function listApps(name) {
        const catalog = readCatalog()[name] || {};
        const entry = running.get(name);
        let pkgs = Object.keys(catalog);
        const live = entry && entry.booted;
        if (live) {
            try {
                pkgs = await listPackages(name);
                // Aplikacje odinstalowane w samym Androidzie znikają z katalogu
                const cat = readCatalog();
                if (cat[name]) {
                    for (const p of Object.keys(cat[name])) if (!pkgs.includes(p)) delete cat[name][p];
                    writeCatalog(cat);
                }
            } catch {}
        }
        return {
            live,
            apps: pkgs.map((pkg) => ({
                pkg,
                label: catalog[pkg]?.label || pkg.split('.').pop(),
                version: catalog[pkg]?.version || '',
                icon: catalog[pkg]?.icon && exists(catalog[pkg].icon) ? catalog[pkg].icon : null,
            })).sort((a, b) => a.label.localeCompare(b.label)),
        };
    }

    async function uninstall(name, pkg) {
        const entry = await ensureRunning(name, true);
        const out = await adb(entry.serial, ['uninstall', pkg], { timeout: 60000 }).catch((e) => e.stdout || e.message);
        if (!/Success/.test(out)) throw new Error(out.trim().split('\n').pop());
        const catalog = readCatalog();
        if (catalog[name]) delete catalog[name][pkg];
        writeCatalog(catalog);
    }

    // Tryb „tylko aplikacja”: emulator w tle + scrcpy z osobnym wirtualnym ekranem dla jednej aplikacji.
    // Tryb „w systemie”: okno emulatora i zwykłe uruchomienie aplikacji.
    async function launchApp(name, pkg, { mode = 'window' } = {}) {
        const t = tools();
        if (mode === 'window' && !t.scrcpy) throw new Error('Tryb okna aplikacji potrzebuje scrcpy: sudo dnf install scrcpy');
        const wasRunning = running.has(name);
        const entry = await ensureRunning(name, mode === 'window');
        const label = (readCatalog()[name] || {})[pkg]?.label || pkg;
        if (mode === 'system') {
            await adb(entry.serial, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 20000 });
            return { mode };
        }
        const api = parseFloat((await adb(entry.serial, ['shell', 'getprop', 'ro.build.version.sdk'], { timeout: 5000 })).trim()) || 0;
        const args = ['-s', entry.serial, `--window-title=${label}`, '--no-vd-system-decorations'];
        if (!settings.get('audio')) args.push('--no-audio');
        if (api >= 29) {
            const size = settings.get('appWindow') || '';
            args.push(size ? `--new-display=${size}` : '--new-display', `--start-app=+${pkg}`);
        } else {
            // Android < 10 nie ma wirtualnych ekranów — pokazujemy cały ekran z uruchomioną aplikacją
            await adb(entry.serial, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 20000 });
        }
        log.info('scrcpy', args.join(' '));
        const proc = spawn(t.scrcpy, args, { env: sdkEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        proc.stdout.on('data', (c) => { output = (output + c).slice(-4000); });
        proc.stderr.on('data', (c) => { output = (output + c).slice(-4000); });
        entry.sessions.add(proc);
        events.emit('changed');
        const started = Date.now();
        proc.on('close', (code) => {
            entry.sessions.delete(proc);
            if (code && Date.now() - started < 8000) {
                const line = output.split('\n').filter((l) => /ERROR/.test(l)).pop();
                events.emit('notice', { type: 'error', text: `Nie udało się otworzyć ${label}${line ? ': ' + line.replace(/^.*ERROR:\s*/, '') : ''}` });
            }
            // Emulator uruchomiony tylko dla tej aplikacji gasimy razem z ostatnim oknem
            if (!wasRunning && entry.headless && !entry.sessions.size && settings.get('stopHeadlessOnClose') !== false) {
                setTimeout(() => { if (!entry.sessions.size && running.get(name) === entry) stop(name); }, 1500);
            }
            events.emit('changed');
        });
        return { mode, api };
    }

    async function screenshot(name, dest) {
        const entry = running.get(name);
        if (!entry || !entry.booted) throw new Error('Urządzenie nie działa');
        const t = tools();
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(dest);
            const p = spawn(t.adb, ['-s', entry.serial, 'exec-out', 'screencap', '-p'], { env: sdkEnv() });
            p.stdout.pipe(out);
            p.on('close', (code) => (code ? reject(new Error('screencap ' + code)) : resolve()));
        });
        return dest;
    }

    function stopAllHeadless() {
        for (const [name, r] of running) {
            if (r.headless && r.proc) {
                for (const s of r.sessions) { try { s.kill(); } catch {} }
                try { r.proc.kill('SIGTERM'); } catch {}
                running.delete(name);
            }
        }
    }

    return {
        events, DEVICES, VARIANTS, HOST_ABI,
        check, setupSdk, answerLicense, getTask: () => task,
        listImages, installImage, removeImage,
        listAvds, createAvd, deleteAvd, start, stop, waitBoot, refreshForeign,
        install, listApps, uninstall, launchApp, screenshot, stopAllHeadless,
        runningCount: () => running.size,
    };
}

module.exports = { createAndroid, androidName };
