// Simple inventory system (no Minecraft, just your own style)

const HOTBAR_SIZE = 9;
const INV_ROWS = 4;
const INV_COLS = 9;
const INV_SIZE = INV_ROWS * INV_COLS;

const hotbarSlots = new Array(HOTBAR_SIZE).fill(null);
const inventorySlots = new Array(INV_SIZE).fill(null);

let selectedHotbarIndex = 0;
let inventoryOpen = false;

/* Example items */
const ITEM_TYPES = {
  dirt:  { id: "dirt",  name: "Dirt",  color: "#8d6e63" },
  stone: { id: "stone", name: "Stone", color: "#9e9e9e" },
  wood:  { id: "wood",  name: "Wood",  color: "#6d4c41" }
};

function createItem(typeId, count) {
  return { type: ITEM_TYPES[typeId], count };
}

/* Seed some items */
hotbarSlots[0] = createItem("dirt", 64);
hotbarSlots[1] = createItem("stone", 32);
hotbarSlots[2] = createItem("wood", 16);

inventorySlots[0] = createItem("dirt", 10);
inventorySlots[5] = createItem("stone", 20);
inventorySlots[15] = createItem("wood", 5);

/* DOM references */
const hotbarEl = document.getElementById("hotbar");
const invPanelEl = document.getElementById("inventory-panel");
const invGridEl = document.getElementById("inventory-grid");

/* Build inventory grid slots */
for (let i = 0; i < INV_SIZE; i++) {
  const slot = document.createElement("div");
  slot.className = "slot";
  slot.dataset.invSlot = i;
  invGridEl.appendChild(slot);
}

/* Render functions */
function renderSlot(el, item) {
  el.innerHTML = "";
  if (!item) return;

  const icon = document.createElement("div");
  icon.className = "item-icon";
  icon.style.background = item.type.color;
  el.appendChild(icon);

  if (item.count > 1) {
    const count = document.createElement("div");
    count.className = "item-count";
    count.textContent = item.count;
    el.appendChild(count);
  }
}

function renderHotbar() {
  const slots = hotbarEl.querySelectorAll(".slot");
  slots.forEach((el, i) => {
    el.classList.toggle("selected", i === selectedHotbarIndex);
    renderSlot(el, hotbarSlots[i]);
  });
}

function renderInventory() {
  const slots = invGridEl.querySelectorAll(".slot");
  slots.forEach((el, i) => {
    renderSlot(el, inventorySlots[i]);
  });
}

/* Toggle inventory with E */
window.addEventListener("keydown", e => {
  if (e.key.toLowerCase() === "e") {
    inventoryOpen = !inventoryOpen;
    invPanelEl.style.display = inventoryOpen ? "block" : "none";
  }

  // Number keys 1–9 select hotbar
  if (!isNaN(e.key) && e.key !== "0") {
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < HOTBAR_SIZE) {
      selectedHotbarIndex = idx;
      renderHotbar();
    }
  }
});

/* Click to move items between inventory and hotbar */
hotbarEl.addEventListener("click", e => {
  const slotEl = e.target.closest(".slot");
  if (!slotEl) return;
  const index = parseInt(slotEl.dataset.slot, 10);
  // Simple: cycle item type for demo
  const current = hotbarSlots[index];
  if (!current) {
    hotbarSlots[index] = createItem("dirt", 1);
  } else if (current.type.id === "dirt") {
    hotbarSlots[index] = createItem("stone", 1);
  } else if (current.type.id === "stone") {
    hotbarSlots[index] = createItem("wood", 1);
  } else {
    hotbarSlots[index] = null;
  }
  renderHotbar();
});

invGridEl.addEventListener("click", e => {
  const slotEl = e.target.closest(".slot");
  if (!slotEl) return;
  const index = parseInt(slotEl.dataset.invSlot, 10);
  // Simple: toggle dirt item
  inventorySlots[index] = inventorySlots[index]
    ? null
    : createItem("dirt", 5);
  renderInventory();
});

/* Initial render */
renderHotbar();
renderInventory();
