/* Open Meadow — inventory.js
 * Inventory model (9 hotbar + 27 storage slots, stacks up to 64, tools that wear out) and its screens:
 *   - hotbar with icons, counts, durability bars, selection frame and item-name popup
 *   - inventory screen (E): click to pick up / place / swap / merge, right-click to split or place one,
 *     Shift+click to quick-move, 1-9 while hovering to swap with a hotbar slot, trash slot, sort
 *   - crafting: a 2x2 grid in the inventory and a 3x3 grid at a crafting table, both with a result slot
 *     (the rules live in engine/crafting.js)
 *   - furnace screen: input / fuel / output slots with a flame and a progress arrow
 *   - a recipe book listing every crafting and smelting recipe
 * The inventory never touches pointer lock itself; main.js owns that. */
(function () {
  'use strict';
  const OM = (window.OM = window.OM || {});
  const HOTBAR = 9, TOTAL = 36;
  // Where each grid's cells sit inside the 3x3 that the recipe matcher looks at.
  const GRID_CELLS = { inv: [0, 1, 3, 4], table: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  const TITLES = { inv: 'Inventory', table: 'Crafting Table', furnace: 'Furnace' };

  const copy = (s, n) => { const c = { id: s.id, count: n === undefined ? s.count : n }; if (s.dmg) c.dmg = s.dmg; return c; };
  const encode = (s) => (s ? (s.dmg ? [s.id, s.count, s.dmg] : [s.id, s.count]) : 0);

  class Inventory {
    constructor(dom) {
      this.dom = dom;
      this.slots = new Array(TOTAL).fill(null);
      this.selected = 0;
      this.cursor = null;
      this.isOpen = false;
      this.mode = 'inv';                                     // 'inv' | 'table' | 'furnace'
      this.grids = { inv: new Array(4).fill(null), table: new Array(9).fill(null) };
      this.furnace = null;                                   // the OM.Crafting.Furnace shown in furnace mode
      this.hovered = null;                                   // { area, index } under the pointer
      this.onChange = null;
      this.notify = null;                                    // (text) => void, set by main.js
      this.nameTimer = 0;
      this.hotbarEls = [];
      this.els = { inv: new Array(TOTAL), craft: [], furn: [], result: null };
      this.recipesBuilt = false;
      this.buildDOM();
      this.render();
    }

    // ------------------------------------------------------------ DOM
    makeSlot(area, index, extraClass) {
      const el = document.createElement('div');
      el.className = 'slot' + (extraClass ? ' ' + extraClass : '');
      el.dataset.area = area; el.dataset.index = String(index);
      this.decorate(el);
      return el;
    }
    /** Adds the icon / count / durability children every slot needs. */
    decorate(el) {
      if (!el.querySelector('.slot-icon')) {
        const img = document.createElement('img');
        img.className = 'slot-icon'; img.alt = ''; img.draggable = false;
        el.appendChild(img);
      }
      if (!el.querySelector('.slot-count')) {
        const cnt = document.createElement('span');
        cnt.className = 'slot-count';
        el.appendChild(cnt);
      }
      if (!el.querySelector('.slot-dur')) {
        const dur = document.createElement('div');
        dur.className = 'slot-dur'; dur.appendChild(document.createElement('i'));
        el.appendChild(dur);
      }
      return el;
    }
    buildDOM() {
      const d = this.dom;
      d.hotbar.innerHTML = '';
      for (let i = 0; i < HOTBAR; i++) {
        const el = this.makeSlot('inv', i, 'hotbar-slot');
        const key = document.createElement('span');
        key.className = 'slot-key'; key.textContent = String(i + 1);
        el.appendChild(key);
        d.hotbar.appendChild(el);
        this.hotbarEls.push(el);
      }
      d.main.innerHTML = ''; d.bar.innerHTML = '';
      for (let i = HOTBAR; i < TOTAL; i++) { const el = this.makeSlot('inv', i); d.main.appendChild(el); this.els.inv[i] = el; }
      for (let i = 0; i < HOTBAR; i++) { const el = this.makeSlot('inv', i); d.bar.appendChild(el); this.els.inv[i] = el; }
      this.decorate(d.cursor);
      if (d.craftResult) { d.craftResult.dataset.area = 'result'; d.craftResult.dataset.index = '0'; this.decorate(d.craftResult); this.els.result = d.craftResult; }
      [d.furnIn, d.furnFuel, d.furnOut].forEach((el, i) => {
        if (!el) return;
        el.dataset.area = 'furn'; el.dataset.index = String(i);
        this.decorate(el);
        this.els.furn[i] = el;
      });

      d.screen.addEventListener('mousedown', (e) => {
        const el = e.target.closest('.slot');
        if (!el || !this.isOpen) return;
        e.preventDefault();
        if (el === d.trash) { if (this.cursor) { this.cursor = null; this.render(); } return; }
        if (!el.dataset.area) return;
        this.click(el.dataset.area, Number(el.dataset.index), e.button, e.shiftKey);
      });
      d.screen.addEventListener('contextmenu', (e) => e.preventDefault());
      d.screen.addEventListener('mousemove', (e) => this.moveCursor(e.clientX, e.clientY));
      d.screen.addEventListener('mouseover', (e) => {
        const el = e.target.closest('.slot');
        if (!el || !el.dataset.area) { this.hovered = null; this.showTooltip(null); return; }
        this.hovered = { area: el.dataset.area, index: Number(el.dataset.index) };
        this.showTooltip(this.stackAt(this.hovered.area, this.hovered.index), el);
      });
      d.screen.addEventListener('mouseleave', () => { this.hovered = null; this.showTooltip(null); });
      if (d.sortBtn) d.sortBtn.addEventListener('click', (e) => { e.preventDefault(); this.sort(); });
      if (d.recipesBtn) d.recipesBtn.addEventListener('click', (e) => { e.preventDefault(); this.toggleRecipes(); });
    }
    buildCraftGrid() {
      const d = this.dom, n = this.mode === 'table' ? 9 : 4, side = n === 9 ? 3 : 2;
      d.craftGrid.innerHTML = '';
      d.craftGrid.style.gridTemplateColumns = `repeat(${side}, var(--slot))`;
      this.els.craft = [];
      for (let i = 0; i < n; i++) { const el = this.makeSlot('craft', i); d.craftGrid.appendChild(el); this.els.craft.push(el); }
    }
    moveCursor(x, y) {
      const c = this.dom.cursor;
      c.style.transform = `translate(${x - 26}px, ${y - 26}px)`;
    }
    elAt(h) {
      if (!h) return null;
      if (h.area === 'inv') return this.els.inv[h.index];
      if (h.area === 'craft') return this.els.craft[h.index];
      if (h.area === 'furn') return this.els.furn[h.index];
      return this.els.result;
    }
    showTooltip(stack, el) {
      const t = this.dom.tooltip;
      if (!stack || !el) { t.classList.remove('show'); return; }
      const def = OM.Items.get(stack.id);
      let text = def ? def.name : '';
      if (def && def.dur) text += `  ·  ${def.dur - (stack.dmg || 0)} / ${def.dur} uses left`;
      t.textContent = text;
      const r = el.getBoundingClientRect();
      t.style.left = `${r.left + r.width / 2}px`;
      t.style.top = `${r.top - 8}px`;
      t.classList.add('show');
    }
    renderSlot(el, stack) {
      if (!el) return;
      const img = el.querySelector('.slot-icon'), cnt = el.querySelector('.slot-count'), dur = el.querySelector('.slot-dur');
      if (stack) {
        const def = OM.Items.get(stack.id);
        if (img.dataset.id !== String(stack.id)) { img.src = def && def.icon ? def.icon : ''; img.dataset.id = String(stack.id); }
        img.style.visibility = 'visible';
        cnt.textContent = stack.count > 1 ? String(stack.count) : '';
        if (dur) {
          if (def && def.dur && stack.dmg > 0) {
            const f = Math.max(0, 1 - stack.dmg / def.dur), bar = dur.firstChild;
            dur.style.display = 'block';
            bar.style.width = (f * 100).toFixed(1) + '%';
            bar.style.background = `hsl(${Math.round(f * 118)}, 78%, 48%)`;
          } else dur.style.display = 'none';
        }
      } else {
        img.style.visibility = 'hidden';
        img.dataset.id = '';
        cnt.textContent = '';
        if (dur) dur.style.display = 'none';
      }
    }
    render() {
      for (let i = 0; i < HOTBAR; i++) {
        this.renderSlot(this.hotbarEls[i], this.slots[i]);
        this.hotbarEls[i].classList.toggle('selected', i === this.selected);
      }
      if (this.isOpen) {
        for (let i = 0; i < TOTAL; i++) this.renderSlot(this.els.inv[i], this.slots[i]);
        if (this.mode === 'furnace') this.renderFurnace();
        else {
          const g = this.grid();
          for (let i = 0; i < g.length; i++) this.renderSlot(this.els.craft[i], g[i]);
          this.renderSlot(this.els.result, this.craftResult());
        }
      }
      const c = this.dom.cursor;
      if (this.cursor) { this.renderSlot(c, this.cursor); c.classList.add('show'); }
      else c.classList.remove('show');
      if (this.isOpen && this.hovered) this.showTooltip(this.stackAt(this.hovered.area, this.hovered.index), this.elAt(this.hovered));
      if (this.onChange) this.onChange();
    }
    renderFurnace() {
      const f = this.furnace;
      if (!f) return;
      for (let i = 0; i < 3; i++) this.renderSlot(this.els.furn[i], f.slots[i]);
      const flame = this.dom.furnFlame, prog = this.dom.furnProg;
      if (flame) flame.style.setProperty('--fill', f.burn > 0 && f.burnMax > 0 ? Math.min(1, f.burn / f.burnMax).toFixed(3) : '0');
      if (prog) prog.style.setProperty('--fill', Math.min(1, f.prog / OM.Crafting.SMELT_SECONDS).toFixed(3));
    }
    /** Called every frame by main.js: keeps an open furnace screen in step with the fire. */
    update() { if (this.isOpen && this.mode === 'furnace' && this.furnace) this.renderFurnace(); }

    // ------------------------------------------------------------ crafting model
    grid() { return this.grids[this.mode === 'table' ? 'table' : 'inv']; }
    craftResult() {
      if (this.mode === 'furnace') return null;
      const cells = new Array(9).fill(null), map = GRID_CELLS[this.mode === 'table' ? 'table' : 'inv'];
      this.grid().forEach((s, i) => { cells[map[i]] = s; });
      return OM.Crafting.find(cells);
    }
    stackAt(area, i) {
      if (area === 'inv') return this.slots[i] || null;
      if (area === 'craft') return this.grid()[i] || null;
      if (area === 'furn') return this.furnace ? this.furnace.slots[i] || null : null;
      if (area === 'result') return this.craftResult();
      return null;
    }
    put(area, i, s) {
      if (area === 'inv') this.slots[i] = s;
      else if (area === 'craft') this.grid()[i] = s;
      else if (area === 'furn' && this.furnace) this.furnace.slots[i] = s;
    }
    /** Furnace slots only take what belongs there; the output slot only gives. */
    accepts(area, i, id) {
      if (area === 'furn') { const C = OM.Crafting; return i === 0 ? C.SMELT.has(id) : i === 1 ? C.FUEL.has(id) : false; }
      return area !== 'result';
    }
    consumeGrid() {
      const g = this.grid();
      for (let i = 0; i < g.length; i++) if (g[i] && --g[i].count <= 0) g[i] = null;
    }
    /** Takes one result out of the grid: onto the cursor, or (shift) straight into the bag. */
    craftOne(toCursor) {
      const r = this.craftResult();
      if (!r) return false;
      const max = this.maxOf(r.id);
      if (toCursor) {
        const c = this.cursor;
        if (c) { if (c.id !== r.id || max <= 1 || c.count + r.count > max) return false; c.count += r.count; }
        else this.cursor = { id: r.id, count: r.count };
      } else {
        if (this.roomFor(r.id) < r.count) return false;
        this.addQuiet(r.id, r.count);
      }
      this.consumeGrid();
      return true;
    }
    clickResult(shift) {
      if (!this.craftResult()) return;
      if (shift) { let guard = 0; while (guard++ < 700 && this.craftOne(false)) { /* craft until the ingredients or the room run out */ } }
      else this.craftOne(true);
      this.render();
    }

    // ------------------------------------------------------------ model
    maxOf(id) { const d = OM.Items.get(id); return d ? d.max : 64; }
    roomFor(id) {
      const max = this.maxOf(id);
      let room = 0;
      for (const s of this.slots) room += !s ? max : s.id === id && !s.dmg ? Math.max(0, max - s.count) : 0;
      return room;
    }
    addQuiet(id, n) {
      if (!OM.Items.get(id) || n <= 0) return n;
      const max = this.maxOf(id);
      for (let i = 0; i < TOTAL && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && !s.dmg && s.count < max) { const k = Math.min(n, max - s.count); s.count += k; n -= k; }
      }
      for (let i = 0; i < TOTAL && n > 0; i++) {
        if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { id, count: k }; n -= k; }
      }
      return n;
    }
    /** Adds items to the bag; returns how many did not fit. */
    add(id, n) { const left = this.addQuiet(id, n); this.render(); return left; }
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
    /** Wears the selected tool; returns true when it broke (and is gone). */
    damageSelected(n) {
      const s = this.slots[this.selected], def = s ? OM.Items.get(s.id) : null;
      if (!def || !def.dur) return false;
      s.dmg = (s.dmg || 0) + n;
      const broke = s.dmg >= def.dur;
      if (broke) this.slots[this.selected] = null;
      this.render();
      return broke;
    }
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
    click(area, i, button, shift) {
      if (area === 'result') { if (button === 0 || button === 2) this.clickResult(shift); return; }
      if (button === 0) this.leftClick(area, i, shift);
      else if (button === 2) this.rightClick(area, i);
    }
    leftClick(area, i, shift) {
      const s = this.stackAt(area, i), c = this.cursor;
      if (shift) { if (s) this.quickMove(area, i); return; }
      if (area === 'furn' && i === 2) {                      // the furnace output only gives
        if (s && !c) { this.cursor = s; this.put(area, i, null); }
        else if (s && c && c.id === s.id && this.maxOf(c.id) > 1 && c.count + s.count <= this.maxOf(c.id)) { c.count += s.count; this.put(area, i, null); }
        this.render();
        return;
      }
      if (!c && s) { this.cursor = s; this.put(area, i, null); }
      else if (c && !s) { if (!this.accepts(area, i, c.id)) return; this.put(area, i, c); this.cursor = null; }
      else if (c && s) {
        if (!this.accepts(area, i, c.id)) return;
        if (c.id === s.id && this.maxOf(s.id) > 1) {
          const k = Math.min(c.count, this.maxOf(s.id) - s.count);
          s.count += k; c.count -= k;
          if (c.count <= 0) this.cursor = null;
        } else { this.put(area, i, c); this.cursor = s; }
      }
      this.render();
    }
    rightClick(area, i) {
      if (area === 'furn' && i === 2) { this.leftClick(area, i, false); return; }
      const s = this.stackAt(area, i), c = this.cursor;
      if (!c && s) {
        const k = Math.ceil(s.count / 2);
        this.cursor = copy(s, k);
        s.count -= k;
        if (s.count <= 0) this.put(area, i, null);
      } else if (c && !s) {
        if (!this.accepts(area, i, c.id)) return;
        this.put(area, i, copy(c, 1));
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
        if (s && s.id === stack.id && !s.dmg && !stack.dmg && s.count < max) { const k = Math.min(stack.count, max - s.count); s.count += k; stack.count -= k; }
      }
      for (let i = from; i < to && stack.count > 0; i++) {
        if (!this.slots[i]) { this.slots[i] = copy(stack); stack.count = 0; }
      }
    }
    /** Moves a furnace-bound item (something to smelt, or fuel) from the bag into the open furnace. */
    toFurnace(i) {
      const s = this.slots[i], C = OM.Crafting, f = this.furnace;
      if (!s || !f) return false;
      const target = C.SMELT.has(s.id) ? 0 : C.FUEL.has(s.id) ? 1 : -1;
      if (target < 0) return false;
      const dst = f.slots[target];
      if (!dst) { f.slots[target] = s; this.slots[i] = null; }
      else if (dst.id === s.id) {
        const k = Math.min(s.count, this.maxOf(s.id) - dst.count);
        if (k > 0) { dst.count += k; s.count -= k; if (s.count <= 0) this.slots[i] = null; }
      } else return false;
      this.render();
      return true;
    }
    quickMove(area, i) {
      const s = this.stackAt(area, i);
      if (!s) return;
      if (area === 'inv') {
        if (this.mode === 'furnace' && this.toFurnace(i)) return;
        this.slots[i] = null;
        if (i < HOTBAR) this.moveInto(s, HOTBAR, TOTAL); else this.moveInto(s, 0, HOTBAR);
        if (s.count > 0) {
          // nowhere to go: put the remainder back where it came from
          if (!this.slots[i]) this.slots[i] = s; else this.moveInto(s, 0, TOTAL);
        }
      } else {
        this.put(area, i, null);                             // crafting grid / furnace -> bag
        this.moveInto(s, HOTBAR, TOTAL);
        if (s.count > 0) this.moveInto(s, 0, HOTBAR);
        if (s.count > 0) this.put(area, i, s);
      }
      this.render();
    }
    swapWithHotbar(n) {
      const h = this.hovered;
      if (!h || n < 0 || n >= HOTBAR || h.area === 'result' || (h.area === 'inv' && h.index === n)) return;
      const a = this.stackAt(h.area, h.index), b = this.slots[n];
      if (b && !this.accepts(h.area, h.index, b.id)) return;
      this.put(h.area, h.index, b);
      this.slots[n] = a;
      this.render();
    }
    sort() {
      const keep = [], merged = new Map();
      for (let i = HOTBAR; i < TOTAL; i++) {
        const s = this.slots[i];
        this.slots[i] = null;
        if (!s) continue;
        if (this.maxOf(s.id) <= 1) keep.push(s); else merged.set(s.id, (merged.get(s.id) || 0) + s.count);
      }
      const ids = Array.from(merged.keys()).sort((a, b) => a - b);
      let k = HOTBAR;
      for (const id of ids) {
        let n = merged.get(id);
        const max = this.maxOf(id);
        while (n > 0 && k < TOTAL) { const c = Math.min(n, max); this.slots[k++] = { id, count: c }; n -= c; }
      }
      keep.sort((a, b) => a.id - b.id);
      for (const s of keep) { if (k < TOTAL) this.slots[k++] = s; else this.moveInto(s, 0, TOTAL); }
      this.render();
    }

    // ------------------------------------------------------------ recipe book
    toggleRecipes(force) {
      const d = this.dom;
      if (!d.recipePanel) return;
      const show = force === undefined ? d.recipePanel.classList.contains('hidden') : !!force;
      if (show && !this.recipesBuilt) this.buildRecipes();
      d.recipePanel.classList.toggle('hidden', !show);
      if (d.recipesBtn) d.recipesBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
    }
    buildRecipes() {
      const C = OM.Crafting, panel = this.dom.recipePanel;
      this.recipesBuilt = true;
      panel.innerHTML = '';
      const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
      const first = (spec) => (Array.isArray(spec) ? spec[0] : spec);
      const names = (spec) => (Array.isArray(spec) ? spec : [spec]).map((id) => OM.Items.get(id).name).join(' or ');
      const cell = (spec) => {
        const el = h('div', 'rcell'), d = OM.Items.get(first(spec));
        if (d && d.icon) { const im = new Image(); im.src = d.icon; im.alt = ''; im.draggable = false; el.appendChild(im); }
        el.title = names(spec);
        return el;
      };
      panel.appendChild(h('h2', null, 'Recipes'));
      panel.appendChild(h('p', 'muted', 'Make small things in the 2×2 grid of your inventory. Anything bigger needs a crafting table (3×3). Shaped recipes also work mirrored.'));
      panel.appendChild(h('div', 'inv-label', 'Crafting'));
      for (const r of C.recipes) {
        const row = h('div', 'recipe'), grid = h('div', 'rgrid');
        if (r.list) {
          grid.style.gridTemplateColumns = `repeat(${r.list.length}, 30px)`;
          r.list.forEach((spec) => grid.appendChild(cell(spec)));
        } else {
          grid.style.gridTemplateColumns = `repeat(${r.w}, 30px)`;
          for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
            const ch = r.rows[y].charAt(x) || ' ';
            grid.appendChild(ch === ' ' ? h('div', 'rcell empty') : cell(r.key[ch]));
          }
        }
        const out = cell(r.out);
        if (r.count > 1) out.appendChild(h('span', 'rcount', String(r.count)));
        row.appendChild(grid);
        row.appendChild(h('span', 'rarrow', '→'));
        row.appendChild(out);
        row.appendChild(h('div', 'rname', OM.Items.get(r.out).name + (!r.list && (r.w > 2 || r.h > 2) ? ' · table' : '')));
        panel.appendChild(row);
      }
      panel.appendChild(h('div', 'inv-label', 'Furnace (' + C.SMELT_SECONDS + ' s per item)'));
      for (const [from, to] of C.SMELT) {
        const row = h('div', 'recipe');
        row.appendChild(cell(from));
        row.appendChild(h('span', 'rarrow', '→'));
        row.appendChild(cell(to));
        row.appendChild(h('div', 'rname', OM.Items.get(from).name + ' → ' + OM.Items.get(to).name));
        panel.appendChild(row);
      }
      panel.appendChild(h('div', 'inv-label', 'Fuel (seconds of fire)'));
      const fuels = h('div', 'rfuels');
      for (const [id, secs] of C.FUEL) {
        const c = cell(id);
        c.title = OM.Items.get(id).name + ' — burns ' + secs + ' s';
        c.appendChild(h('span', 'rcount', String(secs)));
        fuels.appendChild(c);
      }
      panel.appendChild(fuels);
      panel.appendChild(h('p', 'muted', 'Tools: a better pickaxe digs deeper — wood and stone for coal and iron, iron for diamonds. Right-click a crafting table or furnace to use it.'));
    }

    // ------------------------------------------------------------ open/close
    /** mode: 'inv' (E), 'table' (crafting table) or 'furnace' (pass the furnace to show). */
    open(mode, furnace) {
      if (this.isOpen) return;
      this.mode = mode === 'table' || (mode === 'furnace' && furnace) ? mode : 'inv';
      this.furnace = this.mode === 'furnace' ? furnace : null;
      this.isOpen = true;
      const d = this.dom;
      if (d.title) d.title.textContent = TITLES[this.mode];
      d.craft.classList.toggle('hidden', this.mode === 'furnace');
      d.furnace.classList.toggle('hidden', this.mode !== 'furnace');
      if (this.mode !== 'furnace') this.buildCraftGrid();
      d.screen.classList.remove('hidden');
      this.render();
    }
    close() {
      if (!this.isOpen) return;
      // Ingredients go back to the bag; whatever does not fit stays in the grid / in the hand for next time.
      if (this.mode !== 'furnace') {
        const g = this.grid();
        for (let i = 0; i < g.length; i++) { const s = g[i]; if (s) { this.moveInto(s, 0, TOTAL); if (s.count <= 0) g[i] = null; } }
      }
      const c = this.cursor;
      if (c) { this.moveInto(c, 0, TOTAL); if (c.count <= 0) this.cursor = null; }
      if (this.notify && (this.cursor || (this.mode !== 'furnace' && this.grid().some(Boolean)))) this.notify('Your bag is full — some items stayed in the crafting grid or in your hand');
      this.isOpen = false;
      this.hovered = null;
      this.furnace = null;
      this.showTooltip(null);
      this.dom.screen.classList.add('hidden');
      this.render();
    }

    // ------------------------------------------------------------ persistence
    starterKit() {
      const B = OM.B, I = OM.I, P = OM.P;
      this.slots.fill(null);
      this.grids.inv.fill(null); this.grids.table.fill(null);
      this.cursor = null;
      const kit = [[B.PLANKS, 32], [B.COBBLE, 32], [B.GLASS, 16], [B.STONE_BRICKS, 24], [B.OAK_LOG, 12], [I.WATER_BUCKET, 1], [B.BRICKS, 16], [100 + P.POPPY, 6], [100 + P.DAISY, 6]];
      kit.forEach(([id, n], i) => { this.slots[i] = { id, count: n }; });
      this.selected = 0;
      this.render();
    }
    serialize() {
      return {
        slots: this.slots.map(encode), selected: this.selected,
        grids: { inv: this.grids.inv.map(encode), table: this.grids.table.map(encode) },
        cursor: encode(this.cursor)
      };
    }
    decode(s) {
      if (!Array.isArray(s)) return null;
      const def = OM.Items.get(s[0]);
      if (!def) return null;
      const out = { id: s[0], count: Math.max(1, Math.min(def.max, s[1] | 0)) };
      if (def.dur && s[2] > 0) out.dmg = Math.min(def.dur - 1, s[2] | 0);
      return out;
    }
    deserialize(d) {
      if (!d || !Array.isArray(d.slots)) return false;
      this.slots = new Array(TOTAL).fill(null);
      d.slots.slice(0, TOTAL).forEach((s, i) => { this.slots[i] = this.decode(s); });
      this.selected = Math.max(0, Math.min(HOTBAR - 1, d.selected | 0));
      for (const key of ['inv', 'table']) {
        this.grids[key] = new Array(key === 'table' ? 9 : 4).fill(null);
        const saved = d.grids && Array.isArray(d.grids[key]) ? d.grids[key] : [];
        saved.slice(0, this.grids[key].length).forEach((s, i) => { this.grids[key][i] = this.decode(s); });
      }
      this.cursor = this.decode(d.cursor);
      if (this.cursor) { this.moveInto(this.cursor, 0, TOTAL); if (this.cursor.count <= 0) this.cursor = null; }
      this.render();
      return true;
    }
  }

  OM.Inventory = Inventory;
})();
