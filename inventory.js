// Toggle inventory with E key
let inventoryOpen = false;

document.addEventListener("keydown", (e) => {
    if (e.key === "e" || e.key === "E") {
        inventoryOpen = !inventoryOpen;
        document.getElementById("inventory").style.display =
            inventoryOpen ? "grid" : "none";
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
        document.getElementById(`slot-${i}`).style.borderColor = "#555";
    }
    document.getElementById(`slot-${index}`).style.borderColor = "yellow";
}

// Default selected slot
highlightSlot(0);
