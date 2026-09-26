// ============================================================
// BLOCK WORLD
// COMPLETE WORLD + PHYSICS REWRITE
// Three.js r128
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CHUNK_SIZE = 16;

const RENDER_DISTANCE = 3;

const SEA_LEVEL = 0;

const WORLD_BOTTOM = -35;


// Player dimensions.
//
// Camera represents the player's eye position.
//
// Feet:
// camera.y - PLAYER_EYE_HEIGHT
//
// Head:
// feet + PLAYER_TOTAL_HEIGHT

const PLAYER_WIDTH = 0.60;

const PLAYER_RADIUS =
    PLAYER_WIDTH / 2;

const PLAYER_TOTAL_HEIGHT = 1.80;

const PLAYER_EYE_HEIGHT = 1.62;


// Movement

const WALK_SPEED = 5.3;

const GRAVITY = 24;

const JUMP_FORCE = 8.5;

const REACH_DISTANCE = 6;


// Small collision tolerance.

const COLLISION_EPSILON = 0.001;


// ============================================================
// BLOCK DEFINITIONS
// ============================================================

const BLOCKS = {

    grass: {

        solid: true,

        transparent: false,

        breakable: true

    },

    dirt: {

        solid: true,

        transparent: false,

        breakable: true

    },

    stone: {

        solid: true,

        transparent: false,

        breakable: true

    },

    sand: {

        solid: true,

        transparent: false,

        breakable: true

    },

    log: {

        solid: true,

        transparent: false,

        breakable: true

    },

    leaves: {

        solid: true,

        transparent: true,

        breakable: true

    },

    water: {

        // IMPORTANT:
        // Water exists, but does NOT block movement.

        solid: false,

        transparent: true,

        breakable: false

    }

};


// ============================================================
// SCENE
// ============================================================

const scene =
    new THREE.Scene();


scene.background =
    new THREE.Color(
        0x87c9ff
    );


scene.fog =
    new THREE.Fog(
        0xb7dcf5,
        65,
        135
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
    1.05;


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
                0x87c9ff,

            side:
                THREE.BackSide

        })

    );


scene.add(
    sky
);


// ============================================================
// LIGHTING
// ============================================================

const hemisphere =
    new THREE.HemisphereLight(

        0xd9f0ff,

        0x53652f,

        0.9

    );


scene.add(
    hemisphere
);


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


sun.castShadow =
    true;


sun.shadow.mapSize.width =
    2048;


sun.shadow.mapSize.height =
    2048;


sun.shadow.camera.left =
    -50;


sun.shadow.camera.right =
    50;


sun.shadow.camera.top =
    50;


sun.shadow.camera.bottom =
    -50;


sun.shadow.camera.near =
    1;


sun.shadow.camera.far =
    180;


sun.shadow.bias =
    -0.0007;


scene.add(
    sun
);


// ============================================================
// MINECRAFT-STYLE SUN
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
                0xfff1aa

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
// SHARED BLOCK GEOMETRY
// ============================================================

const cubeGeometry =
    new THREE.BoxGeometry(
        1,
        1,
        1
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
                0.52,

            roughness:
                0.25,

            metalness:
                0,

            depthWrite:
                false,

            side:
                THREE.DoubleSide

        })

};


// ============================================================
// WORLD STORAGE
// ============================================================

const chunks =
    new Map();


// modifications:
//
// missing entry = use generated world
//
// null = player destroyed this block
//
// "stone", "dirt", etc = player placed/replaced block

const modifications =
    new Map();


// ============================================================
// WORLD KEYS
// ============================================================

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
// DETERMINISTIC RANDOM
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


// ============================================================
// VALUE NOISE
// ============================================================

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


    const a =
        lerp(
            n00,
            n10,
            sx
        );


    const b =
        lerp(
            n01,
            n11,
            sx
        );


    return lerp(
        a,
        b,
        sz
    );

}


// ============================================================
// TERRAIN HEIGHT
//
// IMPORTANT:
//
// This is ONLY used to GENERATE terrain.
//
// Player physics does NOT use this as an invisible floor.
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
// TREE INFORMATION
// ============================================================

function treeExistsAt(
    x,
    z
) {

    const ground =
        terrainHeight(
            x,
            z
        );


    if(
        ground <=
        SEA_LEVEL + 1
    ) {

        return false;

    }


    // Keep spawn region cleaner.

    if(
        Math.abs(x) <
        7 &&
        Math.abs(z) <
        7
    ) {

        return false;

    }


    const chance =
        hash2D(
            x + 918,
            z - 527
        );


    return (
        chance >
        0.982
    );

}


function treeHeight(
    x,
    z
) {

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
//
// This allows collision to know that a tree exists even
// though trees are generated visually in chunks.
// ============================================================

function getGeneratedTreeBlock(
    x,
    y,
    z
) {

    // A leaf block may belong to a tree whose trunk is
    // a few blocks away, so search nearby trunk positions.

    for(
        let tx =
            x - 2;

        tx <=
            x + 2;

        tx++
    ) {

        for(
            let tz =
                z - 2;

            tz <=
                z + 2;

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


            // -------------------------
            // TRUNK
            // -------------------------

            if(
                x === tx &&
                z === tz &&
                y >=
                    ground + 1 &&
                y <=
                    ground + height
            ) {

                return "log";

            }


            const dx =
                x - tx;


            const dz =
                z - tz;


            // -------------------------
            // LOWER LEAVES
            // -------------------------

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


            // -------------------------
            // TOP LEAVES
            // -------------------------

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
// PROCEDURAL BLOCK LOOKUP
// ============================================================

function getNaturalBlock(
    x,
    y,
    z
) {

    // Trees first.

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


    // -------------------------
    // ABOVE TERRAIN
    // -------------------------

    if(
        y >
        h
    ) {

        // Water occupies spaces up to sea level.

        if(
            y <=
            SEA_LEVEL &&
            h <
            SEA_LEVEL
        ) {

            return "water";

        }


        return null;

    }


    // -------------------------
    // SURFACE
    // -------------------------

    if(
        y ===
        h
    ) {

        if(
            h <=
            SEA_LEVEL
        ) {

            return "sand";

        }


        return "grass";

    }


    // -------------------------
    // DIRT
    // -------------------------

    if(
        y >=
        h - 2
    ) {

        return "dirt";

    }


    // -------------------------
    // STONE
    // -------------------------

    return "stone";

}


// ============================================================
// ACTUAL BLOCK LOOKUP
//
// THIS is now the authority for physics.
//
// If you destroy a block, this returns null.
//
// Therefore the player can fall into the hole.
// ============================================================

function getBlock(
    x,
    y,
    z
) {

    x =
        Math.floor(
            x
        );


    y =
        Math.floor(
            y
        );


    z =
        Math.floor(
            z
        );


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


    const definition =
        BLOCKS[type];


    if(!definition)
        return false;


    return (
        definition.solid ===
        true
    );

}


// ============================================================
// WATER CHECK
// ============================================================

function isWaterBlock(
    x,
    y,
    z
) {

    return (
        getBlock(
            x,
            y,
            z
        ) ===
        "water"
    );

}


// ============================================================
// CREATE CHUNK
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


    scene.add(
        group
    );


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
        group.children.length >
        0
    ) {

        group.remove(
            group.children[
                group.children.length -
                1
            ]
        );

    }

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


    clearChunk(
        group
    );


    const lists = {

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
    // TERRAIN
    // ========================================================

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


            // Render several terrain layers.

            const bottom =
                Math.max(
                    h - 4,
                    WORLD_BOTTOM
                );


            for(
                let y =
                    bottom;

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


            // =================================================
            // WATER
            // =================================================

            if(
                h <
                SEA_LEVEL
            ) {

                for(
                    let y =
                        h + 1;

                    y <=
                        SEA_LEVEL;

                    y++
                ) {

                    const type =
                        getBlock(
                            x,
                            y,
                            z
                        );


                    if(
                        type ===
                        "water"
                    ) {

                        lists.water.push({

                            x,
                            y,
                            z

                        });

                    }

                }

            }


            // =================================================
            // TREE
            // =================================================

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


    // ========================================================
    // PLACED BLOCKS ABOVE NATURAL RENDER RANGE
    // ========================================================

    for(
        const [
            key,
            value
        ]
        of modifications
    ) {

        if(!value)
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


        if(
            cx !==
            chunkX ||
            cz !==
            chunkZ
        ) {

            continue;

        }


        if(
            !lists[value]
        ) {

            continue;

        }


        // Check if already in list.

        const alreadyExists =
            lists[value]
            .some(
                p =>
                    p.x === x &&
                    p.y === y &&
                    p.z === z
            );


        if(
            !alreadyExists
        ) {

            lists[value].push({

                x,
                y,
                z

            });

        }

    }


    // ========================================================
    // INSTANCED MESHES
    // ========================================================

    for(
        const type
        of Object.keys(
            lists
        )
    ) {

        createInstancedBlocks(

            group,

            type,

            lists[type]

        );

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


    // Trunk

    for(
        let i = 1;
        i <= height;
        i++
    ) {

        const y =
            groundY +
            i;


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


    // Lower leaf layers.

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
                    Math.abs(dx) ===
                        2 &&
                    Math.abs(dz) ===
                        2
                ) {

                    continue;

                }


                const bx =
                    x +
                    dx;


                const bz =
                    z +
                    dz;


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


    // Upper leaves.

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

            const bx =
                x +
                dx;


            const bz =
                z +
                dz;


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

                    y:
                        topY,

                    z: bz

                });

            }

        }

    }

}


// ============================================================
// INSTANCED MESH CREATION
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


        dummy.rotation.set(
            0,
            0,
            0
        );


        if(
            type ===
            "water"
        ) {

            // Minecraft-like water block:
            // slightly below full block height.

            dummy.scale.set(
                1,
                0.88,
                1
            );


            dummy.position.y -=
                0.06;

        }

        else {

            dummy.scale.set(
                1,
                1,
                1
            );

        }


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
        (
            type !==
            "water"
        );


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
// CHUNK MANAGEMENT
// ============================================================

let playerChunkX =
    null;


let playerChunkZ =
    null;


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


    // Create nearby chunks.

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


    // Remove distant chunks.

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
// REBUILD CHUNK AROUND MODIFICATION
// ============================================================

function rebuildBlockChunk(
    x,
    z
) {

    const cx =
        worldToChunk(
            x
        );


    const cz =
        worldToChunk(
            z
        );


    rebuildChunk(
        cx,
        cz
    );


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


    if(
        localX ===
        0
    ) {

        rebuildChunk(
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

    }


    if(
        localZ ===
        0
    ) {

        rebuildChunk(
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

    }

}


// ============================================================
// PLAYER PHYSICS STATE
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


let playerInWater =
    false;


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
            PLAYER_TOTAL_HEIGHT,

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

    const minX =
        x -
        0.5;


    const maxX =
        x +
        0.5;


    const minY =
        y -
        0.5;


    const maxY =
        y +
        0.5;


    const minZ =
        z -
        0.5;


    const maxZ =
        z +
        0.5;


    return (

        box.maxX >
            minX +
            COLLISION_EPSILON &&

        box.minX <
            maxX -
            COLLISION_EPSILON &&

        box.maxY >
            minY +
            COLLISION_EPSILON &&

        box.minY <
            maxY -
            COLLISION_EPSILON &&

        box.maxZ >
            minZ +
            COLLISION_EPSILON &&

        box.minZ <
            maxZ -
            COLLISION_EPSILON

    );

}


// ============================================================
// CHECK PLAYER COLLISION
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


    const minBlockX =
        Math.floor(
            box.minX -
            0.5
        );


    const maxBlockX =
        Math.floor(
            box.maxX +
            0.5
        );


    const minBlockY =
        Math.floor(
            box.minY -
            0.5
        );


    const maxBlockY =
        Math.floor(
            box.maxY +
            0.5
        );


    const minBlockZ =
        Math.floor(
            box.minZ -
            0.5
        );


    const maxBlockZ =
        Math.floor(
            box.maxZ +
            0.5
        );


    for(
        let xBlock =
            minBlockX;

        xBlock <=
            maxBlockX;

        xBlock++
    ) {

        for(
            let yBlock =
                minBlockY;

            yBlock <=
                maxBlockY;

            yBlock++
        ) {

            for(
                let zBlock =
                    minBlockZ;

                zBlock <=
                    maxBlockZ;

                zBlock++
            ) {

                if(
                    !isSolidBlock(
                        xBlock,
                        yBlock,
                        zBlock
                    )
                ) {

                    continue;

                }


                if(
                    aabbIntersectsBlock(

                        box,

                        xBlock,

                        yBlock,

                        zBlock

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
// WATER DETECTION
// ============================================================

function updateWaterState() {

    const feetY =
        camera.position.y -
        PLAYER_EYE_HEIGHT;


    const centerY =
        feetY +
        PLAYER_TOTAL_HEIGHT *
        0.45;


    playerInWater =
        isWaterBlock(

            Math.floor(
                camera.position.x +
                0.5
            ),

            Math.floor(
                centerY +
                0.5
            ),

            Math.floor(
                camera.position.z +
                0.5
            )

        );

}


// ============================================================
// MOVE PLAYER X
// ============================================================

function movePlayerX(
    amount
) {

    if(
        amount ===
        0
    ) {

        return;

    }


    const targetX =
        camera.position.x +
        amount;


    if(
        !playerCollidesAt(

            targetX,

            camera.position.y,

            camera.position.z

        )
    ) {

        camera.position.x =
            targetX;

        return;

    }


    // Collision:
    // stop horizontal X velocity.

    velocity.x = 0;

}


// ============================================================
// MOVE PLAYER Z
// ============================================================

function movePlayerZ(
    amount
) {

    if(
        amount ===
        0
    ) {

        return;

    }


    const targetZ =
        camera.position.z +
        amount;


    if(
        !playerCollidesAt(

            camera.position.x,

            camera.position.y,

            targetZ

        )
    ) {

        camera.position.z =
            targetZ;

        return;

    }


    velocity.z = 0;

}


// ============================================================
// MOVE PLAYER Y
//
// Uses small steps so gravity cannot tunnel through blocks.
// ============================================================

function movePlayerY(
    amount
) {

    if(
        amount ===
        0
    ) {

        return;

    }


    const direction =
        Math.sign(
            amount
        );


    let remaining =
        Math.abs(
            amount
        );


    const maxStep =
        0.08;


    while(
        remaining >
        0
    ) {

        const step =
            Math.min(
                maxStep,
                remaining
            ) *
            direction;


        const targetY =
            camera.position.y +
            step;


        if(
            playerCollidesAt(

                camera.position.x,

                targetY,

                camera.position.z

            )
        ) {

            // Falling down onto floor.

            if(
                direction <
                0
            ) {

                canJump =
                    true;

            }


            // Hit floor or ceiling.

            velocity.y =
                0;


            return;

        }


        camera.position.y =
            targetY;


        remaining -=
            Math.abs(
                step
            );

    }


    if(
        direction <
        0
    ) {

        canJump =
            false;

    }

}


// ============================================================
// MOVE PLAYER HORIZONTALLY
//
// Uses camera direction, but collisions are applied
// independently on X and Z.
// ============================================================

const forwardVector =
    new THREE.Vector3();


const rightVector =
    new THREE.Vector3();


function updateHorizontalMovement(
    delta
) {

    let inputForward = 0;

    let inputRight = 0;


    if(moveForward)
        inputForward += 1;


    if(moveBackward)
        inputForward -= 1;


    if(moveRight)
        inputRight += 1;


    if(moveLeft)
        inputRight -= 1;


    if(
        inputForward === 0 &&
        inputRight === 0
    ) {

        return;

    }


    camera.getWorldDirection(
        forwardVector
    );


    // Ignore camera pitch.

    forwardVector.y = 0;


    forwardVector.normalize();


    rightVector.set(

        forwardVector.z,

        0,

        -forwardVector.x

    );


    const length =
        Math.sqrt(

            inputForward *
            inputForward +

            inputRight *
            inputRight

        );


    inputForward /=
        length;


    inputRight /=
        length;


    let speed =
        WALK_SPEED;


    if(
        playerInWater
    ) {

        speed *=
            0.55;

    }


    const moveX =
        (
            forwardVector.x *
            inputForward +

            rightVector.x *
            inputRight
        ) *
        speed *
        delta;


    const moveZ =
        (
            forwardVector.z *
            inputForward +

            rightVector.z *
            inputRight
        ) *
        speed *
        delta;


    // Separate axes:
    // lets player slide along walls.

    movePlayerX(
        moveX
    );


    movePlayerZ(
        moveZ
    );

}


// ============================================================
// SAFE SPAWN TEST
// ============================================================

function isSafeSpawn(
    x,
    groundY,
    z
) {

    // Spawn eye position.

    const eyeY =
        groundY +
        0.5 +
        PLAYER_EYE_HEIGHT +
        0.02;


    // Ground must actually be solid.

    if(
        !isSolidBlock(
            x,
            groundY,
            z
        )
    ) {

        return false;

    }


    // Avoid underwater spawn.

    if(
        groundY <=
        SEA_LEVEL
    ) {

        return false;

    }


    // Player body must fit.

    if(
        playerCollidesAt(
            x,
            eyeY,
            z
        )
    ) {

        return false;

    }


    // Don't spawn inside water.

    const feetY =
        eyeY -
        PLAYER_EYE_HEIGHT;


    if(
        isWaterBlock(
            x,
            Math.floor(
                feetY +
                0.5
            ),
            z
        )
    ) {

        return false;

    }


    return true;

}


// ============================================================
// FIND SAFE SPAWN
// ============================================================

function findSafeSpawn() {

    for(
        let radius = 0;
        radius <= 40;
        radius++
    ) {

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

                // Only inspect perimeter at larger radii.

                if(
                    radius >
                    0 &&
                    Math.abs(x) !==
                        radius &&
                    Math.abs(z) !==
                        radius
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

                        groundY:
                            ground,

                        z

                    };

                }

            }

        }

    }


    // Emergency fallback.

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


// ============================================================
// SPAWN / RESPAWN
// ============================================================

let spawnPoint =
    findSafeSpawn();


function respawnPlayer() {

    // Re-check spawn in case the player modified it.

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


    canJump =
        false;


    updateChunks(
        true
    );

}


respawnPlayer();


// ============================================================
// BLOCK RAYCASTING
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
// UPDATE BLOCK TARGET
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
                child.isInstancedMesh &&
                child.userData.blockType !==
                    "water"
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


    const actualType =
        getBlock(
            p.x,
            p.y,
            p.z
        );


    if(
        !actualType ||
        actualType ===
        "water"
    ) {

        return;

    }


    targetedBlock = {

        x:
            p.x,

        y:
            p.y,

        z:
            p.z,

        type:
            actualType,

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


    // Actual block becomes empty.

    modifications.set(

        blockKey(
            b.x,
            b.y,
            b.z
        ),

        null

    );


    // Give block to inventory.

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
// CAN PLACE BLOCK
// ============================================================

function canPlaceBlock(
    x,
    y,
    z
) {

    const existing =
        getBlock(
            x,
            y,
            z
        );


    // Can place in air or replace water.

    if(
        existing &&
        existing !==
        "water"
    ) {

        return false;

    }


    // Temporarily imagine block exists.

    const box =
        getPlayerAABB();


    if(
        aabbIntersectsBlock(
            box,
            x,
            y,
            z
        )
    ) {

        return false;

    }


    return true;

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


    Inventory.consumeSelected(
        1
    );


    rebuildBlockChunk(
        x,
        z
    );

}


// ============================================================
// MOUSE INPUT
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
// KEYBOARD INPUT
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

                event.preventDefault();


                if(
                    playerInWater
                ) {

                    // Swim upward.

                    velocity.y =
                        4.2;

                }

                else if(
                    canJump
                ) {

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
// INVENTORY API
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
// WINDOW RESIZE
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
// DEBUG DISPLAY
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
// CLOCK
// ============================================================

const clock =
    new THREE.Clock();


// ============================================================
// WATER VISUAL EFFECT
// ============================================================

let waterAnimationTime = 0;


function updateWaterVisuals(
    delta
) {

    waterAnimationTime +=
        delta;


    const brightness =
        0.51 +
        Math.sin(
            waterAnimationTime *
            0.6
        ) *
        0.015;


    blockMaterials.water
        .color
        .setHSL(

            0.56,

            0.70,

            brightness

        );

}


// ============================================================
// PLAYER PHYSICS
// ============================================================

function updatePlayer(
    delta
) {

    updateWaterState();


    // ========================================================
    // HORIZONTAL MOVEMENT
    // ========================================================

    updateHorizontalMovement(
        delta
    );


    // ========================================================
    // GRAVITY
    // ========================================================

    if(
        playerInWater
    ) {

        // Reduced gravity underwater.

        velocity.y -=
            GRAVITY *
            0.18 *
            delta;


        // Water drag.

        velocity.y *=
            Math.pow(
                0.93,
                delta *
                60
            );

    }

    else {

        velocity.y -=
            GRAVITY *
            delta;

    }


    // ========================================================
    // VERTICAL COLLISION
    // ========================================================

    movePlayerY(

        velocity.y *
        delta

    );


    // ========================================================
    // CHUNKS
    // ========================================================

    updateChunks();


    // ========================================================
    // VOID
    // ========================================================

    if(
        camera.position.y <
        WORLD_BOTTOM -
        15
    ) {

        respawnPlayer();

    }

}


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
    // PLAYER
    // ========================================================

    if(
        controls.isLocked &&
        !Inventory.isOpen()
    ) {

        updatePlayer(
            delta
        );

    }


    // ========================================================
    // BLOCK TARGET
    // ========================================================

    updateTarget();


    // ========================================================
    // WATER
    // ========================================================

    updateWaterVisuals(
        delta
    );


    // ========================================================
    // SKY FOLLOWS PLAYER
    // ========================================================

    sky.position.copy(
        camera.position
    );


    // ========================================================
    // FPS
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


        frameCounter = 0;

        fpsTimer = 0;

    }


    // ========================================================
    // COORDINATES
    // ========================================================

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
        ) +

        (
            playerInWater
                ?
                " | WATER"
                :
                ""
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