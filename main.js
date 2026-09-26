// ============================================================
// BLOCK WORLD
// THREE.JS MINECRAFT-STYLE WORLD ENGINE
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CHUNK_SIZE = 16;

const RENDER_DISTANCE = 3;

const SEA_LEVEL = 0;

const PLAYER_HEIGHT = 1.7;

const PLAYER_RADIUS = 0.30;

const WALK_SPEED = 5.5;

const GRAVITY = 24;

const JUMP_FORCE = 8.5;

const REACH_DISTANCE = 6;


// ============================================================
// SCENE
// ============================================================

const scene =
    new THREE.Scene();


scene.background =
    new THREE.Color(
        0x8fc9ff
    );


scene.fog =
    new THREE.Fog(
        0xaed7ef,
        55,
        125
    );


// ============================================================
// CAMERA
// ============================================================

const camera =
    new THREE.PerspectiveCamera(

        75,

        window.innerWidth /
        window.innerHeight,

        0.1,

        300

    );


// ============================================================
// RENDERER
// ============================================================

const renderer =
    new THREE.WebGLRenderer({

        antialias: true

    });


renderer.setSize(

    window.innerWidth,

    window.innerHeight

);


renderer.setPixelRatio(

    Math.min(
        window.devicePixelRatio,
        2
    )

);


renderer.shadowMap.enabled =
    true;


renderer.shadowMap.type =
    THREE.PCFSoftShadowMap;


renderer.outputEncoding =
    THREE.sRGBEncoding;


renderer.toneMapping =
    THREE.ACESFilmicToneMapping;


renderer.toneMappingExposure =
    1.08;


document
    .getElementById(
        "game-container"
    )
    .appendChild(
        renderer.domElement
    );


// ============================================================
// POINTER LOCK
// ============================================================

const controls =
    new THREE.PointerLockControls(

        camera,

        renderer.domElement

    );


scene.add(
    controls.getObject()
);


// ============================================================
// SKY
// ============================================================

const sky =
    new THREE.Mesh(

        new THREE.SphereGeometry(
            250,
            24,
            12
        ),

        new THREE.MeshBasicMaterial({

            color:
                0x82c5f4,

            side:
                THREE.BackSide

        })

    );


scene.add(sky);


// ============================================================
// LIGHT
// ============================================================

const hemisphere =
    new THREE.HemisphereLight(

        0xd8efff,

        0x53672e,

        0.85

    );


scene.add(
    hemisphere
);


const sun =
    new THREE.DirectionalLight(

        0xffedc2,

        2.15

    );


sun.position.set(
    45,
    80,
    30
);


sun.castShadow =
    true;


sun.shadow.mapSize.set(
    2048,
    2048
);


sun.shadow.camera.left =
    -45;


sun.shadow.camera.right =
    45;


sun.shadow.camera.top =
    45;


sun.shadow.camera.bottom =
    -45;


sun.shadow.camera.near =
    1;


sun.shadow.camera.far =
    160;


scene.add(
    sun
);


// ============================================================
// SUN BLOCK
// ============================================================

const sunBlock =
    new THREE.Mesh(

        new THREE.BoxGeometry(
            7,
            7,
            1
        ),

        new THREE.MeshBasicMaterial({

            color:
                0xfff0a8

        })

    );


sunBlock.position.set(
    70,
    90,
    -140
);


scene.add(
    sunBlock
);


// ============================================================
// MATERIALS
// ============================================================

const blockMaterials = {

    grass:
        new THREE.MeshStandardMaterial({

            color:
                0x5d9f3d,

            roughness:
                1

        }),

    dirt:
        new THREE.MeshStandardMaterial({

            color:
                0x795338,

            roughness:
                1

        }),

    stone:
        new THREE.MeshStandardMaterial({

            color:
                0x7c7c7c,

            roughness:
                1

        }),

    sand:
        new THREE.MeshStandardMaterial({

            color:
                0xcdbb78,

            roughness:
                1

        }),

    log:
        new THREE.MeshStandardMaterial({

            color:
                0x704b2e,

            roughness:
                1

        }),

    leaves:
        new THREE.MeshStandardMaterial({

            color:
                0x397d37,

            roughness:
                1

        }),

    water:
        new THREE.MeshStandardMaterial({

            color:
                0x258bd8,

            transparent:
                true,

            opacity:
                0.58,

            roughness:
                0.2,

            depthWrite:
                false

        })

};


const cubeGeometry =
    new THREE.BoxGeometry(
        1,
        1,
        1
    );


// ============================================================
// WORLD DATA
// ============================================================

const chunks =
    new Map();


const modifications =
    new Map();


function blockKey(
    x,
    y,
    z
) {

    return (
        x +
        "," +
        y +
        "," +
        z
    );

}


function chunkKey(
    x,
    z
) {

    return (
        x +
        "," +
        z
    );

}


// ============================================================
// RANDOM / NOISE
// ============================================================

function hash2D(
    x,
    z
) {

    let n =
        x *
        374761393 +
        z *
        668265263;


    n =
        (
            n ^
            (
                n >>
                13
            )
        ) *
        1274126177;


    n =
        n ^
        (
            n >>
            16
        );


    return (
        n >>> 0
    ) /
    4294967295;

}


function smooth(t) {

    return (
        t *
        t *
        (
            3 -
            2 *
            t
        )
    );

}


function lerp(
    a,
    b,
    t
) {

    return (
        a +
        (
            b -
            a
        ) *
        t
    );

}


function noise(
    x,
    z
) {

    const x0 =
        Math.floor(x);


    const z0 =
        Math.floor(z);


    const x1 =
        x0 + 1;


    const z1 =
        z0 + 1;


    const sx =
        smooth(
            x -
            x0
        );


    const sz =
        smooth(
            z -
            z0
        );


    const n00 =
        hash2D(
            x0,
            z0
        );


    const n10 =
        hash2D(
            x1,
            z0
        );


    const n01 =
        hash2D(
            x0,
            z1
        );


    const n11 =
        hash2D(
            x1,
            z1
        );


    return lerp(

        lerp(
            n00,
            n10,
            sx
        ),

        lerp(
            n01,
            n11,
            sx
        ),

        sz

    );

}


// ============================================================
// TERRAIN
// ============================================================

function terrainHeight(
    x,
    z
) {

    let h = 0;


    h +=
        (
            noise(
                x * 0.035,
                z * 0.035
            ) -
            0.5
        ) *
        12;


    h +=
        (
            noise(
                x * 0.09,
                z * 0.09
            ) -
            0.5
        ) *
        5;


    h +=
        Math.sin(
            x *
            0.045
        ) *
        1.5;


    h +=
        Math.cos(
            z *
            0.04
        ) *
        1.2;


    return Math.floor(h);

}


// ============================================================
// GENERATED BLOCK
// ============================================================

function getGeneratedBlock(
    x,
    y,
    z
) {

    const modified =
        modifications.get(
            blockKey(
                x,
                y,
                z
            )
        );


    if(
        modified !==
        undefined
    ) {

        return modified;

    }


    const h =
        terrainHeight(
            x,
            z
        );


    if(
        y >
        h
    ) {

        if(
            y ===
            SEA_LEVEL &&
            h <
            SEA_LEVEL
        ) {

            return "water";

        }


        return null;

    }


    if(
        h <=
        SEA_LEVEL
    ) {

        if(
            y ===
            h
        ) {

            return "sand";

        }

    }

    else if(
        y ===
        h
    ) {

        return "grass";

    }


    if(
        y >=
        h - 2
    ) {

        return "dirt";

    }


    return "stone";

}


// ============================================================
// CHUNK
// ============================================================

function createChunk(
    chunkX,
    chunkZ
) {

    const key =
        chunkKey(
            chunkX,
            chunkZ
        );


    if(
        chunks.has(key)
    ) {

        return;

    }


    const group =
        new THREE.Group();


    group.userData.chunkX =
        chunkX;


    group.userData.chunkZ =
        chunkZ;


    scene.add(
        group
    );


    chunks.set(
        key,
        group
    );


    rebuildChunk(
        chunkX,
        chunkZ
    );

}


// ============================================================
// REBUILD CHUNK
// ============================================================

function rebuildChunk(
    chunkX,
    chunkZ
) {

    const key =
        chunkKey(
            chunkX,
            chunkZ
        );


    const group =
        chunks.get(key);


    if(!group)
        return;


    while(
        group.children.length
    ) {

        group.remove(
            group.children[0]
        );

    }


    const blocks = {

        grass: [],

        dirt: [],

        stone: [],

        sand: [],

        log: [],

        leaves: [],

        water: []

    };


    const startX =
        chunkX *
        CHUNK_SIZE;


    const startZ =
        chunkZ *
        CHUNK_SIZE;


    // ========================================================
    // NATURAL TERRAIN
    // ========================================================

    for(
        let lx = 0;
        lx < CHUNK_SIZE;
        lx++
    ) {

        for(
            let lz = 0;
            lz < CHUNK_SIZE;
            lz++
        ) {

            const x =
                startX +
                lx;


            const z =
                startZ +
                lz;


            const h =
                terrainHeight(
                    x,
                    z
                );


            // Only create several visible layers,
            // rather than filling the world to bedrock.

            for(
                let y =
                    h - 3;

                y <= h;

                y++
            ) {

                const type =
                    getGeneratedBlock(
                        x,
                        y,
                        z
                    );


                if(
                    type &&
                    blocks[type]
                ) {

                    blocks[type].push({

                        x,
                        y,
                        z

                    });

                }

            }


            // WATER SURFACE

            if(
                h <
                SEA_LEVEL
            ) {

                const water =
                    getGeneratedBlock(
                        x,
                        SEA_LEVEL,
                        z
                    );


                if(
                    water ===
                    "water"
                ) {

                    blocks.water.push({

                        x,

                        y:
                            SEA_LEVEL,

                        z

                    });

                }

            }


            // TREES

            if(
                h >
                SEA_LEVEL +
                1
            ) {

                const chance =
                    hash2D(
                        x + 918,
                        z - 527
                    );


                if(
                    chance >
                    0.982
                ) {

                    addTree(

                        x,

                        h,

                        z,

                        blocks

                    );

                }

            }

        }

    }


    // ========================================================
    // MODIFIED / PLACED BLOCKS
    // ========================================================

    for(
        const [
            key,
            type
        ]
        of modifications
    ) {

        if(!type)
            continue;


        const parts =
            key
            .split(",")
            .map(Number);


        const x =
            parts[0];


        const y =
            parts[1];


        const z =
            parts[2];


        if(
            Math.floor(
                x /
                CHUNK_SIZE
            ) !==
            chunkX
        ) {

            continue;

        }


        if(
            Math.floor(
                z /
                CHUNK_SIZE
            ) !==
            chunkZ
        ) {

            continue;

        }


        if(
            blocks[type]
        ) {

            // Avoid duplicate terrain position.

            const exists =
                blocks[type]
                .some(
                    p =>
                        p.x === x &&
                        p.y === y &&
                        p.z === z
                );


            if(!exists) {

                blocks[type].push({

                    x,
                    y,
                    z

                });

            }

        }

    }


    // ========================================================
    // INSTANCED MESHES
    // ========================================================

    for(
        const type
        of Object.keys(
            blocks
        )
    ) {

        createInstancedBlocks(

            group,

            type,

            blocks[type]

        );

    }

}


// ============================================================
// TREE
// ============================================================

function addTree(
    x,
    groundY,
    z,
    blocks
) {

    // Keep starting area open.

    if(
        Math.abs(x) <
        7 &&
        Math.abs(z) <
        7
    ) {

        return;

    }


    const trunkHeight =
        hash2D(
            x * 2,
            z * 3
        ) >
        0.5
            ? 5
            : 4;


    for(
        let i = 1;
        i <= trunkHeight;
        i++
    ) {

        blocks.log.push({

            x,

            y:
                groundY +
                i,

            z

        });

    }


    for(
        let ox = -2;
        ox <= 2;
        ox++
    ) {

        for(
            let oz = -2;
            oz <= 2;
            oz++
        ) {

            if(
                Math.abs(ox) ===
                2 &&
                Math.abs(oz) ===
                2
            ) {

                continue;

            }


            blocks.leaves.push({

                x:
                    x +
                    ox,

                y:
                    groundY +
                    trunkHeight,

                z:
                    z +
                    oz

            });


            blocks.leaves.push({

                x:
                    x +
                    ox,

                y:
                    groundY +
                    trunkHeight +
                    1,

                z:
                    z +
                    oz

            });

        }

    }


    for(
        let ox = -1;
        ox <= 1;
        ox++
    ) {

        for(
            let oz = -1;
            oz <= 1;
            oz++
        ) {

            blocks.leaves.push({

                x:
                    x +
                    ox,

                y:
                    groundY +
                    trunkHeight +
                    2,

                z:
                    z +
                    oz

            });

        }

    }

}


// ============================================================
// INSTANCED BLOCKS
// ============================================================

const dummy =
    new THREE.Object3D();


function createInstancedBlocks(
    group,
    type,
    positions
) {

    if(
        positions.length ===
        0
    ) {

        return;

    }


    const mesh =
        new THREE.InstancedMesh(

            cubeGeometry,

            blockMaterials[type],

            positions.length

        );


    mesh.userData.blockType =
        type;


    mesh.userData.positions =
        positions;


    for(
        let i = 0;
        i < positions.length;
        i++
    ) {

        const p =
            positions[i];


        dummy.position.set(
            p.x,
            p.y,
            p.z
        );


        // Water is slightly shorter.

        if(
            type ===
            "water"
        ) {

            dummy.scale.set(
                1,
                0.82,
                1
            );


            dummy.position.y -=
                0.09;

        }

        else {

            dummy.scale.set(
                1,
                1,
                1
            );

        }


        dummy.rotation.set(
            0,
            0,
            0
        );


        dummy.updateMatrix();


        mesh.setMatrixAt(
            i,
            dummy.matrix
        );

    }


    mesh.instanceMatrix.needsUpdate =
        true;


    mesh.castShadow =
        (
            type !==
            "water"
        );


    mesh.receiveShadow =
        true;


    if(
        type ===
        "water"
    ) {

        mesh.renderOrder =
            1;

    }


    group.add(
        mesh
    );

}


// ============================================================
// CHUNK LOADING
// ============================================================

let playerChunkX =
    null;


let playerChunkZ =
    null;


function updateChunks(
    force = false
) {

    const cx =
        Math.floor(
            camera.position.x /
            CHUNK_SIZE
        );


    const cz =
        Math.floor(
            camera.position.z /
            CHUNK_SIZE
        );


    if(
        !force &&
        cx ===
        playerChunkX &&
        cz ===
        playerChunkZ
    ) {

        return;

    }


    playerChunkX =
        cx;


    playerChunkZ =
        cz;


    for(
        let x =
            cx -
            RENDER_DISTANCE;

        x <=
            cx +
            RENDER_DISTANCE;

        x++
    ) {

        for(
            let z =
                cz -
                RENDER_DISTANCE;

            z <=
                cz +
                RENDER_DISTANCE;

            z++
        ) {

            createChunk(
                x,
                z
            );

        }

    }


    for(
        const [
            key,
            group
        ]
        of chunks
    ) {

        const dx =
            Math.abs(
                group.userData.chunkX -
                cx
            );


        const dz =
            Math.abs(
                group.userData.chunkZ -
                cz
            );


        if(
            dx >
            RENDER_DISTANCE +
            1 ||

            dz >
            RENDER_DISTANCE +
            1
        ) {

            scene.remove(
                group
            );


            chunks.delete(
                key
            );

        }

    }

}


// ============================================================
// REBUILD BLOCK'S CHUNK
// ============================================================

function rebuildBlockChunk(
    x,
    z
) {

    const cx =
        Math.floor(
            x /
            CHUNK_SIZE
        );


    const cz =
        Math.floor(
            z /
            CHUNK_SIZE
        );


    rebuildChunk(
        cx,
        cz
    );


    // Rebuild neighboring chunk at boundaries.

    const localX =
        (
            (
                x %
                CHUNK_SIZE
            ) +
            CHUNK_SIZE
        ) %
        CHUNK_SIZE;


    const localZ =
        (
            (
                z %
                CHUNK_SIZE
            ) +
            CHUNK_SIZE
        ) %
        CHUNK_SIZE;


    if(localX === 0)
        rebuildChunk(
            cx - 1,
            cz
        );


    if(
        localX ===
        CHUNK_SIZE - 1
    )
        rebuildChunk(
            cx + 1,
            cz
        );


    if(localZ === 0)
        rebuildChunk(
            cx,
            cz - 1
        );


    if(
        localZ ===
        CHUNK_SIZE - 1
    )
        rebuildChunk(
            cx,
            cz + 1
        );

}


// ============================================================
// PLAYER
// ============================================================

let moveForward =
    false;


let moveBackward =
    false;


let moveLeft =
    false;


let moveRight =
    false;


let canJump =
    false;


const velocity =
    new THREE.Vector3();


const direction =
    new THREE.Vector3();


// ============================================================
// SPAWN
// ============================================================

let spawnX = 0;

let spawnZ = 0;

let spawnY =
    terrainHeight(
        spawnX,
        spawnZ
    );


if(
    spawnY <=
    SEA_LEVEL
) {

    for(
        let radius = 1;
        radius < 30;
        radius++
    ) {

        let found =
            false;


        for(
            let x =
                -radius;

            x <= radius;
            x++
        ) {

            for(
                let z =
                    -radius;

                z <= radius;
                z++
            ) {

                const h =
                    terrainHeight(
                        x,
                        z
                    );


                if(
                    h >
                    SEA_LEVEL +
                    1
                ) {

                    spawnX = x;

                    spawnZ = z;

                    spawnY = h;

                    found = true;

                    break;

                }

            }


            if(found)
                break;

        }


        if(found)
            break;

    }

}


camera.position.set(

    spawnX,

    spawnY +
    PLAYER_HEIGHT +
    0.2,

    spawnZ

);


updateChunks(
    true
);


// ============================================================
// BLOCK TARGETING
// ============================================================

const raycaster =
    new THREE.Raycaster();


raycaster.far =
    REACH_DISTANCE;


const screenCenter =
    new THREE.Vector2(
        0,
        0
    );


let targetedBlock =
    null;


// ============================================================
// BLOCK OUTLINE
// ============================================================

const outline =
    new THREE.LineSegments(

        new THREE.EdgesGeometry(

            new THREE.BoxGeometry(
                1.03,
                1.03,
                1.03
            )

        ),

        new THREE.LineBasicMaterial({

            color:
                0x111111

        })

    );


outline.visible =
    false;


scene.add(
    outline
);


// ============================================================
// UPDATE TARGET
// ============================================================

function updateTarget() {

    targetedBlock =
        null;


    outline.visible =
        false;


    if(
        Inventory.isOpen()
    ) {

        return;

    }


    raycaster.setFromCamera(

        screenCenter,

        camera

    );


    const objects = [];


    for(
        const group
        of chunks.values()
    ) {

        for(
            const child
            of group.children
        ) {

            if(
                child.isInstancedMesh
            ) {

                objects.push(
                    child
                );

            }

        }

    }


    const hits =
        raycaster.intersectObjects(
            objects,
            false
        );


    if(
        hits.length ===
        0
    ) {

        return;

    }


    const hit =
        hits[0];


    const mesh =
        hit.object;


    const type =
        mesh.userData.blockType;


    // Don't target water.

    if(
        type ===
        "water"
    ) {

        return;

    }


    const positions =
        mesh.userData.positions;


    if(
        hit.instanceId ===
        undefined ||
        !positions[
            hit.instanceId
        ]
    ) {

        return;

    }


    const position =
        positions[
            hit.instanceId
        ];


    targetedBlock = {

        x:
            position.x,

        y:
            position.y,

        z:
            position.z,

        type,

        normal:
            hit.face
                ? hit.face.normal.clone()
                : new THREE.Vector3(
                    0,
                    1,
                    0
                )

    };


    outline.position.set(

        position.x,

        position.y,

        position.z

    );


    outline.visible =
        true;

}


// ============================================================
// BREAK BLOCK
// ============================================================

function breakBlock() {

    if(
        !targetedBlock
    ) {

        return;

    }


    const b =
        targetedBlock;


    modifications.set(

        blockKey(
            b.x,
            b.y,
            b.z
        ),

        null

    );


    Inventory.addItem(
        b.type,
        1
    );


    rebuildBlockChunk(
        b.x,
        b.z
    );


    targetedBlock =
        null;


    outline.visible =
        false;

}


// ============================================================
// PLAYER/BLOCK INTERSECTION
// ============================================================

function blockIntersectsPlayer(
    x,
    y,
    z
) {

    const px =
        camera.position.x;


    const py =
        camera.position.y;


    const pz =
        camera.position.z;


    const blockMinX =
        x -
        0.5;


    const blockMaxX =
        x +
        0.5;


    const blockMinY =
        y -
        0.5;


    const blockMaxY =
        y +
        0.5;


    const blockMinZ =
        z -
        0.5;


    const blockMaxZ =
        z +
        0.5;


    const playerMinX =
        px -
        PLAYER_RADIUS;


    const playerMaxX =
        px +
        PLAYER_RADIUS;


    const playerMinY =
        py -
        PLAYER_HEIGHT;


    const playerMaxY =
        py +
        0.1;


    const playerMinZ =
        pz -
        PLAYER_RADIUS;


    const playerMaxZ =
        pz +
        PLAYER_RADIUS;


    return (

        playerMaxX >
        blockMinX &&

        playerMinX <
        blockMaxX &&

        playerMaxY >
        blockMinY &&

        playerMinY <
        blockMaxY &&

        playerMaxZ >
        blockMinZ &&

        playerMinZ <
        blockMaxZ

    );

}


// ============================================================
// PLACE BLOCK
// ============================================================

function placeBlock() {

    if(
        !targetedBlock
    ) {

        return;

    }


    const selected =
        Inventory.getSelectedItem();


    if(!selected)
        return;


    const selectedType =
        Inventory.getSelectedType();


    if(
        !selectedType ||
        !selectedType.placeable
    ) {

        return;

    }


    const normal =
        targetedBlock.normal;


    const x =
        targetedBlock.x +
        Math.round(
            normal.x
        );


    const y =
        targetedBlock.y +
        Math.round(
            normal.y
        );


    const z =
        targetedBlock.z +
        Math.round(
            normal.z
        );


    if(
        blockIntersectsPlayer(
            x,
            y,
            z
        )
    ) {

        return;

    }


    modifications.set(

        blockKey(
            x,
            y,
            z
        ),

        selected.id

    );


    Inventory.consumeSelected(
        1
    );


    rebuildBlockChunk(
        x,
        z
    );

}


// ============================================================
// MOUSE
// ============================================================

renderer.domElement.addEventListener(
    "mousedown",
    event => {

        if(
            Inventory.isOpen() ||
            !controls.isLocked
        ) {

            return;

        }


        if(
            event.button ===
            0
        ) {

            breakBlock();

        }


        if(
            event.button ===
            2
        ) {

            placeBlock();

        }

    }
);


renderer.domElement.addEventListener(
    "contextmenu",
    event => {

        event.preventDefault();

    }
);


// ============================================================
// KEYBOARD
// ============================================================

document.addEventListener(
    "keydown",
    event => {

        if(
            Inventory.isOpen()
        ) {

            return;

        }


        switch(
            event.code
        ) {

            case "KeyW":

                moveForward =
                    true;

                break;


            case "KeyS":

                moveBackward =
                    true;

                break;


            case "KeyA":

                moveLeft =
                    true;

                break;


            case "KeyD":

                moveRight =
                    true;

                break;


            case "Space":

                if(canJump) {

                    velocity.y =
                        JUMP_FORCE;


                    canJump =
                        false;

                }

                break;

        }

    }
);


document.addEventListener(
    "keyup",
    event => {

        switch(
            event.code
        ) {

            case "KeyW":

                moveForward =
                    false;

                break;


            case "KeyS":

                moveBackward =
                    false;

                break;


            case "KeyA":

                moveLeft =
                    false;

                break;


            case "KeyD":

                moveRight =
                    false;

                break;

        }

    }
);


// ============================================================
// START SCREEN
// ============================================================

const startScreen =
    document.getElementById(
        "start-screen"
    );


const playButton =
    document.getElementById(
        "play-button"
    );


playButton.addEventListener(
    "click",
    () => {

        controls.lock();

    }
);


controls.addEventListener(
    "lock",
    () => {

        startScreen.style.display =
            "none";

    }
);


controls.addEventListener(
    "unlock",
    () => {

        moveForward =
            false;

        moveBackward =
            false;

        moveLeft =
            false;

        moveRight =
            false;


        if(
            !Inventory.isOpen()
        ) {

            startScreen.style.display =
                "flex";

        }

    }
);


// ============================================================
// GAME API FOR INVENTORY
// ============================================================

window.Game = {

    unlockPointer() {

        if(
            controls.isLocked
        ) {

            controls.unlock();

        }


        startScreen.style.display =
            "none";

    }

};


// ============================================================
// RESIZE
// ============================================================

window.addEventListener(
    "resize",
    () => {

        camera.aspect =
            window.innerWidth /
            window.innerHeight;


        camera.updateProjectionMatrix();


        renderer.setSize(

            window.innerWidth,

            window.innerHeight

        );

    }
);


// ============================================================
// DEBUG UI
// ============================================================

const fpsDisplay =
    document.getElementById(
        "fps-display"
    );


const coordinateDisplay =
    document.getElementById(
        "coordinate-display"
    );


const chunkDisplay =
    document.getElementById(
        "chunk-display"
    );


let frameCounter =
    0;


let fpsTimer =
    0;


// ============================================================
// CLOCK
// ============================================================

const clock =
    new THREE.Clock();


// ============================================================
// GAME LOOP
// ============================================================

function animate() {

    requestAnimationFrame(
        animate
    );


    const delta =
        Math.min(
            clock.getDelta(),
            0.05
        );


    // ========================================================
    // PLAYER MOVEMENT
    // ========================================================

    if(
        controls.isLocked &&
        !Inventory.isOpen()
    ) {

        velocity.x -=
            velocity.x *
            10 *
            delta;


        velocity.z -=
            velocity.z *
            10 *
            delta;


        velocity.y -=
            GRAVITY *
            delta;


        direction.z =
            Number(
                moveForward
            ) -
            Number(
                moveBackward
            );


        direction.x =
            Number(
                moveRight
            ) -
            Number(
                moveLeft
            );


        direction.normalize();


        if(
            moveForward ||
            moveBackward
        ) {

            velocity.z -=
                direction.z *
                WALK_SPEED *
                delta;

        }


        if(
            moveLeft ||
            moveRight
        ) {

            velocity.x -=
                direction.x *
                WALK_SPEED *
                delta;

        }


        controls.moveRight(

            -velocity.x *
            delta

        );


        controls.moveForward(

            -velocity.z *
            delta

        );


        camera.position.y +=
            velocity.y *
            delta;


        // ====================================================
        // SIMPLE GROUND COLLISION
        // ====================================================

        const x =
            Math.round(
                camera.position.x
            );


        const z =
            Math.round(
                camera.position.z
            );


        const terrain =
            terrainHeight(
                x,
                z
            );


        const ground =
            terrain +
            PLAYER_HEIGHT;


        if(
            camera.position.y <=
            ground
        ) {

            camera.position.y =
                ground;


            velocity.y =
                0;


            canJump =
                true;

        }


        updateChunks();

    }


    // ========================================================
    // TARGET BLOCK
    // ========================================================

    updateTarget();


    // ========================================================
    // SKY FOLLOWS PLAYER
    // ========================================================

    sky.position.copy(
        camera.position
    );


    // ========================================================
    // DEBUG
    // ========================================================

    frameCounter++;

    fpsTimer +=
        delta;


    if(
        fpsTimer >=
        0.5
    ) {

        fpsDisplay.textContent =
            "FPS: " +
            Math.round(
                frameCounter /
                fpsTimer
            );


        frameCounter =
            0;


        fpsTimer =
            0;

    }


    coordinateDisplay.textContent =
        "XYZ: " +
        camera.position.x
            .toFixed(1) +
        " / " +
        camera.position.y
            .toFixed(1) +
        " / " +
        camera.position.z
            .toFixed(1);


    chunkDisplay.textContent =
        "Chunk: " +
        (
            playerChunkX ??
            0
        ) +
        " / " +
        (
            playerChunkZ ??
            0
        );


    // ========================================================
    // RENDER
    // ========================================================

    renderer.render(
        scene,
        camera
    );

}


animate();