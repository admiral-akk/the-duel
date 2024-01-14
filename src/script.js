import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import "webrtc-adapter";
import GUI from "lil-gui";
import { gsap } from "gsap";
import Stats from "stats-js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import loadingVertexShader from "./shaders/loading/vertex.glsl";
import loadingFragmentShader from "./shaders/loading/fragment.glsl";
import matcapVertexShader from "./shaders/matcap/vertex.glsl";
import matcapFragmentShader from "./shaders/matcap/fragment.glsl";

/**
 * Helpers
 */
Math.clamp = (num, min, max) => Math.max(min, Math.min(num, max));

/**
 * Core objects
 */
const container = document.querySelector("div.container");
const canvasContainer = document.querySelector("div.relative");
const ui = document.querySelector("div.ui");
const canvas = document.querySelector("canvas.webgl");
const aspectRatio = 16 / 9;
const camera = new THREE.PerspectiveCamera(75, aspectRatio);
const renderer = new THREE.WebGLRenderer({ canvas });
const listener = new THREE.AudioListener();
camera.add(listener);
renderer.setClearColor("#201919");
const scene = new THREE.Scene();
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
var stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/**
 * Loader Setup
 */

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const dracoLoader = new DRACOLoader(loadingManager);
const audioLoader = new THREE.AudioLoader(loadingManager);
const gltfLoader = new GLTFLoader(loadingManager);
const fontLoader = new FontLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
dracoLoader.setDecoderPath("./draco/gltf/");

/**
 * Textures
 */
const textures = new Map();

const loadTextureFromUrl = (url) => {
  const texture = textureLoader.load(url);
  textures.set(url, texture);
  return texture;
};

const loadTexture = (name) => {
  const texture = textureLoader.load(`./texture/${name}.png`);
  textures.set(name, texture);
  return texture;
};

/**
 * Fonts
 */
const fonts = new Map();

const loadFont = (name) => {
  fontLoader.load(`./fonts/${name}.json`, function (font) {
    fonts.set(name, font);
  });
};

/**
 * Audio
 */
const audioPool = [];
const buffers = new Map();

const loadSound = (name) => {
  audioLoader.load(`./audio/${name}.mp3`, function (buffer) {
    buffers.set(name, buffer);
  });
};

const playSound = (name) => {
  if (!buffers.has(name)) {
    return;
  }
  const buffer = buffers.get(name);
  let audio = audioPool.filter((a) => !a.isPlaying).pop();
  if (!audio) {
    audio = new THREE.Audio(listener);
  }
  audio.setBuffer(buffer);
  audio.play();
};

/**
 * Window size
 */
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
  verticalOffset: 0,
  horizontalOffset: 0,
};
const updateSize = () => {
  if (window.innerHeight * camera.aspect > window.innerWidth) {
    sizes.width = window.innerWidth;
    sizes.height = window.innerWidth / camera.aspect;
    sizes.verticalOffset = (window.innerHeight - sizes.height) / 2;
    sizes.horizontalOffset = 0;
  } else {
    sizes.width = window.innerHeight * camera.aspect;
    sizes.height = window.innerHeight;
    sizes.verticalOffset = 0;
    sizes.horizontalOffset = (window.innerWidth - sizes.width) / 2;
  }
  canvasContainer.style.top = sizes.verticalOffset.toString() + "px";
  canvasContainer.style.left = sizes.horizontalOffset.toString() + "px";

  renderer.setSize(sizes.width, sizes.height);
  composer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
};
updateSize();

/**
 * Mouse tracking
 */

const mousePos = (event) => {
  return new THREE.Vector2(
    ((event.clientX - sizes.horizontalOffset) / sizes.width) * 2 - 1,
    -((event.clientY - sizes.verticalOffset) / sizes.height) * 2 + 1
  );
};

/**
 * Event Handling
 */
const eventLog = [];
const loggedEvents = new Set(["pointerdown", "pointerup", "keyup"]);
const universalEventHandler = (event) => {
  if (loggedEvents.has(event.type)) {
    eventLog.push([timeTracker.elapsedTime, event]);
  }
  switch (event.type) {
    case "resize":
    case "orientationchange":
      updateSize();
      break;
    case "dblclick":
      if (event.target.className !== "webgl") {
        return;
      }
      const fullscreenElement =
        document.fullscreenElement || document.webkitFullscreenElement;

      if (fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
      break;
    case "pointerdown":
    case "pointerup":
    case "pointermove":
      if (event.target.className !== "webgl") {
        return;
      }
      const pos = mousePos(event);
      break;
    case "keyup":
      keyPressed(event);
      break;
    default:
      break;
  }
};

const events = new Set();
for (const key in canvas) {
  if (/^on/.test(key)) {
    const eventType = key.substring(2);
    events.add(eventType);
    window.addEventListener(eventType, universalEventHandler);
  }
}

/**
 * Setup camera
 */
camera.position.y = 1;
camera.position.z = 1.5;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = true;

/**
 * Debug
 */

const debugObject = { timeSpeed: 1.0 };
const gui = new GUI();
gui
  .add(debugObject, "timeSpeed")
  .min(0)
  .max(3)
  .step(0.1)
  .onChange((v) => {
    timeTracker.timeSpeed = v;
  });

/**
 * Loading overlay
 */
const loadingShader = {
  uniforms: {
    tDiffuse: { value: null },
    uMinY: { value: 0.0 },
    uWidthY: { value: 0.005 },
    uMaxX: { value: 0.0 },
  },
  vertexShader: loadingVertexShader,
  fragmentShader: loadingFragmentShader,
};

const loadingScreen = new ShaderPass(loadingShader);
const loadingUniforms = loadingScreen.material.uniforms;
composer.addPass(loadingScreen);

/**
 * Loading Animation
 */
let progressRatio = 0.0;
let currAnimation = null;
let timeTracker = { timeSpeed: 0, deltaTime: 0, elapsedTime: 0.0 };
const updateProgress = (progress) => {
  progressRatio = Math.max(progress, progressRatio);
  if (currAnimation) {
    currAnimation.kill();
  }
  currAnimation = gsap.to(loadingUniforms.uMaxX, {
    duration: 1,
    value: progressRatio,
  });
  if (progressRatio == 1) {
    currAnimation.kill();
    const timeline = gsap.timeline();
    currAnimation = timeline.to(loadingUniforms.uMaxX, {
      duration: 0.2,
      value: progressRatio,
    });
    timeline.set(timeTracker, { timeSpeed: debugObject.timeSpeed });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      delay: 0.0,
      value: 0.01,
      ease: "power1.inOut",
    });
    timeline.to(loadingUniforms.uWidthY, {
      duration: 0.1,
      value: 0.0,
      ease: "power1.in",
    });
    timeline.to(loadingUniforms.uMinY, {
      duration: 0.5,
      value: 0.5,
      ease: "power1.in",
    });
  }
};

const initLoadingAnimation = () => {
  if (loadingManager.itemsTotal > 0) {
    loadingManager.onProgress = (_, itemsLoaded, itemsTotal) =>
      updateProgress(itemsLoaded / itemsTotal);
  } else {
    updateProgress(1);
  }
};

// STUN server gives you a list of candidates (names) that can be used to reach you.
// It doesn't actually provide networking.
// It just does some network magics to figure out how to appropriately address your client
// from the outside.
/**
 * Networking
 */
let channel = null;
const offerIn = document.querySelector("#offerIn");
const offerOut = document.querySelector("#offerOut");

const connection = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});

connection.ondatachannel = (event) => {
  console.log("ondatachannel", event);
  channel = event.channel;
  channel.onopen = (event) => console.log("onopen", event);
  channel.onmessage = (event) => console.log("onmessage", event);
};

connection.onconnectionstatechange = (event) =>
  console.log("onconnectionstatechange", event);
connection.oniceconnectionstatechange = (event) =>
  console.log("oniceconnectionstatechange", event);

async function createOffer() {
  channel = connection.createDataChannel("data");
  channel.onopen = (event) => console.log("onopen", event);
  channel.onmessage = (event) => console.log("onmessage", event);

  connection.onicecandidate = (event) => {
    console.log("onicecandidate", event);
    if (!event.candidate) {
      console.log("localDescription", connection.localDescription);
      offerOut.value = btoa(JSON.stringify(connection.localDescription));
    }
  };

  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
}

async function acceptRemoteOffer() {
  const offer = JSON.parse(atob(offerIn.value));
  console.log("acceptRemoteOffer", offer);
  await connection.setRemoteDescription(offer);
  connection.onicecandidate = (event) => {
    console.log("onicecandidate", event);
    if (!event.candidate) {
      offerOut.value = btoa(JSON.stringify(connection.localDescription));
    }
  };

  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
}

async function acceptAnswer() {
  const answer = JSON.parse(atob(offerIn.value));
  await connection.setRemoteDescription(answer);
}
let iter = 1;

function sendData() {
  iter++;
  channel.send(iter);
  console.log("Sent Data: " + iter);
}

/**
 * Loaded Objects
 */
loadTexture("matcap01");
loadTexture("matcap02");
loadTexture("matcap03");
loadSound("swoosh01");
loadFont("helvetiker_regular.typeface");

/**
 * Game Rules
 */

class Game {
  constructor() {
    this.state = new GameState();
    this.moveHistory = [];
    this.selectedMoves = new Map();
  }

  apply() {
    const m0 = this.selectedMoves.get(0);
    const m1 = this.selectedMoves.get(1);
    if (!m0 || !m1) {
      return;
    }
    const moves = [m0, m1];
    this.selectedMoves.clear();
    this.state.apply(moves);
    this.moveHistory.push(moves);
  }

  undo() {
    this.selectedMoves.clear();
    const moves = this.moveHistory.pop();
    if (!moves) {
      return;
    }
    this.state.undo(moves);
  }

  player(index) {
    return this.state.players[index];
  }
}

// the state at a particular moment in the game
// it does not care how you got here.
class GameState {
  constructor() {
    this.arenaSize = 6;
    const mid = (this.arenaSize - 1) / 2;
    this.players = [
      new Player(Math.floor(mid) - 1),
      new Player(Math.ceil(mid) + 1),
    ];
  }

  apply(moves) {
    // apply every move
    // moves shouldn't change things, just indicate intention
    moves.forEach((m, i) =>
      m.applyMove(this.players[i], this.players[(i + 1) % 2])
    );

    // keep players in bounds
    this.players.forEach((p) => {
      p.nextPosition = p.nextPosition === null ? p.position : p.nextPosition;
      p.nextPosition = Math.clamp(p.nextPosition, 0, this.arenaSize - 1);
    });
    // resolve movement
    if (this.players[0].nextPosition < this.players[1].nextPosition) {
      this.players.forEach((p) => {
        p.position = p.nextPosition;
        p.nextPosition = null;
      });
    }

    // resolve damage
    moves.forEach((m, i) =>
      m.applyAttack(this.players[i], this.players[(i + 1) % 2])
    );

    // resolve damage
    this.players.forEach((p) => {
      p.health -= p.isHit ? 1 : 0;
      p.isHit = false;
    });

    this.players.forEach((p) => console.log(p));
  }

  undo(moves) {
    moves.forEach((m, i) => m.undo(this.players[i], this.players[(i + 1) % 2]));
  }
}

class Player {
  constructor(start) {
    this.position = start;
    this.nextPosition = null;
    this.health = 2;
    this.isHit = false;
  }
}

class Command {
  constructor(type, params) {
    this.type = type;
    this.params = params;
  }

  applyMove(player, opponent) {
    switch (this.type) {
      case "move":
        player.nextPosition = this.params.nextPosition;
        return;
      default:
        return;
    }
  }

  applyAttack(player, opponent) {
    switch (this.type) {
      case "attack":
        const distance = Math.abs(player.position - opponent.position);
        opponent.isHit = distance === this.params.attackRange;
        return;
      default:
        return;
    }
  }

  undo(player, opponent) {
    switch (this.type) {
      case "move":
        player.position = this.params.position;
        return;
      case "attack":
        opponent.health = this.params.health;
        opponent.isHit = false;
        return;
      default:
        return;
    }
  }
}

const player = (eventCode) => {
  switch (eventCode) {
    case "KeyW":
    case "KeyA":
    case "KeyS":
    case "KeyD":
    case "Space":
      return 0;
    case "ArrowUp":
    case "ArrowLeft":
    case "ArrowDown":
    case "ArrowRight":
    case "Enter":
      return 1;
    default:
      return 0;
  }
};

const offset = (eventCode) => {
  switch (eventCode) {
    case "ArrowUp":
    case "ArrowDown":
    case "KeyW":
    case "KeyS":
      return 0;
    case "ArrowLeft":
    case "KeyA":
      return -1;
    case "ArrowRight":
    case "KeyD":
      return 1;
    default:
      return 0;
  }
};

const keyPressed = (event) => {
  const eventCode = event.code;
  console.log(eventCode);
  const playerIndex = player(eventCode);
  switch (eventCode) {
    case "Digit1":
      createOffer();
      return;
    case "Digit2":
      acceptRemoteOffer();
      return;
    case "Digit3":
      acceptAnswer();
      return;
    case "Digit4":
      sendData();
      return;
    case "Digit5":
      sendData();
      return;
    case "Backspace":
      game.undo();
      return;
    case "KeyS":
    case "KeyW":
    case "KeyA":
    case "KeyD":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      {
        const positionOffset = offset(eventCode);
        const position = game.player(playerIndex).position;
        game.selectedMoves.set(
          playerIndex,
          new Command("move", {
            nextPosition: position + positionOffset,
            position: position,
          })
        );
      }
      break;
    case "Space":
    case "Enter":
      game.selectedMoves.set(
        playerIndex,
        new Command("attack", {
          attackRange: 1,
        })
      );
      return;
    default:
      return;
  }
};

const game = new Game();

/**
 * Game Graphics
 */

const playerMesh = (matcapTexture) => {
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: matcapVertexShader,
    fragmentShader: matcapFragmentShader,
    uniforms: {
      uMatcap: {
        type: "sampler2D",
        value: matcapTexture,
      },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 4;
  scene.add(mesh);
  return mesh;
};

const tileMesh = (matcapTexture) => {
  const geo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: matcapVertexShader,
    fragmentShader: matcapFragmentShader,
    uniforms: {
      uMatcap: {
        type: "sampler2D",
        value: matcapTexture,
      },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return mesh;
};

const leftPlayer = playerMesh(textures.get("matcap01"));
const rightPlayer = playerMesh(textures.get("matcap02"));
const tiles = Array(game.state.arenaSize)
  .fill(0)
  .map((_, i) => {
    const mesh = tileMesh(textures.get("matcap03"));
    mesh.position.x = i - (game.state.arenaSize - 1) / 2;
    mesh.position.y = -0.4;
    return mesh;
  });

const animateGame = (elapsedTime, deltaTime) => {
  leftPlayer.position.x =
    game.player(0).position - (game.state.arenaSize - 1) / 2;
  rightPlayer.position.x =
    game.player(1).position - (game.state.arenaSize - 1) / 2;
};

/**
 * Animation
 */
const clock = new THREE.Clock();
const tick = () => {
  stats.begin();

  timeTracker.timeSpeed = document.hasFocus() ? debugObject.timeSpeed : 0;
  timeTracker.deltaTime = clock.getDelta();
  timeTracker.elapsedTime += timeTracker.timeSpeed * timeTracker.deltaTime;

  // update controls
  controls.update();
  game.apply();

  // Render scene
  animateGame();
  composer.render();

  // Call tick again on the next frame
  window.requestAnimationFrame(tick);
  stats.end();
};

initLoadingAnimation();
tick();
