// === BASIC THREE.JS WORLD ===

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky blue

// Camera
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

// Player height (eye level)
camera.position.set(0, 1.7, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("game-container").appendChild(renderer.domElement);

// Resize handling
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// === POINTER LOCK CONTROLS ===
const controls = new THREE.PointerLockControls(camera, renderer.domElement);

renderer.domElement.addEventListener("click", () => {
    controls.lock();
});

// === MOVEMENT VARIABLES ===
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

const speed = 5.0;
const gravity = 20.0;
let canJump = true;

// Keyboard input
document.addEventListener("keydown", (e) => {
    switch (e.code) {
        case "KeyW": moveForward = true; break;
        case "KeyS": moveBackward = true; break;
        case "KeyA": moveLeft = true; break;
        case "KeyD": moveRight = true; break;
        case "Space":
            if (canJump) {
                velocity.y = 8;
                canJump = false;
            }
            break;
    }
});

document.addEventListener("keyup", (e) => {
    switch (e.code) {
        case "KeyW": moveForward = false; break;
        case "KeyS": moveBackward = false; break;
        case "KeyA": moveLeft = false; break;
        case "KeyD": moveRight = false; break;
    }
});

// === GROUND ===
const groundGeo = new THREE.BoxGeometry(200, 1, 200);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -1;
scene.add(ground);

// === LIGHT ===
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7);
scene.add(light);

// === TREE GENERATOR ===
function createTree(x, z) {
    // Trunk
    const trunkGeo = new THREE.BoxGeometry(0.5, 2, 0.5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 0, z);
    scene.add(trunk);

    // Leaves
    const leavesGeo = new THREE.BoxGeometry(2, 2, 2);
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x006400 });
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.set(x, 2, z);
    scene.add(leaves);
}

// === SPAWN RANDOM TREES ===
for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * 150;
    const z = (Math.random() - 0.5) * 150;
    createTree(x, z);
}

// === ANIMATION LOOP ===
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (controls.isLocked) {
        velocity.y -= gravity * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        camera.position.y += velocity.y * delta;

        if (camera.position.y < 1.7) {
            velocity.y = 0;
            camera.position.y = 1.7;
            canJump = true;
        }

        velocity.x *= 0.8;
        velocity.z *= 0.8;
    }

    renderer.render(scene, camera);
    prevTime = time;
}
animate();
