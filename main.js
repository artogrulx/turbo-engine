// === WORLD ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

// === CAMERA ===
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 1.7, 0);

// === RENDERER ===
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

// ⭐ REQUIRED FOR POINTER LOCK ⭐
renderer.domElement.tabIndex = 1;
renderer.domElement.style.outline = "none";

document.getElementById("game-container").appendChild(renderer.domElement);

// === RESIZE ===
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// === POINTER LOCK ===
const controls = new THREE.PointerLockControls(camera, renderer.domElement);

renderer.domElement.addEventListener("click", () => {
    renderer.domElement.focus();
    controls.lock();
});

// === MOVEMENT ===
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

const speed = 5;
const gravity = 20;
let canJump = true;

document.addEventListener("keydown", (e) => {
    if (e.code === "KeyW") moveForward = true;
    if (e.code === "KeyS") moveBackward = true;
    if (e.code === "KeyA") moveLeft = true;
    if (e.code === "KeyD") moveRight = true;

    if (e.code === "Space" && canJump) {
        velocity.y = 8;
        canJump = false;
    }
});

document.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") moveForward = false;
    if (e.code === "KeyS") moveBackward = false;
    if (e.code === "KeyA") moveLeft = false;
    if (e.code === "KeyD") moveRight = false;
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

// === TREES ===
function createTree(x, z) {
    const trunk = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 2, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x8B4513 })
    );
    trunk.position.set(x, 0, z);
    scene.add(trunk);

    const leaves = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshStandardMaterial({ color: 0x006400 })
    );
    leaves.position.set(x, 2, z);
    scene.add(leaves);
}

for (let i = 0; i < 40; i++) {
    createTree(
        (Math.random() - 0.5) * 150,
        (Math.random() - 0.5) * 150
    );
}

// === LOOP ===
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
