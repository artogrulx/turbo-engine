// ============================================================
// BLOCK WORLD
// REALISTIC WATER + VOXEL TERRAIN + AABB PHYSICS
// THREE.JS r128
// ============================================================


// ============================================================
// CONFIG
// ============================================================

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3;

const SEA_LEVEL = 0;
const WORLD_BOTTOM = -40;

const PLAYER_WIDTH = 0.60;
const PLAYER_RADIUS = PLAYER_WIDTH / 2;
const PLAYER_HEIGHT = 1.80;
const PLAYER_EYE_HEIGHT = 1.62;

const WALK_SPEED = 5.3;
const GRAVITY = 24;
const JUMP_FORCE = 8.5;

const REACH_DISTANCE = 6;

const EPSILON = 0.001;


// ============================================================
// WATER CONFIG
// ============================================================

// Water levels:
// 1 = very shallow flowing water
// 8 = full/source water

const WATER_MAX_LEVEL = 8;

const WATER_FLOW_INTERVAL = 0.18;

const WATER_HORIZONTAL_SPREAD = 7;

const WATER_GRAVITY_SPEED = 7.5;

const WATER_DRAG_HORIZONTAL = 0.48;

const WATER_DRAG_VERTICAL = 0.82;

const WATER_BUOYANCY = 19;

const WATER_SWIM_FORCE = 10;

const WATER_MAX_SINK_SPEED = 3.2;


// ============================================================
// BLOCK DEFINITIONS
// ============================================================

const BLOCKS = {

    grass: {
        solid: true,
        breakable: true
    },

    dirt: {
        solid: true,
        breakable: true
    },

    stone: {
        solid: true,
        breakable: true
    },

    sand: {
        solid: true,
        breakable: true
    },

    log: {
        solid: true,
        breakable: true
    },

    leaves: {
        solid: true,
        breakable: true
    }

};


// ============================================================
// SCENE
// ============================================================

const scene = new THREE.Scene();

const NORMAL_SKY_COLOR =
    new THREE.Color(0x8bcdf5);

const NORMAL_FOG_COLOR =
    new THREE.Color(0xb6ddf4);

const UNDERWATER_SHALLOW_COLOR =
    new THREE.Color(0x2f8fa5);

const UNDERWATER_DEEP_COLOR =
    new THREE.Color(0x073a55);

scene.background =
    NORMAL_SKY_COLOR.clone();

scene.fog =
    new THREE.Fog(
        NORMAL_FOG_COLOR.clone(),
        65,
        140
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

renderer.shadowMap.enabled = true;

renderer.shadowMap.type =
    THREE.PCFSoftShadowMap;

renderer.outputEncoding =
    THREE.sRGBEncoding;

renderer.toneMapping =
    THREE.ACESFilmicToneMapping;

renderer.toneMappingExposure =
    1.05;

document
    .getElementById("game-container")
    .appendChild(renderer.domElement);


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
            color: 0x8bcdf5,
            side: THREE.BackSide
        })

    );

scene.add(sky);


// ============================================================
// LIGHTING
// ============================================================

const hemisphere =
    new THREE.HemisphereLight(
        0xdaf1ff,
        0x53652f,
        0.9
    );

scene.add(hemisphere);


const sun =
    new THREE.DirectionalLight(
        0xffefc8,
        2.1
    );

sun.position.set(
    45,
    80,
    30
);

sun.castShadow = true;

sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;

sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;

sun.shadow.camera.near = 1;
sun.shadow.camera.far = 180;

scene.add(sun);


// ============================================================
// SUN
// ============================================================

const sunBlock =
    new THREE.Mesh(

        new THREE.BoxGeometry(
            7,
            7,
            1
        ),

        new THREE.MeshBasicMaterial({
            color: 0xfff0a8
        })

    );

sunBlock.position.set(
    70,
    90,
    -140
);

scene.add(sunBlock);


// ============================================================
// BLOCK GEOMETRY
// ============================================================

const cubeGeometry =
    new THREE.BoxGeometry(
        1,
        1,
        1
    );


// ============================================================
// BLOCK MATERIALS
// ============================================================

const blockMaterials = {

    grass:
        new THREE.MeshStandardMaterial({
            color: 0x5d9f3d,
            roughness: 1
        }),

    dirt:
        new THREE.MeshStandardMaterial({
            color: 0x795338,
            roughness: 1
        }),

    stone:
        new THREE.MeshStandardMaterial({
            color: 0x7c7c7c,
            roughness: 1
        }),

    sand:
        new THREE.MeshStandardMaterial({
            color: 0xcdbb78,
            roughness: 1
        }),

    log:
        new THREE.MeshStandardMaterial({
            color: 0x704b2e,
            roughness: 1
        }),

    leaves:
        new THREE.MeshStandardMaterial({
            color: 0x397d37,
            roughness: 1,
            transparent: true,
            opacity: 0.92
        })

};


// ============================================================
// WATER MATERIAL
//
// Transparent, reflective-looking, smooth material.
//
// This is not made from cube geometry.
// ============================================================

const waterMaterial =
    new THREE.MeshPhysicalMaterial({

        color: 0x1976a5,

        transparent: true,

        opacity: 0.67,

        roughness: 0.12,

        metalness: 0.02,

        clearcoat: 0.7,

        clearcoatRoughness: 0.15,

        side: THREE.DoubleSide,

        depthWrite: false

    });


// ============================================================
// WORLD STORAGE
// ============================================================

const chunks =
    new Map();


// null = destroyed
// string = placed block

const modifications =
    new Map();


// Dynamic water cells.
//
// key ->
//
// {
//     level: 1..8,
//     source: boolean
// }

const waterCells =
    new Map();


// Water meshes by chunk.

const waterMeshes =
    new Map();


// ============================================================
// KEYS
// ============================================================

function blockKey(x, y, z) {

    return (
        x + "," +
        y + "," +
        z
    );

}


function chunkKey(x, z) {

    return (
        x + "," +
        z
    );

}


// ============================================================
// HASH
// ============================================================

function hash2D(x, z) {

    let n =
        x * 374761393 +
        z * 668265263;

    n =
        (
            n ^
            (n >> 13)
        ) *
        1274126177;

    n =
        n ^
        (n >> 16);

    return (
        n >>> 0
    ) /
    4294967295;

}


// ============================================================
// NOISE
// ============================================================

function smooth(t) {

    return (
        t *
        t *
        (3 - 2 * t)
    );

}


function lerp(a, b, t) {

    return (
        a +
        (b - a) *
        t
    );

}


function noise(x, z) {

    const x0 =
        Math.floor(x);

    const z0 =
        Math.floor(z);

    const x1 = x0 + 1;
    const z1 = z0 + 1;

    const sx =
        smooth(x - x0);

    const sz =
        smooth(z - z0);

    const n00 =
        hash2D(x0, z0);

    const n10 =
        hash2D(x1, z0);

    const n01 =
        hash2D(x0, z1);

    const n11 =
        hash2D(x1, z1);

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
// TERRAIN HEIGHT
//
// Used for generation only.
//
// NOT used as an invisible player floor.
// ============================================================

function terrainHeight(x, z) {

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
        (
            noise(
                x * 0.18,
                z * 0.18
            ) -
            0.5
        ) *
        2;

    h +=
        Math.sin(
            x * 0.045
        ) *
        1.5;

    h +=
        Math.cos(
            z * 0.04
        ) *
        1.2;

    return Math.floor(h);

}


// ============================================================
// TREES
// ============================================================

function treeExistsAt(x, z) {

    const ground =
        terrainHeight(x, z);

    if(
        ground <=
        SEA_LEVEL + 1
    ) {

        return false;

    }

    if(
        Math.abs(x) < 7 &&
        Math.abs(z) < 7
    ) {

        return false;

    }

    return (
        hash2D(
            x + 918,
            z - 527
        ) >
        0.982
    );

}


function treeHeight(x, z) {

    return (
        hash2D(
            x * 2,
            z * 3
        ) >
        0.5
    )
        ? 5
        : 4;

}


// ============================================================
// TREE BLOCK LOOKUP
// ============================================================

function getGeneratedTreeBlock(
    x,
    y,
    z
) {

    for(
        let tx = x - 2;
        tx <= x + 2;
        tx++
    ) {

        for(
            let tz = z - 2;
            tz <= z + 2;
            tz++
        ) {

            if(
                !treeExistsAt(
                    tx,
                    tz
                )
            ) {

                continue;

            }

            const ground =
                terrainHeight(
                    tx,
                    tz
                );

            const height =
                treeHeight(
                    tx,
                    tz
                );

            // TRUNK

            if(
                x === tx &&
                z === tz &&
                y >= ground + 1 &&
                y <= ground + height
            ) {

                return "log";

            }

            const dx =
                x - tx;

            const dz =
                z - tz;

            // LOWER LEAVES

            if(
                y ===
                    ground +
                    height ||

                y ===
                    ground +
                    height +
                    1
            ) {

                if(
                    Math.abs(dx) <= 2 &&
                    Math.abs(dz) <= 2
                ) {

                    if(
                        !(
                            Math.abs(dx) === 2 &&
                            Math.abs(dz) === 2
                        )
                    ) {

                        return "leaves";

                    }

                }

            }

            // TOP

            if(
                y ===
                ground +
                height +
                2
            ) {

                if(
                    Math.abs(dx) <= 1 &&
                    Math.abs(dz) <= 1
                ) {

                    return "leaves";

                }

            }

        }

    }

    return null;

}


// ============================================================
// NATURAL SOLID BLOCK
// ============================================================

function getNaturalBlock(
    x,
    y,
    z
) {

    const tree =
        getGeneratedTreeBlock(
            x,
            y,
            z
        );

    if(tree)
        return tree;

    const h =
        terrainHeight(
            x,
            z
        );

    if(
        y > h
    ) {

        return null;

    }

    if(
        y === h
    ) {

        if(
            h <=
            SEA_LEVEL
        ) {

            return "sand";

        }

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
// ACTUAL SOLID BLOCK LOOKUP
// ============================================================

function getBlock(
    x,
    y,
    z
) {

    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);

    const key =
        blockKey(
            x,
            y,
            z
        );

    if(
        modifications.has(key)
    ) {

        return modifications.get(
            key
        );

    }

    return getNaturalBlock(
        x,
        y,
        z
    );

}


// ============================================================
// SOLID CHECK
// ============================================================

function isSolidBlock(
    x,
    y,
    z
) {

    const type =
        getBlock(
            x,
            y,
            z
        );

    if(!type)
        return false;

    return (
        BLOCKS[type] &&
        BLOCKS[type].solid
    );

}


// ============================================================
// WATER SYSTEM
// ============================================================

// Natural oceans are derived from terrain.
//
// Dynamic water uses waterCells.

function getNaturalWaterLevel(
    x,
    y,
    z
) {

    const h =
        terrainHeight(
            x,
            z
        );

    if(
        h >=
        SEA_LEVEL
    ) {

        return 0;

    }

    if(
        y > h &&
        y <= SEA_LEVEL
    ) {

        return WATER_MAX_LEVEL;

    }

    return 0;

}


// ============================================================
// GET WATER CELL
// ============================================================

function getWaterLevel(
    x,
    y,
    z
) {

    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);

    // Solid block overrides water.

    if(
        isSolidBlock(
            x,
            y,
            z
        )
    ) {

        return 0;

    }

    const dynamic =
        waterCells.get(
            blockKey(
                x,
                y,
                z
            )
        );

    if(dynamic) {

        return dynamic.level;

    }

    return getNaturalWaterLevel(
        x,
        y,
        z
    );

}


// ============================================================
// WATER SURFACE HEIGHT
// ============================================================

function waterLevelToHeight(
    level
) {

    if(
        level <= 0
    ) {

        return 0;

    }

    return (
        0.12 +
        0.88 *
        (
            level /
            WATER_MAX_LEVEL
        )
    );

}


// ============================================================
// CREATE WATER SOURCE
// ============================================================

function createWaterSource(
    x,
    y,
    z
) {

    if(
        isSolidBlock(
            x,
            y,
            z
        )
    ) {

        return;

    }

    waterCells.set(

        blockKey(
            x,
            y,
            z
        ),

        {
            level:
                WATER_MAX_LEVEL,

            source:
                true
        }

    );

}


// ============================================================
// WATER FLOW
// ============================================================

let waterFlowTimer = 0;


function simulateWater() {

    const additions =
        new Map();

    const removals = [];

    for(
        const [
            key,
            cell
        ]
        of waterCells
    ) {

        const parts =
            key
            .split(",")
            .map(Number);

        const x = parts[0];
        const y = parts[1];
        const z = parts[2];

        // -----------------------------------------------
        // FLOW DOWN FIRST
        // -----------------------------------------------

        if(
            !isSolidBlock(
                x,
                y - 1,
                z
            )
        ) {

            const belowNatural =
                getNaturalWaterLevel(
                    x,
                    y - 1,
                    z
                );

            const belowDynamic =
                waterCells.get(
                    blockKey(
                        x,
                        y - 1,
                        z
                    )
                );

            if(
                belowNatural === 0 &&
                !belowDynamic
            ) {

                additions.set(

                    blockKey(
                        x,
                        y - 1,
                        z
                    ),

                    {
                        level:
                            WATER_MAX_LEVEL,

                        source:
                            false
                    }

                );

                if(
                    !cell.source
                ) {

                    removals.push(
                        key
                    );

                }

                continue;

            }

        }

        // -----------------------------------------------
        // HORIZONTAL FLOW
        // -----------------------------------------------

        if(
            cell.level <= 1
        ) {

            continue;

        }

        const nextLevel =
            Math.min(
                WATER_HORIZONTAL_SPREAD,
                cell.level - 1
            );

        const directions = [

            [1, 0],

            [-1, 0],

            [0, 1],

            [0, -1]

        ];

        for(
            const dir
            of directions
        ) {

            const nx =
                x + dir[0];

            const nz =
                z + dir[1];

            if(
                isSolidBlock(
                    nx,
                    y,
                    nz
                )
            ) {

                continue;

            }

            const natural =
                getNaturalWaterLevel(
                    nx,
                    y,
                    nz
                );

            if(
                natural >
                0
            ) {

                continue;

            }

            const targetKey =
                blockKey(
                    nx,
                    y,
                    nz
                );

            const existing =
                waterCells.get(
                    targetKey
                );

            if(
                !existing ||
                existing.level <
                    nextLevel
            ) {

                additions.set(

                    targetKey,

                    {
                        level:
                            nextLevel,

                        source:
                            false
                    }

                );

            }

        }

    }

    // Remove falling transient cells.

    for(
        const key
        of removals
    ) {

        waterCells.delete(
            key
        );

    }

    // Apply additions.

    for(
        const [
            key,
            cell
        ]
        of additions
    ) {

        const existing =
            waterCells.get(key);

        if(
            !existing ||
            existing.level <
                cell.level
        ) {

            waterCells.set(
                key,
                cell
            );

        }

    }

    if(
        additions.size > 0 ||
        removals.length > 0
    ) {

        rebuildVisibleWater();

    }

}


// ============================================================
// CHUNKS
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

    chunks.set(
        key,
        group
    );

    scene.add(group);

    rebuildChunk(
        chunkX,
        chunkZ
    );

}


// ============================================================
// CLEAR CHUNK
// ============================================================

function clearChunk(
    group
) {

    while(
        group.children.length
    ) {

        const child =
            group.children[
                group.children.length - 1
            ];

        group.remove(child);

    }

}


// ============================================================
// TREE VISUALS
// ============================================================

function addTreeVisuals(
    x,
    groundY,
    z,
    lists
) {

    const height =
        treeHeight(
            x,
            z
        );

    for(
        let i = 1;
        i <= height;
        i++
    ) {

        const y =
            groundY + i;

        if(
            getBlock(
                x,
                y,
                z
            ) ===
            "log"
        ) {

            lists.log.push({
                x,
                y,
                z
            });

        }

    }

    for(
        let layer = 0;
        layer <= 1;
        layer++
    ) {

        const y =
            groundY +
            height +
            layer;

        for(
            let dx = -2;
            dx <= 2;
            dx++
        ) {

            for(
                let dz = -2;
                dz <= 2;
                dz++
            ) {

                if(
                    Math.abs(dx) === 2 &&
                    Math.abs(dz) === 2
                ) {

                    continue;

                }

                const bx = x + dx;
                const bz = z + dz;

                if(
                    getBlock(
                        bx,
                        y,
                        bz
                    ) ===
                    "leaves"
                ) {

                    lists.leaves.push({
                        x: bx,
                        y,
                        z: bz
                    });

                }

            }

        }

    }

    const topY =
        groundY +
        height +
        2;

    for(
        let dx = -1;
        dx <= 1;
        dx++
    ) {

        for(
            let dz = -1;
            dz <= 1;
            dz++
        ) {

            const bx = x + dx;
            const bz = z + dz;

            if(
                getBlock(
                    bx,
                    topY,
                    bz
                ) ===
                "leaves"
            ) {

                lists.leaves.push({
                    x: bx,
                    y: topY,
                    z: bz
                });

            }

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
        positions.length === 0
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

        dummy.scale.set(
            1,
            1,
            1
        );

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

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    group.add(mesh);

}


// ============================================================
// REBUILD TERRAIN CHUNK
// ============================================================

function rebuildChunk(
    chunkX,
    chunkZ
) {

    const group =
        chunks.get(
            chunkKey(
                chunkX,
                chunkZ
            )
        );

    if(!group)
        return;

    clearChunk(group);

    const lists = {

        grass: [],
        dirt: [],
        stone: [],
        sand: [],
        log: [],
        leaves: []

    };

    const startX =
        chunkX *
        CHUNK_SIZE;

    const startZ =
        chunkZ *
        CHUNK_SIZE;

    for(
        let localX = 0;
        localX < CHUNK_SIZE;
        localX++
    ) {

        for(
            let localZ = 0;
            localZ < CHUNK_SIZE;
            localZ++
        ) {

            const x =
                startX +
                localX;

            const z =
                startZ +
                localZ;

            const h =
                terrainHeight(
                    x,
                    z
                );

            const bottom =
                Math.max(
                    h - 5,
                    WORLD_BOTTOM
                );

            for(
                let y = bottom;
                y <= h;
                y++
            ) {

                const type =
                    getBlock(
                        x,
                        y,
                        z
                    );

                if(
                    type &&
                    lists[type]
                ) {

                    lists[type].push({
                        x,
                        y,
                        z
                    });

                }

            }

            if(
                treeExistsAt(
                    x,
                    z
                )
            ) {

                addTreeVisuals(
                    x,
                    h,
                    z,
                    lists
                );

            }

        }

    }

    // Player placed blocks.

    for(
        const [
            key,
            type
        ]
        of modifications
    ) {

        if(
            !type ||
            !lists[type]
        ) {

            continue;

        }

        const parts =
            key
            .split(",")
            .map(Number);

        const x = parts[0];
        const y = parts[1];
        const z = parts[2];

        if(
            Math.floor(
                x /
                CHUNK_SIZE
            ) !==
            chunkX ||

            Math.floor(
                z /
                CHUNK_SIZE
            ) !==
            chunkZ
        ) {

            continue;

        }

        const exists =
            lists[type]
            .some(
                p =>
                    p.x === x &&
                    p.y === y &&
                    p.z === z
            );

        if(!exists) {

            lists[type].push({
                x,
                y,
                z
            });

        }

    }

    for(
        const type
        of Object.keys(lists)
    ) {

        createInstancedBlocks(
            group,
            type,
            lists[type]
        );

    }

}


// ============================================================
// WATER MESH GENERATION
//
// Only exposed water surfaces are rendered.
// There are NO transparent cubes stacked underwater.
// ============================================================

function getVisibleWaterRangeForChunk(
    chunkX,
    chunkZ
) {

    const cells = [];

    const startX =
        chunkX *
        CHUNK_SIZE;

    const startZ =
        chunkZ *
        CHUNK_SIZE;

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
                startX + lx;

            const z =
                startZ + lz;

            const terrain =
                terrainHeight(
                    x,
                    z
                );

            // Natural ocean.

            if(
                terrain <
                SEA_LEVEL
            ) {

                const level =
                    getWaterLevel(
                        x,
                        SEA_LEVEL,
                        z
                    );

                if(level > 0) {

                    cells.push({
                        x,
                        y: SEA_LEVEL,
                        z,
                        level
                    });

                }

            }

        }

    }

    // Dynamic water.

    for(
        const [
            key,
            cell
        ]
        of waterCells
    ) {

        const parts =
            key
            .split(",")
            .map(Number);

        const x = parts[0];
        const y = parts[1];
        const z = parts[2];

        if(
            Math.floor(
                x /
                CHUNK_SIZE
            ) !==
                chunkX ||

            Math.floor(
                z /
                CHUNK_SIZE
            ) !==
                chunkZ
        ) {

            continue;

        }

        // Don't render a surface if another water cell
        // completely covers it.

        if(
            getWaterLevel(
                x,
                y + 1,
                z
            ) >
            0
        ) {

            continue;

        }

        cells.push({
            x,
            y,
            z,
            level:
                cell.level
        });

    }

    return cells;

}


// ============================================================
// BUILD WATER SURFACE
// ============================================================

function rebuildWaterChunk(
    chunkX,
    chunkZ
) {

    const key =
        chunkKey(
            chunkX,
            chunkZ
        );

    const old =
        waterMeshes.get(key);

    if(old) {

        scene.remove(old);

        if(old.geometry)
            old.geometry.dispose();

        waterMeshes.delete(key);

    }

    const cells =
        getVisibleWaterRangeForChunk(
            chunkX,
            chunkZ
        );

    if(
        cells.length === 0
    ) {

        return;

    }

    const positions = [];
    const uvs = [];
    const indices = [];

    let vertexIndex = 0;

    for(
        const cell
        of cells
    ) {

        const x =
            cell.x;

        const z =
            cell.z;

        const height =
            waterLevelToHeight(
                cell.level
            );

        const surfaceY =
            cell.y -
            0.5 +
            height;

        // Slight per-cell variation.
        // The shader-like animation below will move these.

        positions.push(

            x - 0.5,
            surfaceY,
            z - 0.5,

            x + 0.5,
            surfaceY,
            z - 0.5,

            x + 0.5,
            surfaceY,
            z + 0.5,

            x - 0.5,
            surfaceY,
            z + 0.5

        );

        uvs.push(
            0, 0,
            1, 0,
            1, 1,
            0, 1
        );

        indices.push(

            vertexIndex,
            vertexIndex + 1,
            vertexIndex + 2,

            vertexIndex,
            vertexIndex + 2,
            vertexIndex + 3

        );

        vertexIndex += 4;

    }

    const geometry =
        new THREE.BufferGeometry();

    geometry.setAttribute(

        "position",

        new THREE.Float32BufferAttribute(
            positions,
            3
        )

    );

    geometry.setAttribute(

        "uv",

        new THREE.Float32BufferAttribute(
            uvs,
            2
        )

    );

    geometry.setIndex(indices);

    geometry.computeVertexNormals();

    // Store original Y positions.

    const positionAttribute =
        geometry.getAttribute(
            "position"
        );

    const baseY =
        new Float32Array(
            positionAttribute.count
        );

    for(
        let i = 0;
        i < positionAttribute.count;
        i++
    ) {

        baseY[i] =
            positionAttribute.getY(i);

    }

    geometry.userData.baseY =
        baseY;

    const mesh =
        new THREE.Mesh(
            geometry,
            waterMaterial
        );

    mesh.renderOrder = 2;

    mesh.frustumCulled = true;

    mesh.userData.waterChunk = true;

    waterMeshes.set(
        key,
        mesh
    );

    scene.add(mesh);

}


// ============================================================
// REBUILD VISIBLE WATER
// ============================================================

function rebuildVisibleWater() {

    for(
        const group
        of chunks.values()
    ) {

        rebuildWaterChunk(

            group.userData.chunkX,

            group.userData.chunkZ

        );

    }

}


// ============================================================
// CHUNK MANAGEMENT
// ============================================================

let playerChunkX = null;
let playerChunkZ = null;


function worldToChunk(
    coordinate
) {

    return Math.floor(
        coordinate /
        CHUNK_SIZE
    );

}


function updateChunks(
    force = false
) {

    const cx =
        worldToChunk(
            camera.position.x
        );

    const cz =
        worldToChunk(
            camera.position.z
        );

    if(
        !force &&
        cx === playerChunkX &&
        cz === playerChunkZ
    ) {

        return;

    }

    playerChunkX = cx;
    playerChunkZ = cz;

    for(
        let x =
            cx - RENDER_DISTANCE;

        x <=
            cx + RENDER_DISTANCE;

        x++
    ) {

        for(
            let z =
                cz - RENDER_DISTANCE;

            z <=
                cz + RENDER_DISTANCE;

            z++
        ) {

            const key =
                chunkKey(
                    x,
                    z
                );

            const existed =
                chunks.has(key);

            createChunk(
                x,
                z
            );

            if(!existed) {

                rebuildWaterChunk(
                    x,
                    z
                );

            }

        }

    }

    const keys =
        Array.from(
            chunks.keys()
        );

    for(
        const key
        of keys
    ) {

        const group =
            chunks.get(key);

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
                RENDER_DISTANCE + 1 ||

            dz >
                RENDER_DISTANCE + 1
        ) {

            scene.remove(group);

            chunks.delete(key);

            const water =
                waterMeshes.get(key);

            if(water) {

                scene.remove(water);

                water.geometry.dispose();

                waterMeshes.delete(
                    key
                );

            }

        }

    }

}


// ============================================================
// REBUILD MODIFIED CHUNK
// ============================================================

function rebuildBlockChunk(
    x,
    z
) {

    const cx =
        worldToChunk(x);

    const cz =
        worldToChunk(z);

    rebuildChunk(
        cx,
        cz
    );

    rebuildWaterChunk(
        cx,
        cz
    );

    const localX =
        ((x % CHUNK_SIZE) +
        CHUNK_SIZE) %
        CHUNK_SIZE;

    const localZ =
        ((z % CHUNK_SIZE) +
        CHUNK_SIZE) %
        CHUNK_SIZE;

    if(localX === 0) {

        rebuildChunk(
            cx - 1,
            cz
        );

        rebuildWaterChunk(
            cx - 1,
            cz
        );

    }

    if(
        localX ===
        CHUNK_SIZE - 1
    ) {

        rebuildChunk(
            cx + 1,
            cz
        );

        rebuildWaterChunk(
            cx + 1,
            cz
        );

    }

    if(localZ === 0) {

        rebuildChunk(
            cx,
            cz - 1
        );

        rebuildWaterChunk(
            cx,
            cz - 1
        );

    }

    if(
        localZ ===
        CHUNK_SIZE - 1
    ) {

        rebuildChunk(
            cx,
            cz + 1
        );

        rebuildWaterChunk(
            cx,
            cz + 1
        );

    }

}


// ============================================================
// PLAYER STATE
// ============================================================

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

let jumpHeld = false;

let canJump = false;

let playerInWater = false;

let playerSubmersion = 0;

let cameraUnderwater = false;


const velocity =
    new THREE.Vector3();


// ============================================================
// PLAYER AABB
// ============================================================

function getPlayerAABB(
    x = camera.position.x,
    eyeY = camera.position.y,
    z = camera.position.z
) {

    const feetY =
        eyeY -
        PLAYER_EYE_HEIGHT;

    return {

        minX:
            x -
            PLAYER_RADIUS,

        maxX:
            x +
            PLAYER_RADIUS,

        minY:
            feetY,

        maxY:
            feetY +
            PLAYER_HEIGHT,

        minZ:
            z -
            PLAYER_RADIUS,

        maxZ:
            z +
            PLAYER_RADIUS

    };

}


// ============================================================
// AABB VS BLOCK
// ============================================================

function aabbIntersectsBlock(
    box,
    x,
    y,
    z
) {

    const minX = x - 0.5;
    const maxX = x + 0.5;

    const minY = y - 0.5;
    const maxY = y + 0.5;

    const minZ = z - 0.5;
    const maxZ = z + 0.5;

    return (

        box.maxX >
            minX +
            EPSILON &&

        box.minX <
            maxX -
            EPSILON &&

        box.maxY >
            minY +
            EPSILON &&

        box.minY <
            maxY -
            EPSILON &&

        box.maxZ >
            minZ +
            EPSILON &&

        box.minZ <
            maxZ -
            EPSILON

    );

}


// ============================================================
// COLLISION LOOKUP
// ============================================================

function playerCollidesAt(
    x,
    eyeY,
    z
) {

    const box =
        getPlayerAABB(
            x,
            eyeY,
            z
        );

    const minX =
        Math.floor(
            box.minX -
            0.5
        );

    const maxX =
        Math.floor(
            box.maxX +
            0.5
        );

    const minY =
        Math.floor(
            box.minY -
            0.5
        );

    const maxY =
        Math.floor(
            box.maxY +
            0.5
        );

    const minZ =
        Math.floor(
            box.minZ -
            0.5
        );

    const maxZ =
        Math.floor(
            box.maxZ +
            0.5
        );

    for(
        let bx = minX;
        bx <= maxX;
        bx++
    ) {

        for(
            let by = minY;
            by <= maxY;
            by++
        ) {

            for(
                let bz = minZ;
                bz <= maxZ;
                bz++
            ) {

                if(
                    !isSolidBlock(
                        bx,
                        by,
                        bz
                    )
                ) {

                    continue;

                }

                if(
                    aabbIntersectsBlock(
                        box,
                        bx,
                        by,
                        bz
                    )
                ) {

                    return true;

                }

            }

        }

    }

    return false;

}


// ============================================================
// WATER SURFACE AT POSITION
// ============================================================

function getWaterSurfaceY(
    x,
    y,
    z
) {

    const bx =
        Math.floor(
            x + 0.5
        );

    const bz =
        Math.floor(
            z + 0.5
        );

    // Search around player's vertical location.

    for(
        let by =
            Math.floor(y + 1);

        by >=
            Math.floor(y - 3);

        by--
    ) {

        const level =
            getWaterLevel(
                bx,
                by,
                bz
            );

        if(
            level > 0
        ) {

            return (
                by -
                0.5 +
                waterLevelToHeight(
                    level
                )
            );

        }

    }

    return null;

}


// ============================================================
// PLAYER WATER SUBMERSION
//
// 0 = completely outside water
// 1 = completely underwater
// ============================================================

function updatePlayerWaterState() {

    const box =
        getPlayerAABB();

    const surfaceY =
        getWaterSurfaceY(

            camera.position.x,

            box.minY +
            PLAYER_HEIGHT *
            0.5,

            camera.position.z

        );

    if(
        surfaceY === null
    ) {

        playerInWater = false;

        playerSubmersion = 0;

        cameraUnderwater = false;

        return;

    }

    const submergedHeight =
        THREE.MathUtils.clamp(

            surfaceY -
            box.minY,

            0,

            PLAYER_HEIGHT

        );

    playerSubmersion =
        submergedHeight /
        PLAYER_HEIGHT;

    playerInWater =
        playerSubmersion >
        0.03;

    cameraUnderwater =
        camera.position.y <
        surfaceY;

}


// ============================================================
// MOVE X
// ============================================================

function movePlayerX(amount) {

    if(amount === 0)
        return;

    const target =
        camera.position.x +
        amount;

    if(
        !playerCollidesAt(
            target,
            camera.position.y,
            camera.position.z
        )
    ) {

        camera.position.x =
            target;

    }

}


// ============================================================
// MOVE Z
// ============================================================

function movePlayerZ(amount) {

    if(amount === 0)
        return;

    const target =
        camera.position.z +
        amount;

    if(
        !playerCollidesAt(
            camera.position.x,
            camera.position.y,
            target
        )
    ) {

        camera.position.z =
            target;

    }

}


// ============================================================
// MOVE Y
// ============================================================

function movePlayerY(amount) {

    if(amount === 0)
        return;

    const direction =
        Math.sign(amount);

    let remaining =
        Math.abs(amount);

    const maxStep = 0.07;

    while(
        remaining > 0
    ) {

        const step =
            Math.min(
                maxStep,
                remaining
            ) *
            direction;

        const target =
            camera.position.y +
            step;

        if(
            playerCollidesAt(
                camera.position.x,
                target,
                camera.position.z
            )
        ) {

            if(
                direction < 0
            ) {

                canJump = true;

            }

            velocity.y = 0;

            return;

        }

        camera.position.y =
            target;

        remaining -=
            Math.abs(step);

    }

    if(
        direction < 0
    ) {

        canJump = false;

    }

}


// ============================================================
// HORIZONTAL MOVEMENT
// ============================================================

const forwardVector =
    new THREE.Vector3();

const rightVector =
    new THREE.Vector3();


function updateHorizontalMovement(
    delta
) {

    let forward = 0;
    let right = 0;

    if(moveForward)
        forward++;

    if(moveBackward)
        forward--;

    if(moveRight)
        right++;

    if(moveLeft)
        right--;

    if(
        forward === 0 &&
        right === 0
    ) {

        return;

    }

    camera.getWorldDirection(
        forwardVector
    );

    forwardVector.y = 0;

    forwardVector.normalize();

    rightVector.set(

        forwardVector.z,

        0,

        -forwardVector.x

    );

    const length =
        Math.sqrt(
            forward *
            forward +
            right *
            right
        );

    forward /= length;
    right /= length;

    let speed =
        WALK_SPEED;

    if(playerInWater) {

        // Drag grows with submersion.

        speed *=
            THREE.MathUtils.lerp(
                1,
                WATER_DRAG_HORIZONTAL,
                playerSubmersion
            );

    }

    const moveX =
        (
            forwardVector.x *
            forward +

            rightVector.x *
            right
        ) *
        speed *
        delta;

    const moveZ =
        (
            forwardVector.z *
            forward +

            rightVector.z *
            right
        ) *
        speed *
        delta;

    movePlayerX(moveX);

    movePlayerZ(moveZ);

}


// ============================================================
// BUOYANCY
//
// Gravity always exists.
//
// Water produces an opposing buoyant force depending
// on how much of the player's body is submerged.
// ============================================================

function updateVerticalPhysics(
    delta
) {

    // Gravity always acts.

    velocity.y -=
        GRAVITY *
        delta;

    if(playerInWater) {

        // -----------------------------------------------
        // BUOYANCY
        // -----------------------------------------------

        const buoyancy =
            WATER_BUOYANCY *
            playerSubmersion;

        velocity.y +=
            buoyancy *
            delta;


        // -----------------------------------------------
        // VERTICAL DRAG
        // -----------------------------------------------

        const drag =
            Math.pow(

                WATER_DRAG_VERTICAL,

                delta * 60

            );

        velocity.y *= drag;


        // -----------------------------------------------
        // SWIMMING
        // -----------------------------------------------

        if(jumpHeld) {

            velocity.y +=
                WATER_SWIM_FORCE *
                delta;

        }


        // -----------------------------------------------
        // LIMIT SINKING SPEED
        // -----------------------------------------------

        velocity.y =
            Math.max(
                velocity.y,
                -WATER_MAX_SINK_SPEED
            );

    }

    movePlayerY(
        velocity.y *
        delta
    );

}


// ============================================================
// SAFE SPAWN
// ============================================================

function isSafeSpawn(
    x,
    groundY,
    z
) {

    if(
        groundY <=
        SEA_LEVEL + 1
    ) {

        return false;

    }

    if(
        !isSolidBlock(
            x,
            groundY,
            z
        )
    ) {

        return false;

    }

    const eyeY =
        groundY +
        0.5 +
        PLAYER_EYE_HEIGHT +
        0.02;

    return (
        !playerCollidesAt(
            x,
            eyeY,
            z
        )
    );

}


function findSafeSpawn() {

    for(
        let radius = 0;
        radius <= 45;
        radius++
    ) {

        for(
            let x = -radius;
            x <= radius;
            x++
        ) {

            for(
                let z = -radius;
                z <= radius;
                z++
            ) {

                if(
                    radius > 0 &&
                    Math.abs(x) !== radius &&
                    Math.abs(z) !== radius
                ) {

                    continue;

                }

                const ground =
                    terrainHeight(
                        x,
                        z
                    );

                if(
                    isSafeSpawn(
                        x,
                        ground,
                        z
                    )
                ) {

                    return {
                        x,
                        groundY: ground,
                        z
                    };

                }

            }

        }

    }

    return {
        x: 0,
        groundY:
            terrainHeight(
                0,
                0
            ),
        z: 0
    };

}


let spawnPoint =
    findSafeSpawn();


function respawnPlayer() {

    if(
        !isSafeSpawn(
            spawnPoint.x,
            spawnPoint.groundY,
            spawnPoint.z
        )
    ) {

        spawnPoint =
            findSafeSpawn();

    }

    camera.position.set(

        spawnPoint.x,

        spawnPoint.groundY +
        0.5 +
        PLAYER_EYE_HEIGHT +
        0.02,

        spawnPoint.z

    );

    velocity.set(
        0,
        0,
        0
    );

    updateChunks(true);

}


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
                1.025,
                1.025,
                1.025
            )

        ),

        new THREE.LineBasicMaterial({
            color: 0x111111
        })

    );

outline.visible = false;

scene.add(outline);


// ============================================================
// UPDATE TARGET
// ============================================================

function updateTarget() {

    targetedBlock = null;

    outline.visible = false;

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

                objects.push(child);

            }

        }

    }

    const hits =
        raycaster.intersectObjects(
            objects,
            false
        );

    if(
        hits.length === 0
    ) {

        return;

    }

    const hit =
        hits[0];

    const mesh =
        hit.object;

    const positions =
        mesh.userData.positions;

    if(
        hit.instanceId ===
        undefined
    ) {

        return;

    }

    const p =
        positions[
            hit.instanceId
        ];

    if(!p)
        return;

    const type =
        getBlock(
            p.x,
            p.y,
            p.z
        );

    if(!type)
        return;

    targetedBlock = {

        x: p.x,

        y: p.y,

        z: p.z,

        type,

        normal:
            hit.face
                ?
                hit.face.normal.clone()
                :
                new THREE.Vector3(
                    0,
                    1,
                    0
                )

    };

    outline.position.set(
        p.x,
        p.y,
        p.z
    );

    outline.visible = true;

}


// ============================================================
// BREAK BLOCK
// ============================================================

function breakBlock() {

    if(!targetedBlock)
        return;

    const b =
        targetedBlock;

    const definition =
        BLOCKS[
            b.type
        ];

    if(
        !definition ||
        !definition.breakable
    ) {

        return;

    }

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

    // If this exposes nearby water,
    // the fluid simulation can now enter the hole.

    targetedBlock = null;

    outline.visible = false;

}


// ============================================================
// PLACE BLOCK
// ============================================================

function canPlaceBlock(
    x,
    y,
    z
) {

    if(
        getBlock(
            x,
            y,
            z
        )
    ) {

        return false;

    }

    const box =
        getPlayerAABB();

    return (
        !aabbIntersectsBlock(
            box,
            x,
            y,
            z
        )
    );

}


function placeBlock() {

    if(!targetedBlock)
        return;

    const selected =
        Inventory.getSelectedItem();

    if(!selected)
        return;

    const type =
        Inventory.getSelectedType();

    if(
        !type ||
        !type.placeable
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
        !canPlaceBlock(
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

    // Remove dynamic water occupying this block.

    waterCells.delete(
        blockKey(
            x,
            y,
            z
        )
    );

    Inventory.consumeSelected(1);

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
            event.button === 0
        ) {

            breakBlock();

        }

        if(
            event.button === 2
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

        switch(event.code) {

            case "KeyW":

                moveForward = true;

                break;


            case "KeyS":

                moveBackward = true;

                break;


            case "KeyA":

                moveLeft = true;

                break;


            case "KeyD":

                moveRight = true;

                break;


            case "Space":

                event.preventDefault();

                jumpHeld = true;

                if(
                    canJump &&
                    !playerInWater
                ) {

                    velocity.y =
                        JUMP_FORCE;

                    canJump = false;

                }

                break;

        }

    }
);


document.addEventListener(
    "keyup",
    event => {

        switch(event.code) {

            case "KeyW":

                moveForward = false;

                break;


            case "KeyS":

                moveBackward = false;

                break;


            case "KeyA":

                moveLeft = false;

                break;


            case "KeyD":

                moveRight = false;

                break;


            case "Space":

                jumpHeld = false;

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

        moveForward = false;
        moveBackward = false;
        moveLeft = false;
        moveRight = false;

        jumpHeld = false;

        if(
            !Inventory.isOpen()
        ) {

            startScreen.style.display =
                "flex";

        }

    }
);


// ============================================================
// GAME API
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

    },

    // Useful later if we add a water bucket.

    createWaterSource(
        x,
        y,
        z
    ) {

        createWaterSource(
            x,
            y,
            z
        );

        rebuildVisibleWater();

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

let frameCounter = 0;

let fpsTimer = 0;


// ============================================================
// WATER ANIMATION
// ============================================================

let waterTime = 0;


function animateWater(
    delta
) {

    waterTime += delta;

    for(
        const mesh
        of waterMeshes.values()
    ) {

        const geometry =
            mesh.geometry;

        const position =
            geometry.getAttribute(
                "position"
            );

        const baseY =
            geometry.userData.baseY;

        if(!baseY)
            continue;

        for(
            let i = 0;
            i < position.count;
            i++
        ) {

            const x =
                position.getX(i);

            const z =
                position.getZ(i);

            // Two overlapping wave patterns.

            const wave1 =
                Math.sin(
                    x * 0.75 +
                    waterTime * 1.25
                ) *
                0.025;

            const wave2 =
                Math.cos(
                    z * 0.62 -
                    waterTime * 0.95
                ) *
                0.018;

            const wave3 =
                Math.sin(
                    (x + z) *
                    0.32 +
                    waterTime *
                    0.65
                ) *
                0.012;

            position.setY(

                i,

                baseY[i] +
                wave1 +
                wave2 +
                wave3

            );

        }

        position.needsUpdate = true;

        geometry.computeVertexNormals();

    }

}


// ============================================================
// DEPTH-BASED WATER COLOR
// ============================================================

function updateWaterColor() {

    // Estimate local water depth.

    const x =
        Math.floor(
            camera.position.x +
            0.5
        );

    const z =
        Math.floor(
            camera.position.z +
            0.5
        );

    const ground =
        terrainHeight(
            x,
            z
        );

    const depth =
        Math.max(
            0,
            SEA_LEVEL -
            ground
        );

    const depthFactor =
        THREE.MathUtils.clamp(
            depth / 12,
            0,
            1
        );

    const shallow =
        new THREE.Color(
            0x2c9ec0
        );

    const deep =
        new THREE.Color(
            0x07527a
        );

    const result =
        shallow.clone()
        .lerp(
            deep,
            depthFactor
        );

    waterMaterial.color.copy(
        result
    );

}


// ============================================================
// UNDERWATER ATMOSPHERE
// ============================================================

function updateUnderwaterView() {

    if(
        !cameraUnderwater
    ) {

        scene.background.copy(
            NORMAL_SKY_COLOR
        );

        scene.fog.color.copy(
            NORMAL_FOG_COLOR
        );

        scene.fog.near = 65;
        scene.fog.far = 140;

        renderer.toneMappingExposure =
            1.05;

        return;

    }

    const box =
        getPlayerAABB();

    const surface =
        getWaterSurfaceY(

            camera.position.x,

            box.minY +
            PLAYER_HEIGHT *
            0.5,

            camera.position.z

        );

    let depth = 0;

    if(
        surface !== null
    ) {

        depth =
            Math.max(
                0,
                surface -
                camera.position.y
            );

    }

    const factor =
        THREE.MathUtils.clamp(
            depth / 10,
            0,
            1
        );

    const underwaterColor =
        UNDERWATER_SHALLOW_COLOR
        .clone()
        .lerp(
            UNDERWATER_DEEP_COLOR,
            factor
        );

    scene.background.copy(
        underwaterColor
    );

    scene.fog.color.copy(
        underwaterColor
    );

    // Visibility gets shorter with depth.

    scene.fog.near =
        THREE.MathUtils.lerp(
            4,
            1.5,
            factor
        );

    scene.fog.far =
        THREE.MathUtils.lerp(
            38,
            14,
            factor
        );

    renderer.toneMappingExposure =
        THREE.MathUtils.lerp(
            0.9,
            0.55,
            factor
        );

}


// ============================================================
// PLAYER UPDATE
// ============================================================

function updatePlayer(
    delta
) {

    updatePlayerWaterState();

    updateHorizontalMovement(
        delta
    );

    updateVerticalPhysics(
        delta
    );

    updatePlayerWaterState();

    updateChunks();

    if(
        camera.position.y <
        WORLD_BOTTOM -
        15
    ) {

        respawnPlayer();

    }

}


// ============================================================
// SPAWN
// ============================================================

respawnPlayer();


// ============================================================
// CLOCK
// ============================================================

const clock =
    new THREE.Clock();


// ============================================================
// MAIN LOOP
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


    // --------------------------------------------------------
    // PLAYER
    // --------------------------------------------------------

    if(
        controls.isLocked &&
        !Inventory.isOpen()
    ) {

        updatePlayer(
            delta
        );

    }


    // --------------------------------------------------------
    // WATER FLOW
    // --------------------------------------------------------

    waterFlowTimer += delta;

    if(
        waterFlowTimer >=
        WATER_FLOW_INTERVAL
    ) {

        waterFlowTimer = 0;

        simulateWater();

    }


    // --------------------------------------------------------
    // WATER ANIMATION
    // --------------------------------------------------------

    animateWater(delta);

    updateWaterColor();

    updateUnderwaterView();


    // --------------------------------------------------------
    // TARGET
    // --------------------------------------------------------

    updateTarget();


    // --------------------------------------------------------
    // SKY
    // --------------------------------------------------------

    sky.position.copy(
        camera.position
    );


    // --------------------------------------------------------
    // FPS
    // --------------------------------------------------------

    frameCounter++;

    fpsTimer += delta;

    if(
        fpsTimer >= 0.5
    ) {

        fpsDisplay.textContent =
            "FPS: " +
            Math.round(
                frameCounter /
                fpsTimer
            );

        frameCounter = 0;

        fpsTimer = 0;

    }


    // --------------------------------------------------------
    // COORDINATES
    // --------------------------------------------------------

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


    let stateText = "";

    if(cameraUnderwater) {

        stateText =
            " | UNDERWATER";

    }

    else if(playerInWater) {

        stateText =
            " | SWIMMING";

    }


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
        ) +

        stateText;


    // --------------------------------------------------------
    // RENDER
    // --------------------------------------------------------

    renderer.render(
        scene,
        camera
    );

}


animate();