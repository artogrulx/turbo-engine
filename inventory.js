// inventory.js  — drop-in swap

// Toggle inventory with E key
let inventoryOpen = false;

document.addEventListener("keydown", (e) => {
    if (e.key === "e" || e.key === "E") {
        inventoryOpen = !inventoryOpen;
        const inv = document.getElementById("inventory");
        if (!inv) return; // safety
        inv.style.display = inventoryOpen ? "grid" : "none";
    }
});

// Select hotbar slot with number keys 1–9
document.addEventListener("keydown", (e) => {
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
        highlightSlot(num - 1);
    }
});

function highlightSlot(index) {
    for (let i = 0; i < 9; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if (!slot) continue; // safety
        slot.style.borderColor = "#555";
    }
    const active = document.getElementById(`slot-${index}`);
    if (active) active.style.borderColor = "yellow";
}

// Default selected slot
highlightSlot(0);
