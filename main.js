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

// === POINTER LOCK CONTROLS (MOUSE LOOK) ===
const controls = new THREE.PointerLockControls(camera, document.body);

// Click to lock mouse
document.body.addEventListener("click", () => {
    controls.lock();
});

// === MOVEMENT VARIABLES ===
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

const speed = 5.0;      // walking speed
const gravity = 20.0;   // gravity force
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
                velocity.y = 8; // jump strength
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
const geometry = new THREE.BoxGeometry(200, 1, 200);
const material = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(geometry, material);
ground.position.y = -1;
scene.add(ground);

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7);
scene.add(light);

// === ANIMATION LOOP ===
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (controls.isLocked) {
        // Apply gravity
        velocity.y -= gravity * delta;

        // Movement direction
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        // Apply movement
        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

        // Move the camera
        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Apply vertical movement
        camera.position.y += velocity.y * delta;

        // Ground collision
        if (camera.position.y < 1.7) {
            velocity.y = 0;
            camera.position.y = 1.7;
            canJump = true;
        }

        // Slow down movement (friction)
        velocity.x *= 0.8;
        velocity.z *= 0.8;
    }

    renderer.render(scene, camera);
    prevTime = time;
}
animate();
