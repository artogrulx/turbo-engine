// ============================================================
// MINECRAFT-STYLE INVENTORY SYSTEM
// ============================================================

const Inventory = (() => {

    // ========================================================
    // ITEM DEFINITIONS
    // ========================================================

    const ITEM_TYPES = {

        grass: {
            id: "grass",
            name: "Grass Block",
            iconClass: "item-grass",
            placeable: true,
            maxStack: 64
        },

        dirt: {
            id: "dirt",
            name: "Dirt",
            iconClass: "item-dirt",
            placeable: true,
            maxStack: 64
        },

        stone: {
            id: "stone",
            name: "Stone",
            iconClass: "item-stone",
            placeable: true,
            maxStack: 64
        },

        sand: {
            id: "sand",
            name: "Sand",
            iconClass: "item-sand",
            placeable: true,
            maxStack: 64
        },

        log: {
            id: "log",
            name: "Oak Log",
            iconClass: "item-log",
            placeable: true,
            maxStack: 64
        },

        leaves: {
            id: "leaves",
            name: "Oak Leaves",
            iconClass: "item-leaves",
            placeable: true,
            maxStack: 64
        }

    };


    // ========================================================
    // INVENTORY DATA
    // ========================================================

    const HOTBAR_SIZE = 9;

    const BACKPACK_SIZE = 27;


    const hotbar = [

        {
            id: "grass",
            count: 64
        },

        {
            id: "dirt",
            count: 64
        },

        {
            id: "stone",
            count: 64
        },

        {
            id: "sand",
            count: 64
        },

        {
            id: "log",
            count: 32
        },

        {
            id: "leaves",
            count: 32
        },

        null,
        null,
        null

    ];


    const backpack =
        new Array(
            BACKPACK_SIZE
        ).fill(null);


    // Some starter supplies.

    backpack[0] = {
        id: "stone",
        count: 32
    };

    backpack[1] = {
        id: "dirt",
        count: 32
    };

    backpack[2] = {
        id: "log",
        count: 16
    };


    // ========================================================
    // STATE
    // ========================================================

    let selectedSlot = 0;

    let inventoryOpen = false;

    let cursorStack = null;

    let nameTimeout = null;


    // ========================================================
    // DOM
    // ========================================================

    let hotbarElement;

    let inventoryGrid;

    let inventoryHotbar;

    let inventoryOverlay;

    let inventoryClose;

    let tooltip;

    let cursorItem;

    let selectedItemName;


    // ========================================================
    // INITIALIZE
    // ========================================================

    function init() {

        hotbarElement =
            document.getElementById(
                "hotbar"
            );


        inventoryGrid =
            document.getElementById(
                "inventory-grid"
            );


        inventoryHotbar =
            document.getElementById(
                "inventory-hotbar"
            );


        inventoryOverlay =
            document.getElementById(
                "inventory-overlay"
            );


        inventoryClose =
            document.getElementById(
                "inventory-close"
            );


        tooltip =
            document.getElementById(
                "item-tooltip"
            );


        cursorItem =
            document.getElementById(
                "cursor-item"
            );


        selectedItemName =
            document.getElementById(
                "selected-item-name"
            );


        buildSlots();

        bindEvents();

        renderAll();

        showSelectedName();

    }


    // ========================================================
    // BUILD SLOT ELEMENTS
    // ========================================================

    function buildSlots() {

        hotbarElement.innerHTML = "";

        inventoryGrid.innerHTML = "";

        inventoryHotbar.innerHTML = "";


        // HUD HOTBAR

        for(
            let i = 0;
            i < HOTBAR_SIZE;
            i++
        ) {

            const slot =
                createSlotElement(
                    "hud",
                    i
                );


            const number =
                document.createElement(
                    "div"
                );


            number.className =
                "slot-number";


            number.textContent =
                i + 1;


            slot.appendChild(
                number
            );


            hotbarElement.appendChild(
                slot
            );

        }


        // BACKPACK

        for(
            let i = 0;
            i < BACKPACK_SIZE;
            i++
        ) {

            inventoryGrid.appendChild(

                createSlotElement(
                    "backpack",
                    i
                )

            );

        }


        // INVENTORY HOTBAR

        for(
            let i = 0;
            i < HOTBAR_SIZE;
            i++
        ) {

            inventoryHotbar.appendChild(

                createSlotElement(
                    "hotbar",
                    i
                )

            );

        }

    }


    // ========================================================
    // CREATE SLOT
    // ========================================================

    function createSlotElement(
        section,
        index
    ) {

        const slot =
            document.createElement(
                "div"
            );


        slot.className =
            "slot inventory-slot";


        slot.dataset.section =
            section;


        slot.dataset.index =
            index;


        return slot;

    }


    // ========================================================
    // GET STACK
    // ========================================================

    function getStack(
        section,
        index
    ) {

        if(
            section === "hotbar" ||
            section === "hud"
        ) {

            return hotbar[index];

        }


        return backpack[index];

    }


    // ========================================================
    // SET STACK
    // ========================================================

    function setStack(
        section,
        index,
        value
    ) {

        if(
            section === "hotbar" ||
            section === "hud"
        ) {

            hotbar[index] =
                value;

        }

        else {

            backpack[index] =
                value;

        }

    }


    // ========================================================
    // RENDER SLOT CONTENT
    // ========================================================

    function renderSlot(
        element,
        stack
    ) {

        const oldIcon =
            element.querySelector(
                ".item-icon"
            );


        const oldCount =
            element.querySelector(
                ".item-count"
            );


        if(oldIcon)
            oldIcon.remove();


        if(oldCount)
            oldCount.remove();


        if(!stack)
            return;


        const type =
            ITEM_TYPES[
                stack.id
            ];


        if(!type)
            return;


        const icon =
            document.createElement(
                "div"
            );


        icon.className =
            "item-icon " +
            type.iconClass;


        element.appendChild(
            icon
        );


        if(
            stack.count > 1
        ) {

            const count =
                document.createElement(
                    "div"
                );


            count.className =
                "item-count";


            count.textContent =
                stack.count;


            element.appendChild(
                count
            );

        }

    }


    // ========================================================
    // RENDER EVERYTHING
    // ========================================================

    function renderAll() {

        // HUD HOTBAR

        const hudSlots =
            hotbarElement.querySelectorAll(
                ".slot"
            );


        hudSlots.forEach(
            (slot, index) => {

                renderSlot(
                    slot,
                    hotbar[index]
                );


                slot.classList.toggle(
                    "selected",
                    index ===
                    selectedSlot
                );

            }
        );


        // BACKPACK

        const backpackSlots =
            inventoryGrid.querySelectorAll(
                ".slot"
            );


        backpackSlots.forEach(
            (slot, index) => {

                renderSlot(
                    slot,
                    backpack[index]
                );

            }
        );


        // INVENTORY HOTBAR

        const inventoryHotbarSlots =
            inventoryHotbar.querySelectorAll(
                ".slot"
            );


        inventoryHotbarSlots.forEach(
            (slot, index) => {

                renderSlot(
                    slot,
                    hotbar[index]
                );


                slot.classList.toggle(
                    "selected",
                    index ===
                    selectedSlot
                );

            }
        );


        renderCursorItem();

    }


    // ========================================================
    // CURSOR ITEM
    // ========================================================

    function renderCursorItem() {

        cursorItem.innerHTML = "";


        if(!cursorStack) {

            cursorItem.style.display =
                "none";

            return;

        }


        const type =
            ITEM_TYPES[
                cursorStack.id
            ];


        if(!type)
            return;


        cursorItem.style.display =
            "block";


        const icon =
            document.createElement(
                "div"
            );


        icon.className =
            "item-icon " +
            type.iconClass;


        cursorItem.appendChild(
            icon
        );


        if(
            cursorStack.count > 1
        ) {

            const count =
                document.createElement(
                    "div"
                );


            count.className =
                "item-count";


            count.textContent =
                cursorStack.count;


            cursorItem.appendChild(
                count
            );

        }

    }


    // ========================================================
    // SLOT CLICK
    // ========================================================

    function handleSlotClick(
        section,
        index
    ) {

        let slotStack =
            getStack(
                section,
                index
            );


        // Nothing in hand:
        // pick up whole stack.

        if(!cursorStack) {

            if(!slotStack)
                return;


            cursorStack =
                slotStack;


            setStack(
                section,
                index,
                null
            );


            renderAll();

            return;

        }


        // Empty target:
        // place entire held stack.

        if(!slotStack) {

            setStack(
                section,
                index,
                cursorStack
            );


            cursorStack = null;


            renderAll();

            return;

        }


        // Same item:
        // merge stacks.

        if(
            slotStack.id ===
            cursorStack.id
        ) {

            const type =
                ITEM_TYPES[
                    slotStack.id
                ];


            const available =
                type.maxStack -
                slotStack.count;


            const amount =
                Math.min(
                    available,
                    cursorStack.count
                );


            slotStack.count +=
                amount;


            cursorStack.count -=
                amount;


            if(
                cursorStack.count <= 0
            ) {

                cursorStack = null;

            }


            renderAll();

            return;

        }


        // Different item:
        // swap stacks.

        const old =
            slotStack;


        setStack(
            section,
            index,
            cursorStack
        );


        cursorStack =
            old;


        renderAll();

    }


    // ========================================================
    // RIGHT CLICK SLOT
    // ========================================================

    function handleSlotRightClick(
        section,
        index
    ) {

        let slotStack =
            getStack(
                section,
                index
            );


        // Pick up half.

        if(
            !cursorStack &&
            slotStack
        ) {

            const amount =
                Math.ceil(
                    slotStack.count /
                    2
                );


            cursorStack = {

                id:
                    slotStack.id,

                count:
                    amount

            };


            slotStack.count -=
                amount;


            if(
                slotStack.count <= 0
            ) {

                setStack(
                    section,
                    index,
                    null
                );

            }


            renderAll();

            return;

        }


        // Place one item.

        if(cursorStack) {

            if(!slotStack) {

                setStack(
                    section,
                    index,
                    {
                        id:
                            cursorStack.id,

                        count: 1
                    }
                );


                cursorStack.count--;

            }

            else if(
                slotStack.id ===
                cursorStack.id
            ) {

                const type =
                    ITEM_TYPES[
                        slotStack.id
                    ];


                if(
                    slotStack.count <
                    type.maxStack
                ) {

                    slotStack.count++;

                    cursorStack.count--;

                }

            }


            if(
                cursorStack &&
                cursorStack.count <= 0
            ) {

                cursorStack = null;

            }


            renderAll();

        }

    }


    // ========================================================
    // SELECT SLOT
    // ========================================================

    function selectSlot(
        index
    ) {

        index =
            (
                index +
                HOTBAR_SIZE
            ) %
            HOTBAR_SIZE;


        selectedSlot =
            index;


        renderAll();

        showSelectedName();

    }


    // ========================================================
    // SHOW SELECTED ITEM
    // ========================================================

    function showSelectedName() {

        clearTimeout(
            nameTimeout
        );


        const stack =
            hotbar[
                selectedSlot
            ];


        if(!stack) {

            selectedItemName.textContent =
                "Empty";

        }

        else {

            selectedItemName.textContent =
                ITEM_TYPES[
                    stack.id
                ].name;

        }


        selectedItemName.classList.add(
            "visible"
        );


        nameTimeout =
            setTimeout(
                () => {

                    selectedItemName
                        .classList
                        .remove(
                            "visible"
                        );

                },
                1100
            );

    }


    // ========================================================
    // OPEN INVENTORY
    // ========================================================

    function open() {

        if(inventoryOpen)
            return;


        inventoryOpen = true;


        inventoryOverlay.classList.add(
            "open"
        );


        if(
            window.Game &&
            Game.unlockPointer
        ) {

            Game.unlockPointer();

        }


        renderAll();

    }


    // ========================================================
    // CLOSE INVENTORY
    // ========================================================

    function close() {

        if(!inventoryOpen)
            return;


        // Return held item to inventory.

        if(cursorStack) {

            addItem(
                cursorStack.id,
                cursorStack.count
            );


            cursorStack = null;

        }


        inventoryOpen = false;


        inventoryOverlay.classList.remove(
            "open"
        );


        tooltip.style.display =
            "none";


        renderAll();

    }


    // ========================================================
    // TOGGLE
    // ========================================================

    function toggle() {

        if(inventoryOpen)
            close();

        else
            open();

    }


    // ========================================================
    // ADD ITEM
    // ========================================================

    function addItem(
        itemId,
        amount = 1
    ) {

        const type =
            ITEM_TYPES[
                itemId
            ];


        if(!type)
            return false;


        let remaining =
            amount;


        // First fill matching stacks.

        const containers = [
            hotbar,
            backpack
        ];


        for(
            const container
            of containers
        ) {

            for(
                let i = 0;
                i < container.length;
                i++
            ) {

                const stack =
                    container[i];


                if(
                    !stack ||
                    stack.id !==
                    itemId
                ) {

                    continue;

                }


                const available =
                    type.maxStack -
                    stack.count;


                if(
                    available <= 0
                ) {

                    continue;

                }


                const moved =
                    Math.min(
                        available,
                        remaining
                    );


                stack.count +=
                    moved;


                remaining -=
                    moved;


                if(
                    remaining <= 0
                ) {

                    renderAll();

                    return true;

                }

            }

        }


        // Then use empty slots.

        for(
            const container
            of containers
        ) {

            for(
                let i = 0;
                i < container.length;
                i++
            ) {

                if(container[i])
                    continue;


                const moved =
                    Math.min(
                        type.maxStack,
                        remaining
                    );


                container[i] = {

                    id:
                        itemId,

                    count:
                        moved

                };


                remaining -=
                    moved;


                if(
                    remaining <= 0
                ) {

                    renderAll();

                    return true;

                }

            }

        }


        renderAll();


        return (
            remaining <= 0
        );

    }


    // ========================================================
    // REMOVE FROM SELECTED STACK
    // ========================================================

    function consumeSelected(
        amount = 1
    ) {

        const stack =
            hotbar[
                selectedSlot
            ];


        if(!stack)
            return false;


        if(
            stack.count <
            amount
        ) {

            return false;

        }


        stack.count -=
            amount;


        if(
            stack.count <= 0
        ) {

            hotbar[
                selectedSlot
            ] = null;

        }


        renderAll();


        return true;

    }


    // ========================================================
    // SELECTED ITEM
    // ========================================================

    function getSelectedItem() {

        return hotbar[
            selectedSlot
        ];

    }


    function getSelectedType() {

        const stack =
            getSelectedItem();


        if(!stack)
            return null;


        return ITEM_TYPES[
            stack.id
        ];

    }


    // ========================================================
    // TOOLTIP
    // ========================================================

    function showTooltip(
        stack,
        x,
        y
    ) {

        if(!stack) {

            tooltip.style.display =
                "none";

            return;

        }


        const type =
            ITEM_TYPES[
                stack.id
            ];


        tooltip.innerHTML =
            type.name +
            "<br><small>" +
            stack.count +
            " / " +
            type.maxStack +
            "</small>";


        tooltip.style.display =
            "block";


        tooltip.style.left =
            (x + 14) +
            "px";


        tooltip.style.top =
            (y + 14) +
            "px";

    }


    // ========================================================
    // EVENTS
    // ========================================================

    function bindEvents() {

        document.addEventListener(
            "keydown",
            e => {

                // E

                if(
                    e.code ===
                    "KeyE"
                ) {

                    e.preventDefault();

                    toggle();

                    return;

                }


                // ESC closes inventory.

                if(
                    e.code ===
                    "Escape" &&
                    inventoryOpen
                ) {

                    close();

                    return;

                }


                // 1 - 9

                if(
                    e.code.startsWith(
                        "Digit"
                    )
                ) {

                    const number =
                        Number(
                            e.code.replace(
                                "Digit",
                                ""
                            )
                        );


                    if(
                        number >= 1 &&
                        number <= 9
                    ) {

                        selectSlot(
                            number - 1
                        );

                    }

                }

            }
        );


        // Mouse wheel.

        document.addEventListener(
            "wheel",
            e => {

                if(inventoryOpen)
                    return;


                if(e.deltaY > 0) {

                    selectSlot(
                        selectedSlot +
                        1
                    );

                }

                else {

                    selectSlot(
                        selectedSlot -
                        1
                    );

                }

            },
            {
                passive: true
            }
        );


        // Inventory clicks.

        inventoryOverlay.addEventListener(
            "click",
            e => {

                const slot =
                    e.target.closest(
                        ".inventory-slot"
                    );


                if(!slot)
                    return;


                const section =
                    slot.dataset.section;


                const index =
                    Number(
                        slot.dataset.index
                    );


                handleSlotClick(
                    section,
                    index
                );

            }
        );


        inventoryOverlay.addEventListener(
            "contextmenu",
            e => {

                const slot =
                    e.target.closest(
                        ".inventory-slot"
                    );


                if(!slot)
                    return;


                e.preventDefault();


                handleSlotRightClick(

                    slot.dataset.section,

                    Number(
                        slot.dataset.index
                    )

                );

            }
        );


        // Tooltip.

        inventoryOverlay.addEventListener(
            "mousemove",
            e => {

                const slot =
                    e.target.closest(
                        ".inventory-slot"
                    );


                if(!slot) {

                    tooltip.style.display =
                        "none";

                    return;

                }


                const stack =
                    getStack(

                        slot.dataset.section,

                        Number(
                            slot.dataset.index
                        )

                    );


                showTooltip(
                    stack,
                    e.clientX,
                    e.clientY
                );

            }
        );


        // Cursor item follows mouse.

        document.addEventListener(
            "mousemove",
            e => {

                cursorItem.style.left =
                    e.clientX +
                    "px";


                cursorItem.style.top =
                    e.clientY +
                    "px";

            }
        );


        inventoryClose.addEventListener(
            "click",
            e => {

                e.stopPropagation();

                close();

            }
        );

    }


    // ========================================================
    // PUBLIC API
    // ========================================================

    return {

        init,

        open,

        close,

        toggle,

        addItem,

        consumeSelected,

        selectSlot,

        getSelectedItem,

        getSelectedType,

        isOpen:
            () =>
                inventoryOpen,

        getSelectedIndex:
            () =>
                selectedSlot,

        itemTypes:
            ITEM_TYPES

    };

})();


// Start inventory after HTML exists.

document.addEventListener(
    "DOMContentLoaded",
    () => {

        Inventory.init();

    }
);