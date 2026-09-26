// ============================================================
// REALISTIC MINECRAFT-STYLE THREE.JS WORLD
// ============================================================

// -------------------------
// SCENE
// -------------------------

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x8fc8ff);
scene.fog = new THREE.FogExp2(0xb9d9f5, 0.009);


// -------------------------
// CAMERA
// -------------------------

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500
);

camera.position.set(0, 2.7, 8);


// -------------------------
// RENDERER
// -------------------------

const renderer = new THREE.WebGLRenderer({
    antialias: true
});

renderer.setSize(
    window.innerWidth,
    window.innerHeight
);

renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
);

renderer.shadowMap.enabled = true;

renderer.shadowMap.type =
    THREE.PCFSoftShadowMap;

renderer.outputEncoding =
    THREE.sRGBEncoding;

renderer.toneMapping =
    THREE.ACESFilmicToneMapping;

renderer.toneMappingExposure = 1.15;

renderer.domElement.tabIndex = 1;

document
    .getElementById("game-container")
    .appendChild(renderer.domElement);


// ============================================================
// SKY
// ============================================================

const skyGeometry =
    new THREE.SphereGeometry(
        350,
        32,
        15
    );

const skyMaterial =
    new THREE.ShaderMaterial({

        side: THREE.BackSide,

        uniforms: {

            topColor: {
                value: new THREE.Color(
                    0x3c9df0
                )
            },

            bottomColor: {
                value: new THREE.Color(
                    0xe4f4ff
                )
            },

            offset: {
                value: 20
            },

            exponent: {
                value: 0.65
            }

        },

        vertexShader: `

            varying vec3 vWorldPosition;

            void main() {

                vec4 worldPosition =
                    modelMatrix *
                    vec4(position,1.0);

                vWorldPosition =
                    worldPosition.xyz;

                gl_Position =
                    projectionMatrix *
                    modelViewMatrix *
                    vec4(position,1.0);
            }

        `,

        fragmentShader: `

            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;

            varying vec3 vWorldPosition;

            void main() {

                float h =
                    normalize(
                        vWorldPosition +
                        offset
                    ).y;

                float mixValue =
                    max(
                        pow(
                            max(h,0.0),
                            exponent
                        ),
                        0.0
                    );

                gl_FragColor =
                    vec4(
                        mix(
                            bottomColor,
                            topColor,
                            mixValue
                        ),
                        1.0
                    );
            }

        `
    });

const sky =
    new THREE.Mesh(
        skyGeometry,
        skyMaterial
    );

scene.add(sky);


// ============================================================
// LIGHTING
// ============================================================

// soft sky light

const hemisphereLight =
    new THREE.HemisphereLight(
        0xbfe3ff,
        0x405020,
        0.75
    );

scene.add(
    hemisphereLight
);


// SUN

const sun =
    new THREE.DirectionalLight(
        0xfff1cc,
        2.4
    );

sun.position.set(
    60,
    100,
    40
);

sun.castShadow = true;

sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;

sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;

sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;

sun.shadow.camera.near = 1;
sun.shadow.camera.far = 250;

sun.shadow.bias = -0.0005;

scene.add(sun);


// ============================================================
// SUN CUBE
// ============================================================

const sunCube =
    new THREE.Mesh(

        new THREE.BoxGeometry(
            7,
            7,
            1
        ),

        new THREE.MeshBasicMaterial({
            color: 0xfff3b0
        })

    );

sunCube.position.set(
    80,
    100,
    -150
);

scene.add(sunCube);


// ============================================================
// MATERIALS
// ============================================================

const grassTopMaterial =
    new THREE.MeshStandardMaterial({
        color: 0x5d9b3a,
        roughness: 1
    });

const dirtMaterial =
    new THREE.MeshStandardMaterial({
        color: 0x795338,
        roughness: 1
    });

const stoneMaterial =
    new THREE.MeshStandardMaterial({
        color: 0x777777,
        roughness: 0.95
    });

const trunkMaterial =
    new THREE.MeshStandardMaterial({
        color: 0x69472d,
        roughness: 1
    });

const leafMaterial =
    new THREE.MeshStandardMaterial({

        color: 0x397b35,

        roughness: 0.9

    });


// ============================================================
// BLOCK CREATION
// ============================================================

function createBlock(
    x,
    y,
    z,
    material
) {

    const block =
        new THREE.Mesh(

            new THREE.BoxGeometry(
                1,
                1,
                1
            ),

            material

        );

    block.position.set(
        x,
        y,
        z
    );

    block.castShadow = true;
    block.receiveShadow = true;

    scene.add(block);

    return block;
}


// ============================================================
// TERRAIN
// ============================================================

const WORLD_SIZE = 60;


// terrain height

function terrainHeight(x,z) {

    let height = 0;

    height +=
        Math.sin(x * 0.12) * 1.5;

    height +=
        Math.cos(z * 0.1) * 1.4;

    height +=
        Math.sin(
            (x + z) * 0.05
        ) * 2;

    return Math.floor(height);

}


for (
    let x = -WORLD_SIZE;
    x <= WORLD_SIZE;
    x++
) {

    for (
        let z = -WORLD_SIZE;
        z <= WORLD_SIZE;
        z++
    ) {

        const h =
            terrainHeight(x,z);


        // grass surface

        createBlock(
            x,
            h,
            z,
            grassTopMaterial
        );


        // dirt underneath

        createBlock(
            x,
            h - 1,
            z,
            dirtMaterial
        );


        createBlock(
            x,
            h - 2,
            z,
            dirtMaterial
        );


        // occasional stone

        if (h > 2) {

            createBlock(
                x,
                h - 3,
                z,
                stoneMaterial
            );

        }

    }

}


// ============================================================
// TREES
// ============================================================

function createTree(x,z) {

    const groundY =
        terrainHeight(x,z);


    // trunk

    const height =
        4 +
        Math.floor(
            Math.random() * 3
        );


    for (
        let y = 1;
        y <= height;
        y++
    ) {

        createBlock(
            x,
            groundY + y,
            z,
            trunkMaterial
        );

    }


    // leaves

    for (
        let lx = -2;
        lx <= 2;
        lx++
    ) {

        for (
            let lz = -2;
            lz <= 2;
            lz++
        ) {

            for (
                let ly = 0;
                ly <= 2;
                ly++
            ) {

                if (
                    Math.abs(lx) +
                    Math.abs(lz) < 4
                ) {

                    createBlock(

                        x + lx,

                        groundY +
                        height +
                        ly,

                        z + lz,

                        leafMaterial

                    );

                }

            }

        }

    }


    // top

    createBlock(
        x,
        groundY + height + 3,
        z,
        leafMaterial
    );

}


// random forest

for (
    let i = 0;
    i < 85;
    i++
) {

    const x =
        Math.floor(
            Math.random() * 110
        ) - 55;

    const z =
        Math.floor(
            Math.random() * 110
        ) - 55;


    // keep spawn clear

    if (
        Math.abs(x) < 8 &&
        Math.abs(z) < 8
    ) {

        continue;

    }


    createTree(x,z);

}


// ============================================================
// CLOUDS
// ============================================================

const cloudMaterial =
    new THREE.MeshStandardMaterial({

        color: 0xffffff,

        roughness: 1

    });


const clouds = [];


function createCloud(
    x,
    y,
    z
) {

    const cloud =
        new THREE.Group();


    const pieces = [

        [-3,0,0,4,1,2],

        [0,0,0,5,1,3],

        [3,0,0,3,1,2],

        [0,1,0,3,1,2]

    ];


    pieces.forEach(p => {

        const cube =
            new THREE.Mesh(

                new THREE.BoxGeometry(
                    p[3],
                    p[4],
                    p[5]
                ),

                cloudMaterial

            );


        cube.position.set(
            p[0],
            p[1],
            p[2]
        );


        cloud.add(cube);

    });


    cloud.position.set(
        x,
        y,
        z
    );


    scene.add(cloud);

    clouds.push(cloud);

}


for (
    let i = 0;
    i < 18;
    i++
) {

    createCloud(

        Math.random() * 180 - 90,

        28 + Math.random() * 8,

        Math.random() * 180 - 90

    );

}


// ============================================================
// CROSSHAIR
// ============================================================

const crosshair =
    document.createElement("div");

crosshair.style.position =
    "fixed";

crosshair.style.left =
    "50%";

crosshair.style.top =
    "50%";

crosshair.style.width =
    "16px";

crosshair.style.height =
    "16px";

crosshair.style.transform =
    "translate(-50%, -50%)";

crosshair.style.pointerEvents =
    "none";

crosshair.style.zIndex =
    "1000";

crosshair.innerHTML = `

<div style="
position:absolute;
left:7px;
top:0;
width:2px;
height:16px;
background:white;
box-shadow:0 0 2px black;
"></div>

<div style="
position:absolute;
left:0;
top:7px;
width:16px;
height:2px;
background:white;
box-shadow:0 0 2px black;
"></div>

`;

document.body.appendChild(
    crosshair
);


// ============================================================
// POINTER LOCK
// ============================================================

const controls =
    new THREE.PointerLockControls(
        camera,
        renderer.domElement
    );


renderer.domElement.addEventListener(
    "click",
    () => {

        controls.lock();

    }
);


// ============================================================
// PLAYER
// ============================================================

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

let canJump = false;

const velocity =
    new THREE.Vector3();

const direction =
    new THREE.Vector3();


const PLAYER_HEIGHT = 1.7;

const WALK_SPEED = 22;

const GRAVITY = 25;

const JUMP_FORCE = 9;


// ============================================================
// KEYBOARD
// ============================================================

document.addEventListener(
    "keydown",
    e => {

        switch(e.code) {

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

                if(canJump) {

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
    e => {

        switch(e.code) {

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

        }

    }
);


// ============================================================
// SPAWN
// ============================================================

camera.position.set(
    0,
    terrainHeight(0,0)
        + PLAYER_HEIGHT
        + 2,
    0
);


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
// GAME LOOP
// ============================================================

const clock =
    new THREE.Clock();


function animate() {

    requestAnimationFrame(
        animate
    );


    const delta =
        Math.min(
            clock.getDelta(),
            0.05
        );


    // ----------------------------------
    // CLOUD MOVEMENT
    // ----------------------------------

    clouds.forEach(
        cloud => {

            cloud.position.x +=
                delta * 0.7;


            if(
                cloud.position.x > 100
            ) {

                cloud.position.x =
                    -100;

            }

        }
    );


    // ----------------------------------
    // PLAYER MOVEMENT
    // ----------------------------------

    if(
        controls.isLocked
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
            Number(moveForward) -
            Number(moveBackward);

        direction.x =
            Number(moveRight) -
            Number(moveLeft);


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


        // ----------------------------------
        // TERRAIN COLLISION
        // ----------------------------------

        const playerX =
            Math.round(
                camera.position.x
            );

        const playerZ =
            Math.round(
                camera.position.z
            );


        const groundHeight =
            terrainHeight(
                playerX,
                playerZ
            ) +
            PLAYER_HEIGHT;


        if(
            camera.position.y <=
            groundHeight
        ) {

            camera.position.y =
                groundHeight;

            velocity.y = 0;

            canJump = true;

        }

    }


    renderer.render(
        scene,
        camera
    );

}


animate();