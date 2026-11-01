/* Лобі між раундами для ігор з кімнатами (Хованки, Перевтілення, Монстр, Цар гори, Тихо-голосно).
   Хост закінчив раунд → g.ph='room' → усі в лобі. Хто зайшов посеред раунду, чекає в лобі
   (бачить, скільки лишилось, може дивитись), а хост бачить плашку «Чекають» і може завершити раунд.
   Ігри викликають: gate(), bar(), close(), back(), reset(). */
(function () {
  const $ = (id) => document.getElementById(id);
  const css = document.createElement('style');
  css.textContent = '.rl-bar{position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 58px);z-index:6;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:6px 6px 6px 12px;border-radius:999px;background:rgba(20,18,30,.88);color:#fff;font:600 13px/1.2 system-ui,sans-serif}'
    + '.rl-bar span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}'
    + '.rl-bar button{flex:none;min-height:36px;padding:0 12px;border:0;border-radius:999px;background:#FF5A5F;color:#fff;font:700 13px/1 system-ui,sans-serif;cursor:pointer}'
    + '.rl-status{margin:0;text-align:center;font-weight:700}.rl-watch{align-self:center}';
  document.head.appendChild(css);

  let bar = null, armT = 0, seenKey = '', endsAt = 0, status = null, watch = null, watchFn = null;
  function ui() {
    if (status || !$('plist')) return;
    status = document.createElement('p'); status.className = 'rl-status'; status.hidden = true; status.setAttribute('aria-live', 'polite');
    watch = document.createElement('button'); watch.type = 'button'; watch.className = 'link rl-watch'; watch.textContent = 'Дивитись гру'; watch.hidden = true;
    watch.addEventListener('click', () => { if (watchFn) watchFn(); });
    $('plist').before(status); $('plist').after(watch);
  }
  function remain(g) {
    const key = g.r + ':' + g.k;
    if (key !== seenKey) { seenKey = key; endsAt = performance.now() + (+g.rem || 0); }
    const s = Math.ceil((endsAt - performance.now()) / 1000);
    return s > 0 && s < 900 ? ' · ще ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '';
  }
  function setStatus(text) {
    ui(); if (!status) return;
    status.hidden = !text; if (text && status.textContent !== text) status.textContent = text;
    watch.hidden = !text;
    if (text) $('waitHost').hidden = true;
  }
  function hideBar() { if (bar) bar.hidden = true; armT = 0; }

  window.RoomLobby = {
    /* true — раунду для цього гравця зараз нема, гра далі не йде */
    gate(g, MP, phase, back) {
      if (!g) return false;
      if (g.ph === 'room') { if (phase !== 'lobby') { MP.watch = false; back(); } setStatus(''); return true; }
      if (phase === 'lobby' && !MP.watch && !(g.pl || []).includes(MP.me)) {
        watchFn = () => { MP.watch = true; setStatus(''); };
        setStatus('Йде раунд' + remain(g) + '. Увійдеш у наступний');
        return true;
      }
      setStatus('');
      return false;
    },
    /* плашка хоста: хто чекає в лобі + дострокове завершення */
    bar(g, MP, players, end) {
      const names = !MP.host || !g || !g.pl ? [] : players.filter((p) => !g.pl.includes(p.id)).map((p) => String(p.presence.n || 'Гравець').slice(0, 14));
      if (!names.length || g.ph === 'room') { hideBar(); return; }
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'rl-bar';
        bar.append(document.createElement('span'), document.createElement('button'));
        bar.lastChild.type = 'button';
        bar.lastChild.addEventListener('click', () => {
          if (performance.now() < armT) { hideBar(); if (bar.onEnd) bar.onEnd(); return; }
          armT = performance.now() + 3000;   // випадковий дотик посеред гри не обриває раунд
        });
        document.body.appendChild(bar);
      }
      bar.onEnd = end; bar.hidden = false;
      const text = 'Чекають: ' + names.join(', '), label = performance.now() < armT ? 'Точно?' : 'Завершити раунд';
      if (bar.firstChild.textContent !== text) bar.firstChild.textContent = text;
      if (bar.lastChild.textContent !== label) bar.lastChild.textContent = label;
    },
    /* хост: раунд закрито, усіх — у лобі. У лобі кадри стану не шлють, тож надсилаємо тут */
    close(MP) { const g = MP.g; if (!g || g.ph === 'room') return; g.ph = 'room'; g.k++; g.rem = 0; if (MP.net) MP.net.presence({ g }); },
    /* спільна частина повернення */
    back(MP) {
      hideBar(); MP.spectator = false; MP.lr = -1;
      $('ov').hidden = true; $('mpA').hidden = true; $('mpB').hidden = false; $('mp').hidden = false;
      $('mpStart').textContent = 'Наступний раунд';
    },
    reset(MP) { hideBar(); setStatus(''); MP.watch = false; seenKey = ''; if ($('mpStart')) $('mpStart').textContent = 'Почати'; },
  };
})();
