(() => {
  const api = (window.LOCAL_SHARE_API || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let room = params.get('room');
  const hostView = params.get('host') === '1';
  let poller; let guestHeartbeat; const guestId = window.crypto?.randomUUID ? window.crypto.randomUUID() : 'guest-' + Math.random().toString(36).slice(2);

  function status(message, isError = false) {
    const target = $('status');
    target.textContent = message;
    target.classList.toggle('error', isError);
  }
  async function request(path, options = {}) {
    if (!api || api.includes('YOUR-HTTPS-API-URL')) throw new Error('SendGet API is not configured yet.');
    const response = await fetch(api + path, options);
    const payload = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
    if (!response.ok) throw new Error(payload?.error || ('Server error (' + response.status + ')'));
    return payload;
  }
  function setPanels(scope, selected) {
    const roomMode = scope === 'room';
    const key = roomMode ? 'roomMode' : 'homeMode';
    const prefix = roomMode ? 'room' : 'home';
    document.querySelectorAll('[data-' + key + ']').forEach(button => {
      const active = button.dataset[key] === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    ['scan', 'manual', 'invite'].forEach(mode => $(prefix + '-' + mode).classList.toggle('hidden', mode !== selected));
  }
  function setRoomQR(qrData) {
    if (!qrData) return;
    const image = document.createElement('img');
    image.alt = 'QR code to join this SendGet room';
    image.src = qrData;
    $('qr').replaceChildren(image);
  }
  function showRoom(code, qrData, asHost = false) {
    room = code;
    $('home').classList.add('hidden');
    $('room').classList.remove('hidden');
    $('room').classList.toggle('host-view', asHost);
    $('room').classList.toggle('guest-view', !asHost);
    if ($('roomTitle')) $('roomTitle').textContent = asHost ? 'Ready to scan' : 'Choose what to send';
    $('code').textContent = code;
    $('roomCodeManual').textContent = code;
    $('inviteLink').value = location.origin + location.pathname + '?room=' + encodeURIComponent(code);
    $('roomStatus').textContent = asHost ? 'Waiting for someone to scan and send an item.' : 'Choose text or a file to send to the connected computer.';
    setPanels('room', 'scan'); clearInterval(guestHeartbeat); if (asHost) updateHostConnection(false, false); else { announceGuest(); guestHeartbeat = setInterval(announceGuest, 5000); } if (asHost) refreshPresence();
    if (asHost && qrData) setRoomQR(qrData);
    else if (asHost) request('/api/rooms/' + encodeURIComponent(code) + '/qr').then(data => setRoomQR(data.qr)).catch(error => { $('roomStatus').textContent = error.message; });
    history.replaceState({}, '', location.pathname + '?room=' + encodeURIComponent(code) + (asHost ? '&host=1' : ''));
    refreshItems();
    clearInterval(poller);
    poller = setInterval(() => { refreshItems(); if (hostView) refreshPresence(); }, 2500);
  }
  async function refreshItems() {
    if (!room) return;
    try {
      const result = await request('/api/rooms/' + encodeURIComponent(room) + '/items');
      const list = $('items');
      list.replaceChildren();
      if (!result.items.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Nothing shared yet. Send text or a file from the phone that scanned the QR code.';
        list.append(empty);
        return;
      }
      for (const item of result.items) {
        const row = document.createElement('div'); row.className = 'item';
        const details = document.createElement('div');
        const title = document.createElement('div'); title.className = 'item-title'; title.textContent = item.name;
        const meta = document.createElement('div'); meta.className = 'item-meta';
        meta.textContent = item.kind === 'text' ? 'Text snippet' : item.sizeLabel + (item.remainingMs ? ' · ' + Math.ceil(item.remainingMs / 1000) + ' sec left' : '');
        details.append(title, meta); row.append(details);
        if (item.kind === 'file') {
          const link = document.createElement('a'); link.className = 'download'; link.href = api + '/api/items/' + encodeURIComponent(item.id) + '/download'; link.textContent = 'Download'; link.setAttribute('download', item.name); row.append(link);
        } else {
          const copy = document.createElement('button'); copy.className = 'download'; copy.textContent = 'Copy text';
          copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(item.text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Clipboard blocked'; } });
          row.append(copy);
        }
        list.append(row);
      }
    } catch (error) { $('roomStatus').textContent = error.message; }
  }
  async function createRoom() {
    const buttons = [$('create'), $('createInvite')];
    buttons.forEach(button => { if (button) button.disabled = true; });
    status('Connecting to your computer…');
    try {
      const data = await request('/api/rooms', { method: 'POST' });
      showRoom(data.code, data.qr, true);
      $('roomStatus').textContent = 'Ready. Scan this code with your phone to send text or a file.';
    } catch (error) { status(error.message, true); buttons.forEach(button => { if (button) button.disabled = false; }); }
  }

  document.querySelectorAll('[data-home-mode]').forEach(button => button.addEventListener('click', () => setPanels('home', button.dataset.homeMode)));
  document.querySelectorAll('[data-room-mode]').forEach(button => button.addEventListener('click', () => setPanels('room', button.dataset.roomMode)));
  document.querySelectorAll('.share-tab').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.share-tab').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('textPane').classList.toggle('hidden', button.dataset.tab !== 'text');
    $('filePane').classList.toggle('hidden', button.dataset.tab !== 'file');
  }));
  if ($('create')) $('create').addEventListener('click', createRoom);
  if ($('createInvite')) $('createInvite').addEventListener('click', createRoom);
  $('join').addEventListener('click', async () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (!code) { status('Enter the room code.', true); return; }
    $('join').disabled = true; status('Joining room…');
    try { await request('/api/rooms/' + encodeURIComponent(code) + '/items'); showRoom(code); }
    catch (error) { status(error.message, true); }
    finally { $('join').disabled = false; }
  });
  $('joinCode').addEventListener('keydown', event => { if (event.key === 'Enter') $('join').click(); });
  $('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('inviteLink').value); $('copyLink').textContent = 'Copied'; }
    catch { $('inviteLink').select(); $('copyLink').textContent = 'Select and copy'; }
  });
  $('file').addEventListener('change', () => {
    const file = $('file').files[0];
    $('filename').textContent = file ? file.name + ' · ' + (file.size / 1024 / 1024).toFixed(2) + ' MB' : 'No file selected';
    $('sendFile').disabled = !file;
  });
  $('sendText').addEventListener('click', async () => {
    const text = $('message').value;
    if (!text.trim()) { $('roomStatus').textContent = 'Enter some text first.'; return; }
    $('sendText').disabled = true;
    try { await request('/api/rooms/' + encodeURIComponent(room) + '/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); $('message').value = ''; $('roomStatus').textContent = 'Text sent to your computer.'; await refreshItems(); }
    catch (error) { $('roomStatus').textContent = error.message; }
    finally { $('sendText').disabled = false; }
  });
  $('sendFile').addEventListener('click', async () => {
    const file = $('file').files[0]; if (!file) return;
    const form = new FormData(); form.append('file', file);
    $('sendFile').disabled = true; $('roomStatus').textContent = 'Sending to your computer…';
    try { await request('/api/rooms/' + encodeURIComponent(room) + '/files', { method: 'POST', body: form }); $('file').value = ''; $('filename').textContent = 'No file selected'; $('roomStatus').textContent = 'Sent. The file is ready on your computer.'; await refreshItems(); }
    catch (error) { $('roomStatus').textContent = error.message; }
    finally { $('sendFile').disabled = false; }
  });

  if (room) showRoom(room, null, hostView);
  else createRoom();
  function updateHostConnection(connected, hasItems = false) {
    if (!hostView) return;
    $('room').classList.toggle('host-connected', connected);
    $('connectionTitle').textContent = connected ? 'Sender device connected' : 'Scan to join this room';
    $('connectionMessage').textContent = connected ? (hasItems ? 'Data received. See the shared item below.' : 'Waiting for data!') : 'Point your other device’s camera at this code.';
  }
  async function announceGuest() {
    if (!room || hostView) return;
    try { await request('/api/rooms/' + encodeURIComponent(room) + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: guestId }) }); } catch {}
  }
  async function refreshPresence() {
    if (!room || !hostView) return;
    try {
      const presence = await request('/api/rooms/' + encodeURIComponent(room) + '/status');
      const payload = await request('/api/rooms/' + encodeURIComponent(room) + '/items');
      updateHostConnection(presence.connected, payload.items.length > 0);
    } catch {}
  }
})();
