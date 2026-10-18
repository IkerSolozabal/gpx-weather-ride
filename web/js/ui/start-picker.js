/**
 * Selector de salida (móvil y ordenador): botones de día y la hora en dos casillas,
 * horas : minutos, con − / + de 15 minutos.
 *
 * - Al escribir la hora, con 2 cifras (o Intro) pasa sola a los minutos.
 * - Intro en los minutos pasa al siguiente campo del formulario, como Tab.
 * - ↑ ↓ cambian 1 hora en las horas y 5 minutos en los minutos.
 * - En el móvil abre el teclado numérico.
 *
 * El valor real sigue en el <input type="datetime-local"> original (oculto), así el
 * resto de la app no cambia.
 */

import { t, getLang } from '../i18n.js';
import { nextDays, stepClock } from '../lib/clock.js';

const STEP = 15;
const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {HTMLInputElement} input  datetime-local original
 * @param {HTMLElement} field       contenedor del campo (se le añade la clase is-custom)
 * @param {{days: number, next?: () => HTMLElement|null}} opts
 *   days: número de días seleccionables; next: campo al que saltar tras los minutos.
 */
export function createStartPicker(input, field, { days = 16, next } = {}) {
  field.classList.add('is-custom');
  input.hidden = true;
  input.tabIndex = -1;

  const box = document.createElement('div');
  box.className = 'start-picker';
  box.innerHTML = `
    <div class="day-strip" role="radiogroup"></div>
    <div class="clock">
      <button type="button" class="clock-step" data-step="-${STEP}"><span aria-hidden="true">−</span></button>
      <div class="clock-fields">
        <input type="text" class="clock-h" inputmode="numeric" enterkeyhint="next" maxlength="2" autocomplete="off" spellcheck="false">
        <span class="clock-sep" aria-hidden="true">:</span>
        <input type="text" class="clock-m" inputmode="numeric" enterkeyhint="next" maxlength="2" autocomplete="off" spellcheck="false">
      </div>
      <button type="button" class="clock-step" data-step="${STEP}"><span aria-hidden="true">+</span></button>
    </div>`;
  field.appendChild(box);
  const strip = box.querySelector('.day-strip');
  const hh = box.querySelector('.clock-h');
  const mm = box.querySelector('.clock-m');

  const read = () => {
    const [date = '', time = '00:00'] = (input.value || '').split('T');
    const [h, m] = time.split(':').map(Number);
    return { date, h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
  };

  /** Escribe en el input original y avisa al formulario como si lo hubiera cambiado el usuario. */
  const write = (date, h, m) => {
    input.value = `${date}T${pad(h)}:${pad(m)}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    render();
  };

  function dayLabel(iso) {
    const d = new Date(`${iso}T12:00`);
    const loc = getLang() === 'en' ? 'en-GB' : 'es-ES';
    const [today, tomorrow] = nextDays(Date.now(), 2);
    const top = iso === today ? t('today') : iso === tomorrow ? t('tomorrow') : new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d).replace('.', '');
    const full = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return { top, num: d.getDate(), full };
  }

  let builtKey = '';
  function render() {
    const { date, h, m } = read();
    const list = nextDays(Date.now(), days);
    if (date && !list.includes(date)) list.unshift(date); // p. ej. una salida compartida de ayer
    // Solo se reconstruyen los botones si cambian los días o el idioma; si no, se marca el elegido
    // (así no se pierde el foco al moverse con el teclado).
    const key = `${getLang()}|${list.join(',')}`;
    if (key !== builtKey) {
      builtKey = key;
      strip.innerHTML = list
        .map((iso) => {
          const l = dayLabel(iso);
          return `<button type="button" class="day-chip" role="radio" data-date="${iso}" title="${l.full}" aria-label="${l.full}">
            <span class="day-top" aria-hidden="true">${l.top}</span><span class="day-num" aria-hidden="true">${l.num}</span></button>`;
        })
        .join('');
    }
    for (const chip of strip.querySelectorAll('.day-chip')) {
      const on = chip.dataset.date === date;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', String(on));
      chip.tabIndex = on ? 0 : -1;
    }
    if (document.activeElement !== hh) hh.value = pad(h);
    if (document.activeElement !== mm) mm.value = pad(m);
    box.querySelector('[data-step^="-"]').setAttribute('aria-label', t('timeEarlier'));
    box.querySelector('[data-step]:not([data-step^="-"])').setAttribute('aria-label', t('timeLater'));
    hh.setAttribute('aria-label', t('startHours'));
    mm.setAttribute('aria-label', t('startMinutes'));
    strip.setAttribute('aria-label', t('startDay'));
    const on = strip.querySelector('.is-on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // --- Días ---
  strip.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.day-chip');
    if (!chip) return;
    const { h, m } = read();
    write(chip.dataset.date, h, m);
  });
  strip.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const chips = [...strip.querySelectorAll('.day-chip')];
    const i = chips.findIndex((c) => c.classList.contains('is-on'));
    const target = chips[Math.max(0, Math.min(chips.length - 1, i + (ev.key === 'ArrowRight' ? 1 : -1)))];
    if (!target) return;
    ev.preventDefault();
    const { h, m } = read();
    write(target.dataset.date, h, m);
    strip.querySelector('.is-on')?.focus();
  });
  // Rueda del ratón sobre la tira de días: desplazamiento horizontal.
  strip.addEventListener(
    'wheel',
    (ev) => {
      if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
        strip.scrollLeft += ev.deltaY;
        ev.preventDefault();
      }
    },
    { passive: false },
  );

  // --- Hora ---
  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.clock-step');
    if (!btn) return;
    const { date, h, m } = read();
    const minutes = stepClock(h * 60 + m, Number(btn.dataset.step));
    write(date, Math.floor(minutes / 60), minutes % 60);
  });

  /** Guarda lo escrito en una casilla; si no es válido, vuelve al valor anterior. */
  function commit(which) {
    const el = which === 'h' ? hh : mm;
    const max = which === 'h' ? 23 : 59;
    const cur = read();
    const n = el.value.trim() === '' ? NaN : Number(el.value);
    if (!Number.isInteger(n) || n < 0 || n > max) {
      el.value = pad(which === 'h' ? cur.h : cur.m);
      return;
    }
    el.value = pad(n);
    if ((which === 'h' ? cur.h : cur.m) !== n) write(cur.date, which === 'h' ? n : cur.h, which === 'm' ? n : cur.m);
  }

  const focusMinutes = () => {
    mm.focus();
    mm.select();
  };
  const focusNext = () => {
    const el = next && next();
    if (el) {
      el.focus();
      if (el.select) el.select();
    } else mm.blur();
  };

  for (const el of [hh, mm]) {
    el.addEventListener('focus', () => el.select());
    // Solo cifras.
    el.addEventListener('beforeinput', (ev) => {
      if (ev.data && /\D/.test(ev.data)) ev.preventDefault();
    });
  }

  hh.addEventListener('input', () => {
    hh.value = hh.value.replace(/\D/g, '').slice(0, 2);
    // 2 cifras, o una que no puede empezar una hora de dos (3–9): a los minutos.
    if (hh.value.length === 2 || /^[3-9]$/.test(hh.value)) {
      commit('h');
      focusMinutes();
    }
  });
  hh.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ':' || ev.key === '.') {
      ev.preventDefault();
      commit('h');
      focusMinutes();
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const { date, h, m } = read();
      const nh = (h + (ev.key === 'ArrowUp' ? 1 : 23)) % 24;
      write(date, nh, m);
      hh.value = pad(nh);
      hh.select();
    } else if (ev.key === 'ArrowRight' && hh.selectionStart === hh.value.length) {
      ev.preventDefault();
      focusMinutes();
    }
  });
  hh.addEventListener('blur', () => commit('h'));

  mm.addEventListener('input', () => {
    mm.value = mm.value.replace(/\D/g, '').slice(0, 2);
    if (mm.value.length === 2) commit('m');
  });
  mm.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit('m');
      focusNext();
    } else if (ev.key === 'Backspace' && mm.value === '') {
      ev.preventDefault();
      hh.focus();
      hh.select();
    } else if (ev.key === 'ArrowLeft' && mm.selectionStart === 0) {
      ev.preventDefault();
      hh.focus();
      hh.select();
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const { date, h, m } = read();
      const minutes = stepClock(h * 60 + m, ev.key === 'ArrowUp' ? 5 : -5);
      write(date, Math.floor(minutes / 60), minutes % 60);
      mm.value = pad(minutes % 60);
      mm.select();
    }
  });
  mm.addEventListener('blur', () => commit('m'));

  render();
  return { refresh: render };
}
