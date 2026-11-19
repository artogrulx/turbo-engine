/* Open Meadow — inventory.js
 * Inventory model (9 hotbar + 27 storage slots, stacks up to 64) and its UI:
 *   - hotbar with icons, counts, selection frame and item-name popup
 *   - inventory screen (E): click to pick up / place / swap / merge,
 *     right-click to split or place one, Shift+click to quick-move,
 *     1-9 while hovering to swap with a hotbar slot, trash slot, sort.
 * The inventory never touches pointer lock itself; main.js owns that. */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});
  const HOTBAR = 9, TOTAL = 36;

  class Inventory {
    constructor(dom) {
      this.dom = dom;
      this.slots = new Array(TOTAL).fill(null);
      this.selected = 0;
      this.cursor = null;
      this.isOpen = false;
      this.hovered = -1;
      this.onChange = null;
      this.nameTimer = 0;
      this.hotbarEls = [];
      this.slotEls = new Array(TOTAL);
      this.buildDOM();
      this.render();
    }

    // ------------------------------------------------------------ DOM
    makeSlot(index, extraClass) {
      const el = document.createElement('div');
      el.className = 'slot' + (extraClass ? ' ' + extraClass : '');
      el.dataset.index = String(index);
      const img = document.createElement('img');
      img.className = 'slot-icon'; img.alt = ''; img.draggable = false;
      const cnt = document.createElement('span');
      cnt.className = 'slot-count';
      el.appendChild(img); el.appendChild(cnt);
      return el;
    }
    buildDOM() {
      const d = this.dom;
      d.hotbar.innerHTML = '';
      for (let i = 0; i < HOTBAR; i++) {
        const el = this.makeSlot(i, 'hotbar-slot');
        const key = document.createElement('span');
        key.className = 'slot-key'; key.textContent = String(i + 1);
        el.appendChild(key);
        d.hotbar.appendChild(el);
        this.hotbarEls.push(el);
      }
      d.main.innerHTML = ''; d.bar.innerHTML = '';
      for (let i = HOTBAR; i < TOTAL; i++) { const el = this.makeSlot(i); d.main.appendChild(el); this.slotEls[i] = el; }
      for (let i = 0; i < HOTBAR; i++) { const el = this.makeSlot(i); d.bar.appendChild(el); this.slotEls[i] = el; }

      const onDown = (e) => {
        const el = e.target.closest('.slot');
        if (!el || !this.isOpen) return;
        e.preventDefault();
        if (el === d.trash) { if (this.cursor) { this.cursor = null; this.render(); } return; }
        const i = Number(el.dataset.index);
        if (e.button === 0) this.leftClick(i, e.shiftKey);
        else if (e.button === 2) this.rightClick(i);
      };
      d.screen.addEventListener('mousedown', onDown);
      d.screen.addEventListener('contextmenu', (e) => e.preventDefault());
      d.screen.addEventListener('mousemove', (e) => this.moveCursor(e.clientX, e.clientY));
      d.screen.addEventListener('mouseover', (e) => {
        const el = e.target.closest('.slot');
        if (!el || el === d.trash) { this.hovered = -1; this.showTooltip(null); return; }
        this.hovered = Number(el.dataset.index);
        this.showTooltip(this.slots[this.hovered], el);
      });
      d.screen.addEventListener('mouseleave', () => { this.hovered = -1; this.showTooltip(null); });
      if (d.sortBtn) d.sortBtn.addEventListener('click', (e) => { e.preventDefault(); this.sort(); });
    }
    moveCursor(x, y) {
      const c = this.dom.cursor;
      c.style.transform = `translate(${x - 26}px, ${y - 26}px)`;
    }
    showTooltip(stack, el) {
      const t = this.dom.tooltip;
      if (!stack || !el) { t.classList.remove('show'); return; }
      const def = OM.Items.get(stack.id);
      t.textContent = def ? def.name : '';
      const r = el.getBoundingClientRect();
      t.style.left = `${r.left + r.width / 2}px`;
      t.style.top = `${r.top - 8}px`;
      t.classList.add('show');
    }
    renderSlot(el, stack) {
      if (!el) return;
      const img = el.querySelector('.slot-icon'), cnt = el.querySelector('.slot-count');
      if (stack) {
        const def = OM.Items.get(stack.id);
        if (img.dataset.id !== String(stack.id)) { img.src = def && def.icon ? def.icon : ''; img.dataset.id = String(stack.id); }
        img.style.visibility = 'visible';
        cnt.textContent = stack.count > 1 ? String(stack.count) : '';
      } else {
        img.style.visibility = 'hidden';
        img.dataset.id = '';
        cnt.textContent = '';
      }
    }
    render() {
      for (let i = 0; i < HOTBAR; i++) {
        this.renderSlot(this.hotbarEls[i], this.slots[i]);
        this.hotbarEls[i].classList.toggle('selected', i === this.selected);
      }
      if (this.isOpen) for (let i = 0; i < TOTAL; i++) this.renderSlot(this.slotEls[i], this.slots[i]);
      const c = this.dom.cursor;
      if (this.cursor) { this.renderSlot(c, this.cursor); c.classList.add('show'); }
      else c.classList.remove('show');
      if (this.isOpen && this.hovered >= 0) this.showTooltip(this.slots[this.hovered], this.slotEls[this.hovered]);
      if (this.onChange) this.onChange();
    }

    // ------------------------------------------------------------ model
    maxOf(id) { const d = OM.Items.get(id); return d ? d.max : 64; }
    add(id, n) {
      if (!OM.Items.get(id) || n <= 0) return n;
      const max = this.maxOf(id);
      for (let i = 0; i < TOTAL && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < max) { const k = Math.min(n, max - s.count); s.count += k; n -= k; }
      }
      for (let i = 0; i < TOTAL && n > 0; i++) {
        if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { id, count: k }; n -= k; }
      }
      this.render();
      return n;
    }
    count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }
    selectedItem() { return this.slots[this.selected]; }
    consumeSelected(n) {
      const s = this.slots[this.selected];
      if (!s) return;
      s.count -= n;
      if (s.count <= 0) this.slots[this.selected] = null;
      this.render();
    }
    setSelected(id, count) { this.slots[this.selected] = id ? { id, count } : null; this.render(); }
    select(i) {
      i = ((i % HOTBAR) + HOTBAR) % HOTBAR;
      if (i === this.selected) return;
      this.selected = i;
      this.render();
      this.flashName();
    }
    scroll(dir) { this.select(this.selected + (dir > 0 ? 1 : -1)); }
    flashName() {
      const s = this.slots[this.selected], el = this.dom.itemName;
      if (!el) return;
      const def = s ? OM.Items.get(s.id) : null;
      el.textContent = def ? def.name : '';
      el.classList.toggle('show', !!def);
      clearTimeout(this.nameTimer);
      this.nameTimer = setTimeout(() => el.classList.remove('show'), 1600);
    }
    /** Middle-click "pick block": select or fetch a matching stack. */
    pick(blockId) {
      const want = OM.Blocks.defs[blockId] && OM.Items.get(blockId) ? blockId : 0;
      if (!want) return;
      for (let i = 0; i < HOTBAR; i++) if (this.slots[i] && this.slots[i].id === want) { this.select(i); return; }
      for (let i = HOTBAR; i < TOTAL; i++) {
        if (this.slots[i] && this.slots[i].id === want) {
          const t = this.slots[this.selected];
          this.slots[this.selected] = this.slots[i]; this.slots[i] = t;
          this.render(); this.flashName();
          return;
        }
      }
    }

    // ------------------------------------------------------------ clicks
    leftClick(i, shift) {
      const s = this.slots[i];
      if (shift && s) { this.quickMove(i); return; }
      const c = this.cursor;
      if (!c && s) { this.cursor = s; this.slots[i] = null; }
      else if (c && !s) { this.slots[i] = c; this.cursor = null; }
      else if (c && s) {
        if (c.id === s.id) {
          const k = Math.min(c.count, this.maxOf(s.id) - s.count);
          s.count += k; c.count -= k;
          if (c.count <= 0) this.cursor = null;
        } else { this.slots[i] = c; this.cursor = s; }
      }
      this.render();
    }
    rightClick(i) {
      const s = this.slots[i], c = this.cursor;
      if (!c && s) {
        const k = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: k };
        s.count -= k;
        if (s.count <= 0) this.slots[i] = null;
      } else if (c && !s) {
        this.slots[i] = { id: c.id, count: 1 };
        if (--c.count <= 0) this.cursor = null;
      } else if (c && s && c.id === s.id && s.count < this.maxOf(s.id)) {
        s.count++;
        if (--c.count <= 0) this.cursor = null;
      }
      this.render();
    }
    moveInto(stack, from, to) {
      const max = this.maxOf(stack.id);
      for (let i = from; i < to && stack.count > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === stack.id && s.count < max) { const k = Math.min(stack.count, max - s.count); s.count += k; stack.count -= k; }
      }
      for (let i = from; i < to && stack.count > 0; i++) {
        if (!this.slots[i]) { this.slots[i] = { id: stack.id, count: stack.count }; stack.count = 0; }
      }
    }
    quickMove(i) {
      const s = this.slots[i];
      this.slots[i] = null;
      if (i < HOTBAR) this.moveInto(s, HOTBAR, TOTAL); else this.moveInto(s, 0, HOTBAR);
      if (s.count > 0) {
        // nowhere to go: put the remainder back where it came from
        if (!this.slots[i]) this.slots[i] = s; else this.moveInto(s, 0, TOTAL);
      }
      this.render();
    }
    swapWithHotbar(n) {
      if (this.hovered < 0 || n < 0 || n >= HOTBAR || this.hovered === n) return;
      const t = this.slots[n];
      this.slots[n] = this.slots[this.hovered];
      this.slots[this.hovered] = t;
      this.render();
    }
    sort() {
      const items = [];
      for (let i = HOTBAR; i < TOTAL; i++) { if (this.slots[i]) items.push(this.slots[i]); this.slots[i] = null; }
      const merged = new Map();
      for (const s of items) merged.set(s.id, (merged.get(s.id) || 0) + s.count);
      const ids = Array.from(merged.keys()).sort((a, b) => a - b);
      let k = HOTBAR;
      for (const id of ids) {
        let n = merged.get(id);
        const max = this.maxOf(id);
        while (n > 0 && k < TOTAL) { const c = Math.min(n, max); this.slots[k++] = { id, count: c }; n -= c; }
      }
      this.render();
    }

    // ------------------------------------------------------------ open/close
    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.dom.screen.classList.remove('hidden');
      this.render();
    }
    close() {
      if (!this.isOpen) return;
      if (this.cursor) { const left = this.add(this.cursor.id, this.cursor.count); this.cursor = null; if (left) console.warn('[OpenMeadow] inventory full, dropped', left); }
      this.isOpen = false;
      this.hovered = -1;
      this.showTooltip(null);
      this.dom.screen.classList.add('hidden');
      this.render();
    }

    // ------------------------------------------------------------ persistence
    starterKit() {
      const B = OM.B, I = OM.I, P = OM.P;
      this.slots.fill(null);
      const kit = [[B.PLANKS, 32], [B.COBBLE, 32], [B.GLASS, 16], [B.STONE_BRICKS, 24], [B.OAK_LOG, 12], [I.WATER_BUCKET, 1], [B.BRICKS, 16], [100 + P.POPPY, 6], [100 + P.DAISY, 6]];
      kit.forEach(([id, n], i) => { this.slots[i] = { id, count: n }; });
      this.selected = 0;
      this.render();
    }
    serialize() { return { slots: this.slots.map((s) => (s ? [s.id, s.count] : 0)), selected: this.selected }; }
    deserialize(d) {
      if (!d || !Array.isArray(d.slots)) return false;
      this.slots = new Array(TOTAL).fill(null);
      d.slots.slice(0, TOTAL).forEach((s, i) => { if (s && OM.Items.get(s[0])) this.slots[i] = { id: s[0], count: Math.max(1, Math.min(this.maxOf(s[0]), s[1] | 0)) }; });
      this.selected = Math.max(0, Math.min(HOTBAR - 1, d.selected | 0));
      this.render();
      return true;
    }
  }

  OM.Inventory = Inventory;
})();
