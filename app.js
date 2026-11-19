(() => {
  const api = (window.LOCAL_SHARE_API || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let room = params.get('room');
  let poller;

  function status(message, isError = false) {
    const target = $('status');
    target.textContent = message;
    target.classList.toggle('error', isError);
  }
  async function request(path, options = {}) {
    if (!api || api.includes('YOUR-HTTPS-API-URL')) throw new Error('Set LOCAL_SHARE_API in config.js to your server HTTPS URL.');
    const response = await fetch(`${api}${path}`, options);
    const payload = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
    if (!response.ok) throw new Error(payload?.error || `Server error (${response.status})`);
    return payload;
  }
  function showRoom(code, qrData) {
    room = code;
    $('home').classList.add('hidden');
    $('room').classList.remove('hidden');
    $('code').textContent = code;
    $('roomStatus').textContent = 'Anyone with this room link can join.';
    if (qrData) {
      const image = document.createElement('img'); image.alt = 'QR code to join this room'; image.src = qrData;
      $('qr').replaceChildren(image);
    } else {
      request(`/api/rooms/${encodeURIComponent(code)}/qr`).then(data => {
        const image = document.createElement('img'); image.alt = 'QR code to join this room'; image.src = data.qr;
        $('qr').replaceChildren(image);
      }).catch(() => {});
    }
    history.replaceState({}, '', `${location.pathname}?room=${encodeURIComponent(code)}`);
    refreshItems();
    clearInterval(poller);
    poller = setInterval(refreshItems, 2500);
  }
  async function refreshItems() {
    if (!room) return;
    try {
      const { items } = await request(`/api/rooms/${encodeURIComponent(room)}/items`);
      const list = $('items');
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Nothing shared yet. Send text or a file from either device.';
        list.append(empty);
        return;
      }
      for (const item of items) {
        const row = document.createElement('div'); row.className = 'item';
        const details = document.createElement('div');
        const title = document.createElement('div'); title.className = 'item-title'; title.textContent = item.name;
        const meta = document.createElement('div'); meta.className = 'item-meta'; meta.textContent = item.kind === 'text' ? 'Text snippet' : `${item.sizeLabel}${item.remainingMs ? ` · ${Math.ceil(item.remainingMs / 1000)} sec left` : ''}`;
        details.append(title, meta); row.append(details);
        if (item.kind === 'file') {
          const link = document.createElement('a'); link.className = 'download'; link.href = `${api}/api/items/${encodeURIComponent(item.id)}/download`; link.textContent = 'Download'; link.setAttribute('download', item.name); row.append(link);
        } else {
          const copy = document.createElement('button'); copy.className = 'download'; copy.textContent = 'Copy text';
          copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(item.text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Clipboard blocked'; } });
          row.append(copy);
        }
        list.append(row);
      }
    } catch (error) { $('roomStatus').textContent = error.message; }
  }

  $('create').addEventListener('click', async () => {
    $('create').disabled = true;
    status('Connecting to your computer…');
    try {
      const data = await request('/api/rooms', { method: 'POST' });
      showRoom(data.code, data.qr);
      $('roomStatus').textContent = 'Room created. Scan the code with your other device.';
    } catch (error) { status(error.message, true); $('create').disabled = false; }
  });
  $('join').addEventListener('click', async () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (!code) { status('Enter the room code.', true); return; }
    $('join').disabled = true; status('Joining room…');
    try { await request(`/api/rooms/${encodeURIComponent(code)}/items`); showRoom(code); }
    catch (error) { status(error.message, true); }
    finally { $('join').disabled = false; }
  });
  $('joinCode').addEventListener('keydown', event => { if (event.key === 'Enter') $('join').click(); });

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    $('textPane').classList.toggle('hidden', button.dataset.tab !== 'text');
    $('filePane').classList.toggle('hidden', button.dataset.tab !== 'file');
  }));
  $('file').addEventListener('change', () => {
    const file = $('file').files[0]; $('filename').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'No file selected';
    $('sendFile').disabled = !file;
  });
  $('sendText').addEventListener('click', async () => {
    const text = $('message').value;
    if (!text.trim()) { $('roomStatus').textContent = 'Enter some text first.'; return; }
    $('sendText').disabled = true;
    try { await request(`/api/rooms/${encodeURIComponent(room)}/text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); $('message').value = ''; $('roomStatus').textContent = 'Text sent.'; await refreshItems(); }
    catch (error) { $('roomStatus').textContent = error.message; }
    finally { $('sendText').disabled = false; }
  });
  $('sendFile').addEventListener('click', async () => {
    const file = $('file').files[0]; if (!file) return;
    const form = new FormData(); form.append('file', file);
    $('sendFile').disabled = true; $('roomStatus').textContent = 'Uploading to your computer…';
    try { await request(`/api/rooms/${encodeURIComponent(room)}/files`, { method: 'POST', body: form }); $('file').value = ''; $('filename').textContent = 'No file selected'; $('roomStatus').textContent = 'Upload complete. The other device can download it.'; await refreshItems(); }
    catch (error) { $('roomStatus').textContent = error.message; }
    finally { $('sendFile').disabled = false; }
  });
  $('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('copyLink').textContent = 'Link copied'; }
    catch { $('copyLink').textContent = location.href; }
  });
  if (room) showRoom(room);
})();
